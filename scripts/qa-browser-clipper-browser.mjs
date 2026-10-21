import assert from "node:assert/strict";
import http from "node:http";
import { writeFile } from "node:fs/promises";
import { chromium } from "/app/node_modules/playwright-core/index.mjs";

// Forward container localhost to the synthetic fixture on the host, preserving configured Host/Origin.
const proxies = [];
for (const port of [39474, 39475]) {
  const proxy = http.createServer((req, res) => {
    const upstream = http.request(
      {
        hostname: "host.docker.internal",
        port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502);
      res.end(error.message);
    });
    req.pipe(upstream);
  });
  proxy.on("upgrade", (req, socket, head) => {
    const upstream = http.request({
      hostname: "host.docker.internal",
      port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
          Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}\r\n`)
            .join("") +
          "\r\n",
      );
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      socket.pipe(remote);
      remote.pipe(socket);
      socket.on("error", () => remote.destroy());
      remote.on("error", () => socket.destroy());
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  await new Promise((resolve) => proxy.listen(port, "127.0.0.1", resolve));
  proxies.push(proxy);
}
const context = await chromium.launchPersistentContext("/tmp/doca-browser-qa", {
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-extensions-except=/tmp/doca-extension",
    "--load-extension=/tmp/doca-extension",
  ],
});
const errors = [];
context.on("page", (page) =>
  page.on("pageerror", (error) => errors.push(error.message)),
);
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const extensionId = worker.url().split("/")[2];
  const source = await context.newPage();
  await source.goto("http://localhost:39475/");
  await source.waitForSelector("#article img");
  await source.evaluate(() =>
    Promise.all([...document.images].map((image) => image.decode())),
  );
  const ui = await context.newPage();
  await ui.setViewportSize({ width: 370, height: 650 });
  await ui.goto(`chrome-extension://${extensionId}/ui.html`);
  async function loginPage(login = "clipperqa") {
    let page = context
      .pages()
      .find((page) => page.url().includes("/#/browser-connect?"));
    if (!page)
      page = await context.waitForEvent("page", {
        predicate: (page) => page.url().includes("/#/browser-connect?"),
        timeout: 15000,
      });
    await page.locator('input[name="login"]').fill(login);
    await page
      .locator('input[name="password"]')
      .fill("isolated-browser-qa-password");
    await page.locator("form .primary").last().click();
    await page.waitForEvent("close", { timeout: 15000 });
  }
  await loginPage();
  try {
    await ui.waitForSelector("#capture-pane:not([hidden])", { timeout: 15000 });
  } catch (error) {
    await ui.screenshot({
      path: "/artifacts/login-failure.png",
      fullPage: true,
    });
    console.log("LOGIN_BODY", await ui.locator("body").innerText());
    throw error;
  }
  assert((await ui.locator("#identity").innerText()).includes("验收账户"));
  await ui.screenshot({
    path: "/artifacts/extension-capture.png",
    fullPage: true,
  });
  const state = await ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "state" }),
  );
  assert(state.ok && state.value.connected);
  const sourceTab = await ui.evaluate(
    async () =>
      (await chrome.tabs.query({ url: "http://localhost:39475/*" }))[0],
  );
  assert(sourceTab.id);
  // A trusted mouse release exposes the actual closed-shadow selection toolbar.
  await source.bringToFront();
  const point = await source.locator("#article").boundingBox();
  await source.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("article"));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await source.mouse.move(point.x + 30, point.y + 35);
  await source.mouse.up();
  await source.waitForSelector("[data-doca-capture-ui]");
  const cdp = await context.newCDPSession(source);
  async function toolbarTree() {
    return (await cdp.send("DOM.getDocument", { depth: -1, pierce: true }))
      .root;
  }
  function find(node, predicate) {
    if (predicate(node)) return node;
    for (const child of [
      ...(node.children || []),
      ...(node.shadowRoots || []),
    ]) {
      const result = find(child, predicate);
      if (result) return result;
    }
    return null;
  }
  const textOf = (node) =>
    (node.nodeValue || "") +
    [...(node.children || []), ...(node.shadowRoots || [])]
      .map(textOf)
      .join("");
  const deadline = Date.now() + 12000;
  let button;
  while (Date.now() < deadline) {
    const tree = await toolbarTree();
    button = find(
      tree,
      (node) =>
        node.nodeName === "BUTTON" && textOf(node).includes("收录到 Doca"),
    );
    if (button && !button.attributes.includes("disabled")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(button, "selection capture button");
  const box = (await cdp.send("DOM.getBoxModel", { nodeId: button.nodeId }))
    .model.border;
  await source.mouse.click((box[0] + box[4]) / 2, (box[1] + box[5]) / 2);
  let saved = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (textOf(await toolbarTree()).includes("已保存，打开文档")) {
      saved = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert(saved, "selected content and image saved from the actual toolbar");
  await source.screenshot({
    path: "/artifacts/selection-toolbar.png",
    fullPage: true,
  });
  const whole = await ui.evaluate(
    async ({ tabId, profileId }) =>
      await chrome.runtime.sendMessage({
        type: "capture",
        mode: "page",
        tabId,
        profileId,
        profileRevision: 1,
      }),
    { tabId: sourceTab.id, profileId: process.env.DOCA_QA_PROFILE },
  );
  assert(whole.ok, JSON.stringify(whole));
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1440, height: 1000 });
  await settings.goto("http://localhost:39474/#/browser-assistant");
  await settings
    .getByRole("heading", { name: "浏览器助手", exact: true })
    .waitFor();
  await settings.getByText("故障案例", { exact: true }).waitFor();
  await settings.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await settings.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await settings.screenshot({
    path: "/artifacts/doca-profiles.png",
    fullPage: true,
  });
  const firstReplica = await context.newPage(),
    secondReplica = await context.newPage();
  await firstReplica.goto(
    `http://localhost:39474/#/r/${process.env.DOCA_QA_TARGET}`,
  );
  await secondReplica.goto(
    `http://localhost:39474/#/r/${process.env.DOCA_QA_TARGET}`,
  );
  async function waitBody(page, text) {
    try {
      await page.waitForFunction(
        (text) => document.body.innerText.includes(text),
        text,
        { timeout: 15000 },
      );
    } catch (error) {
      await page.screenshot({
        path: "/artifacts/document-failure.png",
        fullPage: true,
      });
      console.log(
        "DOCUMENT_BODY",
        (await page.locator("body").innerText()).slice(-10000),
      );
      throw error;
    }
  }
  await waitBody(firstReplica, "原有排查内容");
  await waitBody(secondReplica, "原有排查内容");
  const appended = await ui.evaluate(
    async ({ tabId, profileId }) =>
      await chrome.runtime.sendMessage({
        type: "capture",
        mode: "page",
        tabId,
        profileId,
        profileRevision: 1,
      }),
    { tabId: sourceTab.id, profileId: process.env.DOCA_QA_APPEND },
  );
  assert(appended.ok, JSON.stringify(appended));
  await waitBody(firstReplica, "接线端子松动");
  await waitBody(secondReplica, "接线端子松动");
  await firstReplica.screenshot({
    path: "/artifacts/append-live-document.png",
    fullPage: true,
  });
  await ui.goto(`chrome-extension://${extensionId}/ui.html#assistant`);
  await ui.reload();
  await ui.setViewportSize({ width: 410, height: 850 });
  await ui.waitForSelector("#assistant-pane:not([hidden])");
  await ui.selectOption("#ai-profile", process.env.DOCA_QA_PROFILE);
  await ui.waitForFunction(
    () => document.querySelector("#model").options.length > 0,
  );
  await ui.fill("#prompt", "请介绍故障排查的步骤，只在对话里回答。");
  await ui.click("#send");
  try {
    await ui.waitForFunction(
      () =>
        document
          .querySelector("#conversation")
          .innerText.includes("这是模拟 AI 的回答，用于验证会话、页面和积分。"),
      null,
      { timeout: 20000 },
    );
  } catch (error) {
    await ui.screenshot({
      path: "/artifacts/assistant-failure.png",
      fullPage: true,
    });
    console.log("ASSISTANT_BODY", await ui.locator("body").innerText());
    throw error;
  }
  await ui.screenshot({
    path: "/artifacts/extension-assistant.png",
    fullPage: true,
  });
  await settings.getByRole("tab", { name: "浏览器连接", exact: true }).click();
  await settings.getByText("Doca Browser", { exact: true }).waitFor();
  await settings.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await settings.screenshot({
    path: "/artifacts/doca-connections.png",
    fullPage: true,
  });
  await settings.setViewportSize({ width: 720, height: 960 });
  await settings.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await settings.screenshot({
    path: "/artifacts/doca-connections-narrow.png",
    fullPage: true,
  });
  // The public site config contains no account credential. An invalid config keeps the site.
  const replacement = JSON.stringify({
    version: 2,
    origin: "http://localhost:39474",
  });
  await ui.click("[data-tab=connection]");
  await ui.locator("#advanced-config summary").click();
  await ui.fill("#config", '{"version":1}');
  await ui.locator("#configure button[type=submit]").click();
  await ui
    .getByText("配置格式无效或版本不支持，原站点配置已保留。", { exact: true })
    .waitFor();
  const retained = await ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "state" }),
  );
  assert(retained.value.connected);
  await ui.fill("#config", replacement);
  await ui.locator("#configure button[type=submit]").click();
  await ui.getByText("已连接", { exact: true }).waitFor();
  await worker.evaluate(async () => {
    const auth = (await chrome.storage.session.get("authorization"))
      .authorization;
    globalThis.qaPreviousConnection = auth;
    await chrome.storage.session.set({
      authorization: { ...auth, expiresAt: "2000-01-01T00:00:00Z" },
    });
  });
  const renewed = await ui.evaluate(
    async () =>
      await chrome.runtime.sendMessage({ type: "state", interactive: true }),
  );
  assert(
    renewed.value.connected,
    "Short token renews through the signed-in website without prompting",
  );
  const oldStatus = await worker.evaluate(async () => {
    const previous = globalThis.qaPreviousConnection;
    const response = await fetch(
      previous.origin + "/api/v1/browser-clipper/me",
      {
        headers: { Authorization: "Bearer " + previous.token },
        credentials: "omit",
      },
    );
    delete globalThis.qaPreviousConnection;
    return response.status;
  });
  assert.equal(oldStatus, 401);
  const logout = await settings.evaluate(
    async () =>
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((response) => response.status),
  );
  assert.equal(logout, 200);
  const loggedOut = await ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "state" }),
  );
  assert(!loggedOut.value.connected);
  assert.equal(loggedOut.value.error, "clipper_login_required");
  const reconnect = ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "login" }),
  );
  await loginPage();
  assert((await reconnect).value.connected);
  const ownerState = (
    await ui.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "state" }),
    )
  ).value;
  await worker.evaluate(
    async (owner) =>
      chrome.storage.session.set({
        pending: {
          origin: owner.origin,
          connectionId: owner.connectionId,
          requestId: "unsent-owner-material",
        },
      }),
    ownerState,
  );
  await settings.evaluate(async () =>
    fetch("/api/v1/auth/logout", { method: "POST" }),
  );
  const secondLogin = ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "login" }),
  );
  await loginPage("clipperqasecond");
  const second = (await secondLogin).value;
  assert(second.connected && second.user.name === "第二个验收账户");
  assert(!second.pending);
  assert.notEqual(second.connectionId, ownerState.connectionId);
  await ui.reload();
  await ui.getByText("第二个验收账户", { exact: true }).waitFor();
  await settings.evaluate(async () =>
    fetch("/api/v1/auth/logout", { method: "POST" }),
  );
  const ownerLogin = ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "login" }),
  );
  await loginPage();
  const restored = (await ownerLogin).value;
  assert(restored.connected && restored.pending);
  assert.equal(restored.connectionId, ownerState.connectionId);
  await worker.evaluate(async () => chrome.storage.session.remove("pending"));
  await ui.reload();
  await ui.click("[data-tab=connection]");
  await ui.fill("#endpoint", "http://localhost:39474/api/v1");
  await ui.locator("#endpoint-form button").click();
  await ui
    .getByText("请输入 HTTPS 的 Doca 根地址，本机开发可用 HTTP。", {
      exact: true,
    })
    .waitFor();
  await ui.fill("#endpoint", "http://localhost:39474/");
  await ui.locator("#endpoint-form button").click();
  await ui.getByText("已连接", { exact: true }).waitFor();
  await ui.screenshot({
    path: "/artifacts/extension-connection.png",
    fullPage: true,
  });
  await settings.reload();
  await settings.getByRole("tab", { name: "浏览器连接", exact: true }).click();
  await settings
    .getByRole("button", { name: "撤销全部连接", exact: true })
    .click();
  await settings.getByRole("button", { name: "撤销授权", exact: true }).click();
  await settings.getByText("浏览器授权已撤销", { exact: true }).waitFor();
  const revoked = await ui.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "state" }),
  );
  assert(revoked.ok && !revoked.value.connected);
  assert.equal(revoked.value.error, "clipper_connection_revoked");
  const rejected = await ui.evaluate(
    async ({ tabId, profileId }) =>
      await chrome.runtime.sendMessage({
        type: "capture",
        mode: "page",
        tabId,
        profileId,
        profileRevision: 1,
      }),
    { tabId: sourceTab.id, profileId: process.env.DOCA_QA_PROFILE },
  );
  assert(!rejected.ok);
  assert.equal(rejected.error, "clipper_connection_revoked");
  await firstReplica.reload();
  await waitBody(firstReplica, "接线端子松动");
  const report = {
    status: "passed",
    browserVersion: context.browser()?.version(),
    followsWebsiteLogin: true,
    loginPromptAndReturn: true,
    websiteLogoutDisconnects: true,
    accountSwitchIsolatesDrafts: true,
    editableServerAddress: true,
    automaticShortTokenRenewal: true,
    selectionToolbar: true,
    wholePage: true,
    originalImageTransfer: true,
    appendBroadcastToTwoReplicas: true,
    assistantConversation: true,
    publicSiteConfiguration: true,
    invalidConfigPreservesConnection: true,
    keyRotationRejectsOldToken: true,
    revokeAllThroughSettings: true,
    oldTokenRejected: true,
    savedDocumentRetained: true,
    pageErrors: errors,
  };
  await writeFile(
    "/artifacts/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  await context.close();
  await Promise.all(
    proxies.map((proxy) => new Promise((resolve) => proxy.close(resolve))),
  );
}
