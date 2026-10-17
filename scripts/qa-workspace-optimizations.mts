// Real UI regression checks with synthetic accounts and an isolated database.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { recordSessionResource } from "../packages/core/src/modules/ai/session-resources.js";
import {
  readAIDocument,
  editAIDocument,
} from "../packages/core/src/workflows/ai-documents.js";

const root = await mkdtemp(join(tmpdir(), "doca-workspace-qa-"));
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
const password = "isolated-workspace-2026";
const owner = {
  ...(await createUser(
    db,
    {
      login: "workspaceqa",
      displayName: "Workspace QA",
      password,
    },
    { bootstrap: true },
  )),
  admin: 1,
};
await createUser(
  db,
  { login: "workspacepeer", displayName: "Online peer", password },
  { actor: owner },
);
const content = createContent(db);
const library = await content.create(owner, {
  kind: "library",
  format: "markdown",
  title: "团队知识库",
});
const docs: Record<string, { id: string; title: string }> = {};
for (const format of [
  "rich_text",
  "markdown",
  "spreadsheet",
  "canvas",
  "presentation",
] as const) {
  const resource = await content.create(owner, {
    kind: "document",
    format,
    title: `验收 ${format}`,
    ...(format === "markdown" ? { libraryId: library.id } : {}),
  });
  docs[format] = resource;
  const before = await readAIDocument(db, { actor: owner }, resource.id);
  const value = before.value as any;
  const operations =
    format === "rich_text" || format === "markdown"
      ? [{ type: "append", text: "引用内容验收" }]
      : format === "spreadsheet"
        ? [
            {
              type: "cells",
              sheetId: value.sheetOrder[0],
              cells: { 0: { 0: { v: "表格引用验收" } } },
            },
          ]
        : format === "canvas"
          ? [
              {
                type: "add",
                element: {
                  id: "qa-rect",
                  tag: "Rect",
                  x: 500,
                  y: 250,
                  width: 160,
                  height: 100,
                  fill: "#93b4f5",
                },
              },
            ]
          : [{ type: "add", slideId: value.slideOrder[0], kind: "text" }];
  if (operations.length)
    await editAIDocument(
      db,
      { actor: owner },
      resource.id,
      { seq: before.seq, epochId: before.epochId! },
      operations,
      randomUUID(),
    );
  await content.visit(owner, resource.id);
}
const initialStates = await db
  .selectFrom("document_states")
  .select(["resource_id", "seq"])
  .orderBy("resource_id")
  .execute();
const origin = "http://127.0.0.1:39421";
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
    port: 39421,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
