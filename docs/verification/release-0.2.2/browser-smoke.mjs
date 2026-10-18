// Verify the built Web application using synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { openDatabase } from "../../../packages/db/src/index.ts";
import { createUser } from "../../../packages/core/src/modules/identity/passwords.ts";
import { createContent } from "../../../packages/core/src/workflows/resources.ts";

const root = await mkdtemp(join(tmpdir(), "doca-release022-browser-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1, stores: { local: { provider: "local", root } },
});
const { createApp } = await import("../../../apps/server/src/app/create-app.ts");
const { storageRuntime } = await import("../../../apps/server/src/adapters/storage.ts");
const probe = createServer();
await new Promise((done, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", done); });
const { port } = probe.address();
await new Promise((done, reject) => probe.close(error => error ? reject(error) : done()));
const origin = `http://127.0.0.1:${port}`;
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
let app, browser;
const checks = [];
try {
  const user = await createUser(db, {
    login: "release-browser", displayName: "Release browser QA",
    password: "isolated-release-browser-password",
  }, { bootstrap: true });
  const content = createContent(db), actor = { ...user, admin: 1 };
  const book = await content.create(actor, { kind: "document", format: "rich_text", title: "📚 doca问题跟进" });
  const rocket = await content.create(actor, { kind: "document", format: "canvas", title: "🚀 基础信息" });
  const plain = await content.create(actor, { kind: "document", format: "rich_text", title: "普通文档" });
  const before = await db.selectFrom("document_states").selectAll().where("resource_id", "in", [book.id, rocket.id, plain.id]).orderBy("resource_id").execute();
  app = await createApp(db, {
    origin, staticDirectory: resolve("apps/web/dist"),
    storage: { ...storageRuntime(), root },
    ai: { memory: { driver: "sqlite", url: ":memory:" } },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(origin + "/api/v1/auth/login", {
    headers: { origin }, data: { login: "release-browser", password: "isolated-release-browser-password" },
  });
  assert.equal(login.status(), 200, await login.text());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const favicon = async (emoji) => {
    await page.waitForFunction(emoji => {
      const href = document.querySelector('link[rel="icon"]')?.href;
      return emoji
        ? href?.startsWith("data:image/svg+xml,") && decodeURIComponent(href).includes(`>${emoji}</text>`)
        : href === location.origin + "/favicon.svg";
    }, emoji, { timeout: 20000 });
  };
  await page.goto(origin + `/#/r/${book.id}`);
  await favicon("📚");
  assert.equal(await page.title(), "📚 doca问题跟进");
  checks.push("built Web opens a book title with its matching tab icon");
  await page.evaluate(id => { location.hash = `/r/${id}`; }, rocket.id);
  await favicon("🚀");
  checks.push("client-side navigation replaces the previous emoji icon");
  await page.locator(".document-title-edit").click();
  await page.locator(".document-name-field .title-icon-picker summary").click();
  await page.locator(".document-name-field .title-icon-remove").click();
  await page.getByRole("textbox", { name: "修改文档标题", exact: true }).press("Enter");
  await favicon(null);
  await page.waitForFunction(() => document.title === "基础信息");
  checks.push("removing the emoji through the real title editor restores the site icon");
  await page.evaluate(id => { location.hash = `/r/${id}`; }, plain.id);
  await favicon(null);
  await page.waitForFunction(() => document.title === "普通文档");
  checks.push("ordinary titles keep the site icon");
  await page.evaluate(id => { location.hash = `/r/${id}`; }, book.id);
  await favicon("📚");
  await page.reload();
  await favicon("📚");
  checks.push("refresh restores the emoji icon from the current document title");
  await page.evaluate(() => { location.hash = "/home"; });
  await favicon(null);
  checks.push("leaving the document restores the site icon");
  const after = await db.selectFrom("document_states").selectAll().where("resource_id", "in", [book.id, rocket.id, plain.id]).orderBy("resource_id").execute();
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  checks.push("opening, navigation and title metadata edits preserve original content checkpoints");
  await mkdir("artifacts/release-0.2.2", { recursive: true });
  const result = { passed: true, builtWeb: true, checks, pageErrors: errors };
  await writeFile("artifacts/release-0.2.2/browser.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await app?.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
