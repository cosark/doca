// Real host + browser acceptance using only synthetic accounts and in-memory data.
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

const root = await mkdtemp(join(tmpdir(), "doca-editor-upgrade-"));
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
const qaAccount = await createUser(
  db,
  {
    login: "editorupgrade",
    displayName: "Editor upgrade QA",
    password: "isolated-editor-upgrade-2026",
  },
  { bootstrap: true },
);
const origin = "http://127.0.0.1:39429";
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
    port: 39429,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/resource-metadata-2026-10-18",
);
await mkdir(output, { recursive: true });
const checks: string[] = [],
  errors: string[] = [];
const pass = (label: string) => {
  checks.push(label);
  console.log("PASS " + label);
};
const until = async (predicate: () => Promise<boolean>, label: string) => {
  for (let n = 0; n < 100; n++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
};
let diagnosticPage: Page | undefined;
await web.listen();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
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
  const preview = async (id: string) => {
    const data = await request(`/ai/resources/${id}/preview`);
    const state = await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", id)
      .executeTakeFirstOrThrow();
    return { ...data, seq: state.seq };
  };
  await request(
    "/auth/login",
    { login: "editorupgrade", password: "isolated-editor-upgrade-2026" },
    "POST",
  );
  const watch = async () => {
    const page = await context.newPage(),
      updates: any[] = [],
      received: any[] = [];
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        try {
          received.push(JSON.parse(String(payload)));
        } catch {}
      });
      socket.on("framesent", ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.type === "update") updates.push(frame);
        } catch {}
      });
    });
    return { page, updates, received };
  };
  const saved = async (page: Page) =>
    page
      .getByText(/(?:^| · )已保存到云端$/)
      .last()
      .waitFor({ state: "attached" });
  const { createContent } =
    await import("../packages/core/src/workflows/resources.js");
  const content = createContent(db),
    owner = { ...qaAccount, admin: 1 };
  const member = await createUser(
    db,
    {
      login: "metadatamember",
      displayName: "协作成员",
      password: "isolated-metadata-member",
    },
    { actor: owner },
  );
  const privateDoc = await request(
    "/resources",
    { title: "📝 产品观察", kind: "document", format: "rich_text" },
    "POST",
  );
  const collaborative = await request(
    "/resources",
    { title: "📊 项目节奏", kind: "document", format: "canvas" },
    "POST",
  );
  const publicDoc = await request(
    "/resources",
    { title: "🌱 团队知识索引", kind: "document", format: "markdown" },
    "POST",
  );
  await content.permissions(owner, collaborative.id, {
    version: collaborative.version,
    accessMode: "custom",
    visibility: "invited",
    grants: [{ userId: member.id, role: "editor" }],
  });
  await content.permissions(owner, publicDoc.id, {
    version: publicDoc.version,
    accessMode: "custom",
    visibility: "authenticated",
    grants: [],
  });
  for (const doc of [privateDoc, collaborative, publicDoc])
    await content.visit(owner, doc.id);
  const watched = await watch(),
    page = watched.page;
  diagnosticPage = page;
  const states = [
    [privateDoc, "private", "产品观察"],
    [collaborative, "collaborative", "项目节奏"],
    [publicDoc, "public", "团队知识索引"],
  ] as const;
  await page.goto(origin + "/#/home");
  for (const [doc, state, title] of states) {
    const row = page
      .locator(".workspace-recent > div")
      .filter({ has: page.locator(`a[href="#/r/${doc.id}"]`) });
    await row.locator(`[data-access-state="${state}"]`).waitFor();
    assert.equal(await row.locator(".file-glyph.title-emoji").count(), 1);
    assert.equal(await row.locator("strong").innerText(), title);
  }
  await page.screenshot({ path: join(output, "home-status.png") });
  pass("home titles have one emoji icon and colored access tags");
  await page.goto(origin + "/#/documents");
  await page.locator(".document-table-row").first().waitFor();
  assert(
    (await page.locator(".document-table-head").innerText()).includes("权限"),
  );
  for (const [, state, title] of states) {
    const row = page.locator(".document-table-row").filter({ hasText: title });
    await row.locator(`.table-access [data-access-state="${state}"]`).waitFor();
    assert.equal(
      await row.locator(".table-title .resource-access-tag").count(),
      0,
    );
    assert.equal(await row.locator(".file-glyph.title-emoji").count(), 1);
  }
  await page.screenshot({ path: join(output, "list-access-column.png") });
  pass("document list uses a separate access column, never a title tag");
  await page.goto(origin + "/#/r/" + privateDoc.id);
  await page.locator('.sk-editable[contenteditable="true"]').waitFor();
  await page
    .locator('.document-name-line > [data-access-state="private"]')
    .waitFor();
  const rich = page.locator('.sk-editable[contenteditable="true"]');
  await rich.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("# ");
  await page.keyboard.insertText("正文标题保持原样");
  await saved(page);
  assert.equal(
    await page.locator(".editor-content .resource-access-tag").count(),
    0,
  );
  const body = (await preview(privateDoc.id)).value;
  await page.reload();
  await rich.waitFor();
  assert.deepEqual((await preview(privateDoc.id)).value, body);
  await page.screenshot({ path: join(output, "rich-header-only.png") });
  pass(
    "only the top-left document title has a tag; rich body headings remain native and unchanged",
  );
  await page.goto(origin + "/#/r/" + collaborative.id);
  await page.locator(".canvas-host").waitFor();
  await page
    .locator('.document-name-line > [data-access-state="collaborative"]')
    .waitFor();
  await page.locator(".document-title-edit").click();
  await page.locator(".title-icon-picker > summary").click();
  await page.getByRole("button", { name: "🚀", exact: true }).click();
  const titleInput = page.locator(".document-name-editor");
  assert.equal(await titleInput.inputValue(), "🚀 项目节奏");
  await titleInput.press("Enter");
  await until(
    async () =>
      (await request(`/resources/${collaborative.id}`)).resource.title ===
      "🚀 项目节奏",
    "chosen icon saved",
  );
  await page.locator(".document-title-edit").click();
  await page.locator(".title-icon-picker > summary").click();
  await page.getByLabel("粘贴或输入 emoji", { exact: true }).fill("👩🏽‍💻");
  await page.getByRole("button", { name: "应用", exact: true }).click();
  assert.equal(await titleInput.inputValue(), "👩🏽‍💻 项目节奏");
  await titleInput.press("Enter");
  await until(
    async () =>
      (await request(`/resources/${collaborative.id}`)).resource.title ===
      "👩🏽‍💻 项目节奏",
    "manual emoji saved",
  );
  await page.reload();
  await page.locator(".document-title-edit").waitFor();
  assert(
    (await page.locator(".document-title-edit").innerText()).includes("👩🏽‍💻"),
  );
  pass(
    "picker replaces the icon, accepts a full ZWJ emoji and persists through reload",
  );
  await page.locator(".document-title-edit").click();
  await titleInput.fill("👩🏽‍💻 保留失败草稿");
  const rejectSave = async (route: any) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Title save rejected for isolated QA",
          }),
        })
      : route.continue();
  await page.route(`**/api/v1/resources/${collaborative.id}`, rejectSave);
  await titleInput.press("Enter");
  await page
    .getByText("Title save rejected for isolated QA", { exact: true })
    .waitFor();
  assert.equal(await titleInput.inputValue(), "👩🏽‍💻 保留失败草稿");
  await page.unroute(`**/api/v1/resources/${collaborative.id}`, rejectSave);
  await titleInput.press("Enter");
  await until(
    async () =>
      (await request(`/resources/${collaborative.id}`)).resource.title ===
      "👩🏽‍💻 保留失败草稿",
    "failed draft retried",
  );
  pass("a rejected title save retains the draft and can be retried");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/#/home");
  await page
    .locator(".workspace-recent .resource-access-tag")
    .first()
    .waitFor();
  await page.screenshot({ path: join(output, "home-narrow.png") });
  await page.goto(origin + "/#/documents");
  await page.locator(".table-access .resource-access-tag").first().waitFor();
  await page.screenshot({ path: join(output, "list-narrow.png") });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(origin + "/#/r/" + collaborative.id);
  await page.locator(".document-title-edit").waitFor();
  await page.setViewportSize({ width: 800, height: 500 });
  assert(
    (await page.locator(".document-title-edit").boundingBox())!.width > 60,
  );
  await page.screenshot({ path: join(output, "header-800px.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    (await page.locator(".document-title-edit").boundingBox())!.width > 60,
  );
  await page.screenshot({ path: join(output, "header-narrow.png") });
  assert.deepEqual(errors, []);
  pass(
    "390px and 800px effective zoom viewport retain the document title and tag without page errors",
  );
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify({ result: "passed", checks, errors }, null, 2) + "\n",
  );
} catch (error) {
  await diagnosticPage
    ?.screenshot({ path: join(output, "browser-failure.png"), fullPage: true })
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