await web.listen();
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/workspace-optimizations-2026-10-16",
);
await mkdir(output, { recursive: true });
const checks: string[] = [],
  errors: string[] = [];
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS " + name);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
let current: Page | undefined;
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
  await request("/auth/login", { login: "workspaceqa", password }, "POST");
  const page = await context.newPage();
  current = page;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/#/documents");
  await page.locator(".document-table-row").first().waitFor();
  await page.screenshot({ path: join(output, "documents.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "documents-mobile.png") });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.screenshot({ path: join(output, "documents-zoom.png") });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  const chooseSource = async (name: string) => {
    await page.getByRole("combobox", { name: "文档来源", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await page.waitForFunction(
      (name) => {
        const rows = [
          ...document.querySelectorAll(".document-table-row .table-location"),
        ];
        return (
          rows.length > 0 && rows.every((row) => row.classList.contains(name))
        );
      },
      name === "知识库" ? "in-library" : "personal",
    );
  };
  await chooseSource("知识库");
  assert.deepEqual(await page.locator(".table-title").allTextContents(), [
    docs.markdown!.title,
  ]);
  await page.getByRole("tab", { name: "归我所有", exact: true }).click();
  await chooseSource("个人文档");
  assert.equal(await page.locator(".document-table-row").count(), 4);
  pass(
    "source filter works across recent and owned tabs with server-side results",
  );
  await page.getByRole("button", { name: "上传文档", exact: false }).click();
  await page
    .getByRole("button", { name: "导入为Markdown", exact: true })
    .click();
  await page.locator('.create-popover input[type="file"]').setInputFiles({
    name: "本地上传验收.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 上传验收\n内容保留"),
  });
  await page.waitForURL(/#\/r\//);
  await page.locator(".cm-content").filter({ hasText: "内容保留" }).waitFor();
  await page.reload();
  await page.locator(".cm-content").filter({ hasText: "内容保留" }).waitFor();
  pass(
    "top upload uses the existing import flow and preserves imported content after reload",
  );

  const open = async (format: string) => {
    const p = await context.newPage();
    current = p;
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(origin + "/#/r/" + docs[format]!.id);
    await p
      .getByText(/已保存到云端/)
      .last()
      .waitFor({ state: "attached" });
    return p;
  };
  const assertReference = async (p: Page, format: string) => {
    const tag = p.locator(".ai-composer .ai-inline-reference");
    await tag.filter({ hasText: docs[format]!.title }).waitFor();
    assert.equal(await tag.count(), 1);
    await p.screenshot({ path: join(output, `ai-${format}.png`) });
  };
  const rich = await open("rich_text");
  const richEditor = rich.locator('.sk-editable[contenteditable="true"]');
  await richEditor.getByText("引用内容验收", { exact: true }).dblclick();
  await rich
    .getByRole("button", { name: "引用给 AI", exact: true })
    .first()
    .click();
  await assertReference(rich, "rich_text");
  await rich.reload();
  await rich.locator(".ai-document-trigger").click();
  await rich.locator(".ai-composer .ai-inline-reference").waitFor();
  pass(
    "rich-text first-open selection reaches the composer and survives draft reload",
  );

  const session = await request(
    "/ai/sessions",
    { resourceIds: [docs.markdown!.id], title: "已有会话" },
    "POST",
  );
  await recordSessionResource(db, owner.id, session.id, {
    ...docs.markdown!,
    kind: "document",
    href: "/r/" + docs.markdown!.id,
  });
  const md = await open("markdown");
  await md.evaluate(
    ({ userId, sessionId }) => {
      localStorage.setItem(
        `doca.ai.composer.v1:${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`,
        JSON.stringify({
          version: 1,
          segments: [{ type: "text", value: "保留已有草稿 " }],
          attachments: [],
          folders: [],
        }),
      );
    },
    { userId: owner.id, sessionId: session.id },
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await md.route("**/api/v1/ai/sessions?resourceId=*", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  const editor = md.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await md.keyboard.press("Meta+a");
  await md.getByRole("button", { name: "引用给 AI", exact: true }).click();
  await md.locator(".ai-composer").waitFor();
  release();
  await md.waitForURL(new RegExp("session=" + session.id));
  await assertReference(md, "markdown");
  assert(
    (
      await md.locator('.ai-composer [contenteditable="true"]').innerText()
    ).includes("保留已有草稿"),
  );
  const beforeDraft = await md
    .locator('.ai-composer [contenteditable="true"]')
    .innerText();
  await editor.click();
  await md.keyboard.press("Meta+a");
  await md.getByRole("button", { name: "引用给 AI", exact: true }).click();
  await assertReference(md, "markdown");
  assert.equal(
    await md.locator('.ai-composer [contenteditable="true"]').innerText(),
    beforeDraft,
  );
  pass(
    "delayed existing-session restore keeps the selection and repeated citation is deduplicated",
  );

  const sheet = await open("spreadsheet");
  const corner = sheet.locator(".uos-editor__select-all");
  await corner.waitFor();
  const box = await corner.boundingBox();
  assert(box);
  await sheet.mouse.click(box.x + box.width + 36, box.y + box.height + 9);
  const sheetAi = sheet.getByRole("button", { name: "引用给 AI", exact: true });
  if (!(await sheetAi.isVisible()))
    await sheet.getByRole("button", { name: "更多", exact: true }).click();
  await sheetAi.click();
  await assertReference(sheet, "spreadsheet");
  pass("spreadsheet native selection reaches the composer");

  const canvas = await open("canvas");
  await canvas.locator(".canvas-view").click();
  await canvas.keyboard.press("Meta+a");
  await canvas.getByRole("button", { name: "引用给 AI", exact: true }).click();
  await assertReference(canvas, "canvas");
  pass("canvas native selected elements reach the composer");

  const slides = await open("presentation");
  const slideText = await slides
    .locator(".eppt-canvas-area")
    .getByText("双击编辑文本", { exact: true })
    .boundingBox();
  assert(slideText);
  await slides.mouse.click(
    slideText.x + slideText.width / 2,
    slideText.y + slideText.height / 2,
  );
  await slides.getByRole("button", { name: "格式", exact: true }).click();
  await slides
    .getByRole("button", { name: "引用给 AI", exact: true })
    .first()
    .click();
  await assertReference(slides, "presentation");
  pass("presentation native selected element reaches the composer");
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select(["resource_id", "seq"])
      .where(
        "resource_id",
        "in",
        initialStates.map((state) => state.resource_id),
      )
      .orderBy("resource_id")
      .execute(),
    initialStates,
  );
  pass(
    "selection, citation and draft reload leave all five document content sequences unchanged",
  );

  // Force the stale HTTP snapshot to arrive after an actual realtime update.
  const admin = await context.newPage();
  current = admin;
  let releaseStats!: () => void, statsStarted!: () => void;
  const statsGate = new Promise<void>((resolve) => {
    releaseStats = resolve;
  });
  const statsRequest = new Promise<void>((resolve) => {
    statsStarted = resolve;
  });
  await admin.route("**/api/v1/admin/stats", async (route) => {
    const response = await route.fetch();
    const stats = await response.json();
    statsStarted();
    await statsGate;
    await route.fulfill({ json: { ...stats, online: 0 } });
  });
  const liveStats = new Promise<number>((resolve) =>
    admin.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(String(payload));
        if (message.type === "stats" && message.online === 2)
          resolve(message.online);
      });
    }),
  );
  await admin.goto(origin + "/#/admin");
  await statsRequest;
  const peerContext = await browser.newContext();
  const peerLogin = await peerContext.request.post(
    origin + "/api/v1/auth/login",
    {
      headers: { origin },
      data: { login: "workspacepeer", password },
    },
  );
  assert.equal(peerLogin.status(), 200);
  const peerPage = await peerContext.newPage();
  await peerPage.goto(origin + "/#/documents");
  const online = await liveStats;
  releaseStats();
  await admin.waitForFunction(
    (online) =>
      document.querySelector(".admin-stats .admin-stat:last-child strong")
        ?.textContent === String(online),
    online,
  );
  assert(online > 0);
  await admin.screenshot({ path: join(output, "admin-online.png") });
  pass(
    "first admin load retains newer realtime count when stale HTTP stats arrive last",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  await current
    ?.screenshot({ path: join(output, "failure.png") })
    .catch(() => {});
  console.error((await current?.locator("body").innerText())?.slice(-2600));
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
