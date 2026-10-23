// Real MV3 capture transport with a synthetic server, isolated storage and no model calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const output = resolve(
  process.argv[2] ?? "artifacts/verification/browser-extension-navigation",
);
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, "run-"));
const extension = join(root, "extension");
await mkdir(extension);
const source = fileURLToPath(
  new URL("../apps/browser-extension/", import.meta.url),
);
for (const name of [
  "manifest.json",
  "background.js",
  "capture.js",
  "select.js",
  "content.js",
  "login-bridge.js",
  "icon.png",
  "connection.json",
])
  await copyFile(join(source, name), join(extension, name));
if (process.env.DOCA_QA_BACKGROUND_SOURCE)
  await copyFile(
    resolve(process.env.DOCA_QA_BACKGROUND_SOURCE),
    join(extension, "background.js"),
  );
// Keep the production background/content scripts and sender checks; omit unrelated chat startup.
await writeFile(
  join(extension, "ui.html"),
  "<!doctype html><title>Navigation capture fixture</title><body>Isolated capture transport</body>",
);
const connectionId = randomUUID(),
  profileId = randomUUID(),
  sessionId = randomUUID();
const clips = new Map(),
  sends = [],
  pageLoads = new Map(),
  held = new Set();
const server = createServer(async (req, res) => {
  if (req.url === "/hold.js") {
    held.add(res);
    return;
  }
  if (!req.url.startsWith("/api/")) {
    const marker =
      req.url === "/one"
        ? "PAGE_ONE"
        : req.url === "/two"
          ? "PAGE_TWO"
          : "PAGE_THREE";
    pageLoads.set(req.url, (pageLoads.get(req.url) ?? 0) + 1);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><title>${marker}</title><body><article id="article">${marker} current material</article>${req.url === "/two" ? '<script src="/hold.js"></script>' : ""}</body>`,
    );
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
  let result = {};
  if (req.url.endsWith("/profiles"))
    result = {
      items: [{ id: profileId, revision: 1, name: "Fixture", isDefault: true }],
    };
  else if (req.url.endsWith("/clips")) {
    assert(!clips.has(body.requestId), "A capture must be prepared only once");
    clips.set(body.requestId, body);
    result = { status: "pending", uploadedImageIds: [] };
  } else if (req.url.endsWith("/messages")) {
    assert.equal(
      req.url,
      `/api/v1/browser-clipper/assistant/ui/sessions/${sessionId}/messages`,
    );
    assert(
      clips.has(body.captureRequestId),
      "Sending requires prepared current-page material",
    );
    sends.push(body);
    result = { id: body.id };
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
const errors = [];
const release = () => {
  for (const res of held) res.end("// Parser released by the fixture.");
  held.clear();
};
try {
  context = await chromium.launchPersistentContext(
    join(root, "browser-profile"),
    {
      executablePath: chromium.executablePath(),
      headless: true,
      args: [
        "--disable-extensions-except=" + extension,
        "--load-extension=" + extension,
      ],
    },
  );
  context.setDefaultTimeout(15000);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  // Chrome-extension URLs have a null URL.origin in Node.
  const extensionUrl = "chrome-extension://" + new URL(worker.url()).hostname;
  const ui = await context.newPage();
  ui.on("pageerror", (error) => errors.push(error.message));
  await ui.goto(extensionUrl + "/ui.html");
  await ui.evaluate(
    async ({ origin, connectionId }) => {
      await chrome.storage.local.set({ site: { version: 2, origin } });
      await chrome.storage.session.set({
        authorization: {
          version: 2,
          origin,
          connectionId,
          token: "doca_browser_v2_" + "1".repeat(64),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
    },
    { origin, connectionId },
  );
  const page = await context.newPage();
  const tabId = async () =>
    ui.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
      page.url(),
    );
  const prepareAndSend = async (marker, id) => {
    const result = await ui.evaluate(
      (message) => chrome.runtime.sendMessage(message),
      {
        type: "assistantPreparePage",
        origin,
        connectionId,
        profileId,
        profileRevision: 1,
        tabId: id,
      },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const clip = clips.get(result.value.captureRequestId);
    assert(
      clip.markdown.replaceAll("\\_", "_").includes(marker),
      "Capture must use the current page",
    );
    assert.equal(clip.url, page.url());
    const sent = await ui.evaluate(
      (message) => chrome.runtime.sendMessage(message),
      {
        type: "assistantRequest",
        origin,
        connectionId,
        method: "POST",
        path: `/assistant/ui/sessions/${sessionId}/messages`,
        body: {
          id: randomUUID(),
          modelId: "fixture",
          text: "Analyze " + marker,
          captureRequestId: result.value.captureRequestId,
        },
      },
    );
    assert.equal(sent.ok, true, JSON.stringify(sent));
    return clip;
  };
  await page.goto(origin + "/one");
  const firstTab = await tabId();
  await prepareAndSend("PAGE_ONE", firstTab);
  await page.goto(origin + "/two", { waitUntil: "commit" });
  await page.locator("#article").waitFor();
  const readyState = await page.evaluate(() => document.readyState);
  assert.equal(
    readyState,
    "loading",
    "The parser must still be waiting before document_idle",
  );
  const before = await ui.evaluate(async (id) => {
    try {
      return await chrome.tabs.sendMessage(
        id,
        { type: "snapshot", mode: "page" },
        { frameId: 0 },
      );
    } catch {
      return null;
    }
  }, firstTab);
  assert(!before, "Reproduce the missing receiver after navigation");
  await prepareAndSend("PAGE_TWO", firstTab);
  assert.equal(
    await page.evaluate(() => document.readyState),
    "loading",
    "Recovery must finish without a reload or waiting for document_idle",
  );
  release();
  await page.waitForLoadState("load");
  // The automatic document_idle scripts now run after the recovery injection.
  await page.evaluate(() => {
    history.pushState({}, "", "/two/spa");
    document.querySelector("#article").textContent =
      "SPA_CURRENT current material";
  });
  await prepareAndSend("SPA_CURRENT", firstTab);
  await page.screenshot({ path: join(root, "recovered-page.png") });
  const next = await context.newPage();
  await next.goto(origin + "/three");
  // Keep the preparation assertion tied to this newly selected page.
  const thirdId = await ui.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
    next.url(),
  );
  const third = await ui.evaluate(
    (message) => chrome.runtime.sendMessage(message),
    {
      type: "assistantPreparePage",
      origin,
      connectionId,
      profileId,
      profileRevision: 1,
      tabId: thirdId,
    },
  );
  assert.equal(third.ok, true, JSON.stringify(third));
  assert(
    clips
      .get(third.value.captureRequestId)
      .markdown.replaceAll("\\_", "_")
      .includes("PAGE_THREE"),
  );
  assert.equal(
    pageLoads.get("/two"),
    1,
    "Navigation recovery must never reload the user's page",
  );
  assert.equal(sends.length, 3, "Each send must submit exactly once");
  assert.equal(clips.size, 4);
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    browser: "real Chromium MV3",
    syntheticServer: true,
    realModelProvider: false,
    missingReceiverReproduced: true,
    recoveredBeforeDocumentIdle: true,
    pageReloads: 0,
    sends: sends.length,
    sameConversation: true,
    markers: ["PAGE_ONE", "PAGE_TWO", "SPA_CURRENT", "PAGE_THREE"],
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, artifacts: root }));
} catch (error) {
  await writeFile(
    join(root, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        stack: error.stack,
        errors,
        sends,
        clips: [...clips.values()],
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  release();
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
}
