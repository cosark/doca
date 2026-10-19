if (process.env.DOCA_QA_ISOLATED !== "1") throw Error("Disposable MCP UI only");
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const fixture = require("../.cache/qa-mcp.json");
assert.equal(fixture.origin, "http://127.0.0.1:39472");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const login = await context.request.post(
    fixture.origin + "/api/v1/auth/login",
    {
      headers: { origin: fixture.origin },
      data: { login: "mcpadmin", password: fixture.password },
    },
  );
  assert.equal(login.status(), 200, await login.text());
  const page = await context.newPage(),
    errors = [],
    output = path.resolve("docs/verification/mcp-2026-10-20");
  await fs.mkdir(output, { recursive: true });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(fixture.origin + "/#/mcp");
    await page
      .getByRole("heading", { name: "MCP 服务", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "添加 MCP 服务", exact: true })
      .waitFor({ state: "visible" });
    const master = page.getByRole("switch", {
      name: "开启个人 MCP",
      exact: true,
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('.mcp-master [role="switch"]')
          ?.getAttribute("aria-checked") === "true" &&
        !document.querySelector('.mcp-master [role="switch"]')?.disabled,
    );
    assert(await master.isChecked());
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/me/mcp") &&
          response.request().method() === "GET",
      ),
      master.click(),
    ]);
    await page.reload();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.mcp-master [role="switch"]')
          ?.getAttribute("aria-checked") === "false" &&
        !document.querySelector('.mcp-master [role="switch"]')?.disabled,
    );
    assert.equal(await master.isChecked(), false);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/me/mcp") &&
          response.request().method() === "GET",
      ),
      master.click(),
    ]);
    await page.reload();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.mcp-master [role="switch"]')
          ?.getAttribute("aria-checked") === "true" &&
        !document.querySelector('.mcp-master [role="switch"]')?.disabled,
    );
    assert(await master.isChecked());
    async function assertLayout(targetPage = page) {
      const boxes = await targetPage.evaluate(() => {
        const nav = document
          .querySelector(".personal-settings-nav")
          .getBoundingClientRect();
        const card = document
          .querySelector(".mcp-settings")
          .getBoundingClientRect();
        const heading = document
          .querySelector(".mcp-heading h2")
          .getBoundingClientRect();
        const main = document.querySelector(".personal-settings-content");
        return {
          nav: { right: nav.right, bottom: nav.bottom },
          card: { x: card.x, y: card.y, right: card.right },
          heading: { x: heading.x, right: heading.right },
          overflow: main.scrollWidth > main.clientWidth,
          width: innerWidth,
        };
      });
      assert(
        boxes.card.x >= boxes.nav.right || boxes.card.y >= boxes.nav.bottom,
        JSON.stringify(boxes),
      );
      assert(
        boxes.heading.x > boxes.card.x &&
          boxes.heading.right <= boxes.card.right,
        JSON.stringify(boxes),
      );
      assert.equal(boxes.overflow, false, JSON.stringify(boxes));
    }
    await assertLayout();
    await page.screenshot({
      path: path.join(output, "personal-services.png"),
      fullPage: true,
      animations: "disabled",
    });
    const rounds = [],
      runId = Date.now();
    for (let index = 1; index <= 3; index++) {
      const name = `UI 自动验收服务 ${runId}-${index}`;
      await page
        .getByRole("button", { name: "添加 MCP 服务", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "添加 MCP 服务",
        exact: true,
      });
      await dialog.getByLabel("服务名称", { exact: true }).fill(name);
      const enabled = dialog.getByRole("switch", {
        name: "开启此服务",
        exact: true,
      });
      assert(await enabled.isChecked());
      await enabled.click();
      assert.equal(await enabled.isChecked(), false);
      await enabled.click();
      await dialog
        .locator(".mcp-grant")
        .filter({
          has: page.locator("strong").filter({ hasText: /^document_create$/ }),
        })
        .getByRole("checkbox")
        .check();
      if (index === 1) {
        await page.route(
          "**/api/v1/me/mcp-services",
          (route) =>
            route.request().method() === "POST"
              ? route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({
                    message: "Injected acceptance failure",
                  }),
                })
              : route.continue(),
          { times: 1 },
        );
        await dialog
          .getByRole("button", { name: "保存服务", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Injected acceptance failure" })
          .first()
          .waitFor();
        assert.equal(
          await dialog.getByLabel("服务名称", { exact: true }).inputValue(),
          name,
        );
        assert(
          await dialog
            .locator(".mcp-grant")
            .filter({
              has: page
                .locator("strong")
                .filter({ hasText: /^document_create$/ }),
            })
            .getByRole("checkbox")
            .isChecked(),
        );
      }
      await dialog
        .getByRole("button", { name: "保存服务", exact: true })
        .click();
      const tokenDialog = page.getByRole("dialog", {
        name: "保存访问 token",
        exact: true,
      });
      await tokenDialog.waitFor();
      const token = await tokenDialog.locator(".mcp-token code").textContent();
      assert(/^doca_mcp_v1_[a-f0-9]{64}$/.test(token));
      const prompt = tokenDialog
        .locator(".mcp-code")
        .filter({ hasText: "让 AI 安装的一句话" });
      await prompt.getByRole("button", { name: "复制", exact: true }).click();
      const clipboard = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      assert(clipboard.includes(fixture.origin + "/api/v1/mcp"));
      assert(clipboard.includes("--bearer-token-env-var DOCA_MCP_TOKEN_"));
      assert(!clipboard.includes(token));
      await tokenDialog
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.reload();
      const row = page
        .locator(".mcp-service")
        .filter({ has: page.getByRole("heading", { name: new RegExp(name) }) });
      await row.waitFor();
      assert(!(await page.locator("body").textContent()).includes(token));
      await row.getByRole("button", { name: "编辑服务", exact: true }).click();
      const editor = page.getByRole("dialog", {
        name: "编辑服务",
        exact: true,
      });
      await editor
        .getByRole("combobox", { name: "开放能力", exact: true })
        .click();
      await page.getByRole("option", { name: "全部能力", exact: true }).click();
      await editor
        .getByRole("button", { name: "保存服务", exact: true })
        .click();
      await editor.waitFor({ state: "hidden" });
      await row.getByText("全部能力", { exact: false }).waitFor();
      await row.locator("summary").click();
      assert((await row.textContent()).includes("config.toml"));
      rounds.push({
        round: index,
        created: true,
        failurePreservedDraft: index === 1,
        refreshed: true,
        grantEdited: true,
        copiedAiInstallPrompt: true,
        tokenNotPersistedInUi: true,
      });
    }
    await page.goto(fixture.origin + "/#/admin?tab=mcp");
    await page
      .getByRole("heading", { name: "公司 MCP 服务", exact: true })
      .waitFor();
    const company = page
      .locator(".mcp-service")
      .filter({ has: page.getByRole("heading", { name: /公司测试平台/ }) });
    await company.locator("summary").click();
    assert((await company.textContent()).includes("TARGET_USER_UUID"));
    assert(
      (await company.textContent()).includes(
        "每次 doca_* 操作都必须传目标 userId",
      ),
    );
    await page.screenshot({
      path: path.join(output, "admin-service-examples.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto(fixture.origin + "/#/mcp");
    await page.setViewportSize({ width: 700, height: 1000 });
    await page
      .getByRole("heading", { name: "MCP 服务", exact: true })
      .waitFor();
    await assertLayout();
    await page.screenshot({
      path: path.join(output, "personal-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const zoomContext = await browser.newContext({
      storageState: await context.storageState(),
      viewport: { width: 720, height: 500 },
      deviceScaleFactor: 2,
    });
    const zoomPage = await zoomContext.newPage();
    await zoomPage.goto(fixture.origin + "/#/mcp");
    await zoomPage
      .getByRole("switch", { name: "开启个人 MCP", exact: true })
      .waitFor();
    await assertLayout(zoomPage);
    await zoomPage.screenshot({
      path: path.join(output, "personal-zoom-200.png"),
      fullPage: true,
      animations: "disabled",
    });
    await zoomContext.close();
    const artifacts = JSON.parse(
      await fs.readFile(path.join(output, "http-client.json"), "utf8"),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const doc of artifacts.documents) {
      await page.goto(doc.url);
      await page
        .locator(
          ".document-editor,.surface-editor,.spreadsheet-editor,.presentation-editor,.canvas-editor,[data-slate-editor]",
        )
        .first()
        .waitFor({ state: "visible", timeout: 20000 });
      await page
        .getByText(/正在加载工作簿|正在加载表格|Loading workbook/)
        .first()
        .waitFor({ state: "hidden", timeout: 30000 });
      if (doc.format === "spreadsheet")
        await page
          .locator(".sheet-document canvas")
          .first()
          .waitFor({ state: "visible" });
      await page.screenshot({
        path: path.join(output, `native-${doc.format}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      rounds,
      adminExamples: true,
      responsive: true,
      zoom200: true,
      switchPersisted: true,
      nativeScreenshots: artifacts.documents.map((doc) => doc.format),
      pageErrors: errors,
    };
    await fs.writeFile(
      path.join(output, "browser.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
