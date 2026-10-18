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
import { TITLE_EMOJI_OPTIONS } from "../apps/web/src/shared/title-emoji.js";

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
  process.env.DOCA_QA_OUTPUT ?? "artifacts/title-emoji-0.2.1",
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
    { title: "📊  项目节奏", kind: "document", format: "canvas" },
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
  const emojiDoc = await request(
    "/resources",
    { title: "研讨纪要", kind: "document", format: "rich_text" },
    "POST",
  );
  await page.goto(origin + "/#/r/" + emojiDoc.id);
  await rich.waitFor();
  const peer = await watch();
  await peer.page.goto(origin + "/#/r/" + emojiDoc.id);
  await peer.page.locator('.sk-editable[contenteditable="true"]').waitFor();
  await rich.click();
  await rich
    .locator("[data-slate-leaf]")
    .first()
    .click({ position: { x: 1, y: 1 } });
  for (let n = 0; n < 12; n++) await page.keyboard.press("ArrowLeft");
  await page
    .locator("#editor-toolbar-slot")
    .getByRole("button", { name: "插入表情", exact: true })
    .click();
  const palette = page.locator("#editor-toolbar-slot .emoji-palette");
  await palette.waitFor();
  for (const icon of TITLE_EMOJI_OPTIONS)
    assert.equal(
      await palette.getByRole("button", { name: icon, exact: true }).count(),
      1,
    );
  await page.screenshot({
    path: join(output, "rich-toolbar-title-emojis.png"),
  });
  await palette.getByRole("button", { name: "🗓️", exact: true }).click();
  await page.keyboard.insertText(" ");
  await until(
    async () =>
      (await request(`/resources/${emojiDoc.id}`)).resource.title ===
      "🗓️ 研讨纪要",
    "native toolbar emoji title saved: " +
      (await request(`/resources/${emojiDoc.id}`)).resource.title,
  );
  await until(
    async () =>
      (await peer.page.locator(".sk-editable").innerText()).includes(
        "🗓️ 研讨纪要",
      ),
    "peer title converged",
  );
  assert.equal(peer.updates.length, 0);
  const emojiBody = (await preview(emojiDoc.id)).value;
  await page.reload();
  await rich.waitFor();
  assert.deepEqual((await preview(emojiDoc.id)).value, emojiBody);
  pass(
    "all 24 title emojis appear in the rich toolbar; native title insertion persists, converges and causes no peer echo",
  );
  await page.goto(origin + "/#/r/" + collaborative.id);
  await page.locator(".canvas-host").waitFor();
  await page
    .locator('.document-name-line > [data-access-state="collaborative"]')
    .waitFor();
  await page.locator(".document-title-edit").click();
  const titleInput = page.locator(".document-name-editor");
  assert.equal(await titleInput.inputValue(), "项目节奏");
  assert.equal(
    await page.locator(".title-icon-picker > summary").innerText(),
    "📊",
  );
  const originalTitle = (await request(`/resources/${collaborative.id}`))
    .resource;
  await page.screenshot({ path: join(output, "title-editor-single-icon.png") });
  await titleInput.press("Enter");
  assert.equal(
    (await request(`/resources/${collaborative.id}`)).resource.version,
    originalTitle.version,
  );
  assert.equal(
    (await request(`/resources/${collaborative.id}`)).resource.title,
    "📊  项目节奏",
  );
  await page.locator(".document-title-edit").click();
  await page.locator(".title-icon-picker > summary").click();
  await page.getByRole("button", { name: "🚀", exact: true }).click();
  assert.equal(await titleInput.inputValue(), "项目节奏");
  assert.equal(
    await page.locator(".title-icon-picker > summary").innerText(),
    "🚀",
  );
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
  assert.equal(await titleInput.inputValue(), "项目节奏");
  assert.equal(
    await page.locator(".title-icon-picker > summary").innerText(),
    "👩🏽‍💻",
  );
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
  await titleInput.fill("保留失败草稿");
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
  assert.equal(await titleInput.inputValue(), "保留失败草稿");
  assert.equal(
    await page.locator(".title-icon-picker > summary").innerText(),
    "👩🏽‍💻",
  );
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(origin + "/#/documents");
  await page.locator(".locale-switch > summary").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page.getByText("Collaborative", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const enRow = page
    .locator(".document-table-row")
    .filter({ hasText: "Collaborative" });
  const enTag = (await enRow.locator(".resource-access-tag").boundingBox())!;
  const locationBox = (await enRow.locator(".table-location").boundingBox())!;
  assert(
    enTag.x + enTag.width <= locationBox.x,
    "English access tag must not overlap its location column",
  );
  await page.screenshot({ path: join(output, "list-narrow-en.png") });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator(".locale-switch > summary").click();
  await page.getByRole("option", { name: "中文", exact: true }).click();
  await page.goto(origin + "/#/libraries");
  await page.locator(".quick-actions > button").first().click();
  const createLibrary = page.locator(".modal form");
  const createName = createLibrary.locator(
    '.resource-title-field > input:not([type="hidden"])',
  );
  await createName.fill("团队知识");
  await createLibrary.locator(".title-icon-picker > summary").click();
  await createLibrary.getByRole("button", { name: "📚", exact: true }).click();
  assert.equal(await createName.inputValue(), "团队知识");
  await createLibrary.locator("footer > button.primary").click();
  await until(
    async () =>
      (await request("/resources?kind=library&scope=all")).items.some(
        (r: any) => r.title === "📚 团队知识",
      ),
    "library title created with emoji",
  );
  const library = (
    await request("/resources?kind=library&scope=all")
  ).items.find((r: any) => r.title === "📚 团队知识");
  await page.goto(origin + "/#/libraries");
  const libraryCard = page
    .locator(".library-card")
    .filter({ hasText: "团队知识" });
  await libraryCard.waitFor();
  assert.equal(
    await libraryCard.locator(".library-title-emoji").innerText(),
    "📚",
  );
  assert.equal(
    await libraryCard.locator(".library-cover > strong").innerText(),
    "团队知识",
  );
  assert.equal(await libraryCard.locator(".library-cover > svg").count(), 0);
  await page.screenshot({ path: join(output, "library-emoji-card.png") });
  await content.visit(owner, library.id);
  await page.goto(origin + "/#/home");
  const recentLibrary = page.locator(`.workspace-recent > div:has(a[href="#/r/${library.id}"])`);
  await recentLibrary.waitFor();
  assert.equal(
    await recentLibrary.locator(".file-glyph.title-emoji").innerText(),
    "📚",
  );
  assert.equal(await recentLibrary.locator("strong").innerText(), "团队知识");
  await page.goto(origin + "/#/r/" + library.id + "?view=settings");
  await page
    .locator(".library-setting-actions")
    .getByRole("button", { name: "重命名", exact: true })
    .click();
  const renameLibrary = page.locator(".modal form"),
    renameName = renameLibrary.locator(
      '.resource-title-field > input:not([type="hidden"])',
    );
  assert.equal(await renameName.inputValue(), "团队知识");
  assert.equal(
    await renameLibrary.locator(".title-icon-picker > summary").innerText(),
    "📚",
  );
  await renameName.fill("团队资料");
  await renameLibrary.locator(".title-icon-picker > summary").click();
  await renameLibrary.getByRole("button", { name: "🌱", exact: true }).click();
  await renameLibrary.locator("footer > button.primary").click();
  await until(
    async () =>
      (await request(`/resources/${library.id}`)).resource.title ===
      "🌱 团队资料",
    "library emoji renamed",
  );
  await page.reload();
  await page
    .locator(".library-setting-actions")
    .getByRole("button", { name: "重命名", exact: true })
    .click();
  assert.equal(await renameName.inputValue(), "团队资料");
  assert.equal(
    await renameLibrary.locator(".title-icon-picker > summary").innerText(),
    "🌱",
  );
  await renameLibrary.locator(".title-icon-picker > summary").click();
  await renameLibrary.locator(".title-icon-remove").click();
  await renameLibrary.locator("footer > button.primary").click();
  await until(
    async () =>
      (await request(`/resources/${library.id}`)).resource.title === "团队资料",
    "library emoji removed",
  );
  await page.goto(origin + "/#/libraries");
  const plainLibrary = page
    .locator(".library-card")
    .filter({ hasText: "团队资料" });
  await plainLibrary.waitFor();
  assert.equal(await plainLibrary.locator(".library-cover > svg").count(), 1);
  assert.equal(await plainLibrary.locator(".library-title-emoji").count(), 0);
  pass(
    "library creation and renaming keep one editable emoji; cards and home replace the type icon, removal restores it",
  );
  const idleCount = peer.updates.length,
    idleSeq = (await preview(emojiDoc.id)).seq;
  for (let n = 0; n < 6; n++) await delay(10000);
  assert.equal(peer.updates.length, idleCount);
  assert.equal((await preview(emojiDoc.id)).seq, idleSeq);
  await peer.page.close();
  assert.deepEqual(errors, []);
  pass(
    "English narrow access tags stay in their column, and 60 seconds idle produces zero content writes",
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
