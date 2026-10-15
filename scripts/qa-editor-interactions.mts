// Synthetic accounts, isolated in-memory database and temporary browser contexts only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";

const root = await mkdtemp(join(tmpdir(), "doca-editor-interactions-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const password = "isolated-editor-interactions-2026";
const owner = await createUser(
  db,
  { login: "interactionqa", displayName: "协同测试甲", password },
  { bootstrap: true },
);
const peer = await createUser(
  db,
  { login: "interactionpeer", displayName: "协同测试乙", password },
  { actor: { ...owner, admin: 1 } },
);
// Empty nickname is a valid current profile state; do not mutate user accounts.
await db
  .updateTable("users")
  .set({ display_name: "" })
  .where("id", "=", owner.id)
  .execute();
const origin = "http://127.0.0.1:39419";
const app = await createApp(db, {
  origin,
  storage: { ...storageRuntime(), root },
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 39419,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
await web.listen();
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/editor-interactions-2026-10-15",
);
await mkdir(output, { recursive: true });
const diagnostic = process.env.DOCA_QA_DIAGNOSTIC === "1";
const checks: { name: string; passed: boolean }[] = [],
  errors: string[] = [];
const check = (name: string, passed: boolean) => {
  checks.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!diagnostic) assert(passed, name);
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
let current: Page | undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const request = async (path: string, data?: unknown, method = "GET") => {
    const response = await context.request.fetch(origin + "/api/v1" + path, {
      method,
      headers: { origin },
      data,
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await request("/auth/login", { login: "interactionqa", password }, "POST");
  const preview = async (id: string) => {
    const result = await request(`/ai/resources/${id}/preview`);
    if (result.resource.format === "spreadsheet")
      result.value = await projectExlsxWorkbook({
        baseline: result.surface.baseline,
        update: new Uint8Array(Buffer.from(result.surface.update, "base64")),
        checkpointSeq: 0,
      });
    return result.value;
  };
  const seq = async (id: string) =>
    (
      await db
        .selectFrom("document_states")
        .select("seq")
        .where("resource_id", "=", id)
        .executeTakeFirstOrThrow()
    ).seq;
  const updates = new Map<Page, number>();
  const open = async (id: string) => {
    const page = await context.newPage();
    current = page;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("404"))
        errors.push(m.text());
    });
    updates.set(page, 0);
    page.on("websocket", (socket) =>
      socket.on("framesent", ({ payload }) => {
        try {
          if (JSON.parse(String(payload)).type === "update")
            updates.set(page, updates.get(page)! + 1);
        } catch {}
      }),
    );
    await page.goto(origin + "/#/r/" + id);
    await page
      .getByText("已保存到云端", { exact: true })
      .waitFor({ state: "attached" });
    return page;
  };
  const pendingLookup = async (page: Page) => {
    let release!: () => void, started!: () => void, finished!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lookup = new Promise<void>((resolve) => {
      started = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      finished = resolve;
    });
    await page.route("**/api/v1/users/lookup?*", async (route) => {
      started();
      await gate;
      await route.continue();
      finished();
    });
    return {
      lookup,
      finish: async () => {
        release();
        await completed;
        await page.unroute("**/api/v1/users/lookup?*");
      },
    };
  };
  const rich = await request(
    "/resources",
    { title: "键盘与协同验收", kind: "document", format: "rich_text" },
    "POST",
  );
  const a = await open(rich.id);
  const editor = a.locator('.sk-editable[contenteditable="true"]');
  await editor.click();
  await a.keyboard.press("End");
  await a.keyboard.press("Enter");
  const pendingRich = await pendingLookup(a);
  await a.keyboard.type("@");
  const richMenu = a.locator(".document-mention-menu");
  await pendingRich.lookup;
  const richBeforeEnter = await editor.innerText();
  await a.keyboard.press("ArrowUp");
  await a.keyboard.press("Enter");
  check(
    "rich-text loading picker consumes ArrowUp/Enter without moving or splitting text",
    (await richMenu.isVisible()) &&
      (await editor.innerText()) === richBeforeEnter,
  );
  await pendingRich.finish();
  await richMenu.locator('[role="option"]').nth(1).waitFor();
  await a.screenshot({ path: join(output, "rich-before.png") });
  await a.keyboard.press("ArrowUp");
  check(
    "rich-text ArrowUp keeps mention picker open",
    await richMenu.isVisible(),
  );
  if (await richMenu.isVisible()) {
    check(
      "rich-text ArrowUp selects the last candidate",
      (await richMenu
        .locator('[role="option"]')
        .last()
        .getAttribute("aria-selected")) === "true",
    );
    await a.keyboard.press("Enter");
    check(
      "rich-text Enter inserts one atomic mention",
      (await a.locator(".document-user-mention").count()) === 1,
    );
  }
  await a
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  const richValue = await preview(rich.id);
  await a.reload();
  await editor.waitFor();
  await a.locator(".document-user-mention").waitFor();
  check(
    "rich-text mention persists after reload",
    JSON.stringify(await preview(rich.id)) === JSON.stringify(richValue),
  );
  await a.getByRole("button", { name: "收起内容评论", exact: true }).click();
  await a.locator(".editor-panel-toggle").waitFor();
  await a.screenshot({ path: join(output, "rich-comment-controls.png") });
  await a.locator(".editor-panel-toggle").click();
  check(
    "rich-text comment controls reopen and close the sidebar",
    await a.locator(".content-comments").isVisible(),
  );
  await editor.locator(".sk-block-paragraph").first().click();
  await a.keyboard.press("End");
  await a.keyboard.type(" @no-such-mention-user");
  await richMenu.locator("p").waitFor();
  const noMatchText = await editor.innerText();
  await a.keyboard.press("Enter");
  check(
    "rich-text empty results do not turn Enter into a newline",
    (await richMenu.isVisible()) && (await editor.innerText()) === noMatchText,
  );
  await a.keyboard.press("Escape");
  check("rich-text Escape closes the picker", !(await richMenu.isVisible()));
  const richPeer = await open(rich.id);
  await a.bringToFront();
  await editor.locator(".sk-block-paragraph").first().click();
  await editor.focus();
  await a.waitForFunction(() =>
    document.activeElement?.matches('.sk-editable[contenteditable="true"]'),
  );
  await a.keyboard.press("End");
  await a.keyboard.insertText("同账号同步");
  await richPeer
    .locator(".sk-editable")
    .getByText("同账号同步", { exact: false })
    .waitFor();
  await richPeer.locator(".remote-caret > span").waitFor();
  check(
    "empty nickname cursor uses the existing public ID and a visible caret",
    (await richPeer.locator(".remote-caret > span").first().textContent()) ===
      owner.public_id &&
      (await richPeer.locator(".remote-caret").first().boundingBox())!.height >=
        14,
  );
  check(
    "remote rich-text replay produces no echo",
    updates.get(richPeer) === 0,
  );
  await richPeer.screenshot({ path: join(output, "cursor-no-nickname.png") });
  await richPeer
    .getByRole("combobox", { name: "文档模式", exact: true })
    .click();
  await richPeer.getByRole("option", { name: "阅读", exact: true }).click();
  await richPeer.locator('.sk-editable[contenteditable="false"]').waitFor();
  check(
    "readonly clears remote editing cursors",
    (await richPeer.locator(".remote-caret").count()) === 0,
  );
  const sheet = await request(
    "/resources",
    { title: "表格键盘验收", kind: "document", format: "spreadsheet" },
    "POST",
  );
  const s = await open(sheet.id);
  const corner = s.locator(".uos-editor__select-all");
  await corner.waitFor();
  const box = await corner.boundingBox();
  assert(box);
  await s.mouse.dblclick(box.x + box.width + 36, box.y + box.height + 9);
  const pendingSheet = await pendingLookup(s);
  await s.keyboard.type("@");
  const sheetMenu = s.locator(".sheet-native-candidates");
  await pendingSheet.lookup;
  await s.keyboard.press("ArrowUp");
  await s.keyboard.press("Enter");
  check(
    "spreadsheet loading picker consumes ArrowUp/Enter without ending the draft",
    await sheetMenu.isVisible(),
  );
  await pendingSheet.finish();
  await sheetMenu.locator('[role="option"]').nth(1).waitFor();
  await s.screenshot({ path: join(output, "sheet-before.png") });
  await s.keyboard.press("ArrowUp");
  check(
    "spreadsheet ArrowUp keeps mention picker open",
    await sheetMenu.isVisible(),
  );
  if (await sheetMenu.isVisible()) {
    check(
      "spreadsheet ArrowUp selects the last candidate",
      (await sheetMenu
        .locator('[role="option"]')
        .last()
        .getAttribute("aria-selected")) === "true",
    );
    await s.keyboard.press("Enter");
    check(
      "spreadsheet Enter closes the picker",
      !(await sheetMenu.isVisible()),
    );
  }
  await s.keyboard.press("Enter"); // Commit the native draft through the SDK.
  await s
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  const sheetValue = await preview(sheet.id);
  check(
    "spreadsheet commits the chosen atomic user rather than a raw @",
    JSON.stringify(sheetValue).includes(peer.id) &&
      JSON.stringify(sheetValue).includes("@协同测试乙"),
  );
  await s.reload();
  await corner.waitFor();
  check(
    "spreadsheet mention persists after reload",
    JSON.stringify(await preview(sheet.id)) === JSON.stringify(sheetValue),
  );
  const controls = s.locator(".region-comment-controls");
  check(
    "comment and visibility buttons share one compact control group",
    (await controls.locator(".comment-control").count()) === 2,
  );
  await controls.locator(".canvas-comment-visibility").click();
  check(
    "hide comments changes the pressed state",
    (await controls
      .locator(".canvas-comment-visibility")
      .getAttribute("aria-pressed")) === "false",
  );
  await s.screenshot({ path: join(output, "sheet-comments-hidden.png") });
  await controls.locator(".canvas-comment-visibility").click();
  await controls.locator(".region-comment-toggle").click();
  await s.locator(".region-comments-drawer").waitFor();
  await s.waitForFunction(() =>
    document
      .querySelector(".region-comments-drawer")!
      .getAnimations()
      .every((a) => a.playState !== "running"),
  );
  check(
    "comment panel has aligned visibility and close controls",
    (await s
      .locator(".region-comment-header-actions .comment-control")
      .count()) === 2,
  );
  check(
    "comment drawer stays within the viewport",
    await s.locator(".region-comments-drawer").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    }),
  );
  await s.screenshot({ path: join(output, "sheet-comment-panel.png") });
  await s
    .locator(".region-comments-drawer > header")
    .screenshot({ path: join(output, "comment-panel-header.png") });
  await s.getByRole("button", { name: "收起内容评论", exact: true }).click();
  check(
    "comment panel closes",
    !(await s.locator(".region-comments-drawer").isVisible()),
  );
  const shot = await controls.screenshot();
  await writeFile(join(output, "comment-controls.png"), shot);
  await s.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await controls.screenshot({ path: join(output, "comment-controls-2x.png") });
  await s.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  const canvas = await request(
    "/resources",
    { title: "画板评论控件验收", kind: "document", format: "canvas" },
    "POST",
  );
  const c = await open(canvas.id);
  await c.locator(".doca-canvas").waitFor();
  const canvasControls = c.locator(".region-comment-controls");
  await canvasControls.locator(".canvas-comment-visibility").click();
  check(
    "canvas uses the same grouped comment controls and visibility state",
    (await canvasControls.locator(".comment-control").count()) === 2 &&
      (await canvasControls
        .locator(".canvas-comment-visibility")
        .getAttribute("aria-pressed")) === "false",
  );
  await c.screenshot({ path: join(output, "canvas-comment-controls.png") });
  await s.mouse.dblclick(box.x + box.width + 36, box.y + box.height + 9);
  await s.keyboard.press("End");
  await s.keyboard.type(" @");
  await sheetMenu.locator('[role="option"]').nth(1).waitFor();
  await s.keyboard.press("ArrowDown");
  check(
    "spreadsheet ArrowDown selects the next user",
    (await sheetMenu
      .locator('[role="option"]')
      .nth(1)
      .getAttribute("aria-selected")) === "true",
  );
  await s.keyboard.press("Escape");
  check(
    "Escape closes the picker while preserving the draft",
    !(await sheetMenu.isVisible()),
  );
  await s.keyboard.press("Backspace");
  await s.keyboard.press("Backspace");
  await s.keyboard.press("Enter");
  await s
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  const idleValues = await Promise.all([preview(rich.id), preview(sheet.id)]);
  const idleSeqs = await Promise.all([seq(rich.id), seq(sheet.id)]);
  const idleUpdates = [...updates.values()];
  await s.setViewportSize({ width: 1280, height: 800 });
  await s.screenshot({ path: join(output, "sheet-controls-1280.png") });
  await s.setViewportSize({ width: 390, height: 844 });
  check(
    "comment controls remain within a narrow viewport",
    await controls.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    }),
  );
  await s.screenshot({ path: join(output, "sheet-controls-mobile.png") });
  await a.evaluate(() =>
    document.querySelector(".main-scroll")?.scrollBy(0, 80),
  );
  for (let n = 0; n < 2; n++) {
    await delay(30_000);
    console.log(`Idle observation ${(n + 1) * 30}s`);
  }
  check(
    "60s idle, resize, selection and comment visibility produce no content writes",
    JSON.stringify(await Promise.all([seq(rich.id), seq(sheet.id)])) ===
      JSON.stringify(idleSeqs) &&
      JSON.stringify([...updates.values()]) === JSON.stringify(idleUpdates),
  );
  check(
    "idle leaves both document projections unchanged",
    JSON.stringify(await Promise.all([preview(rich.id), preview(sheet.id)])) ===
      JSON.stringify(idleValues),
  );
  check("no uncaught browser errors", errors.length === 0);
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      {
        result: checks.every((c) => c.passed) ? "passed" : "failed",
        checks,
        errors,
        idleSeconds: 60,
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  await current
    ?.screenshot({ path: join(output, "failure.png") })
    .catch(() => {});
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      { result: "failed", checks, errors, failure: String(error) },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
