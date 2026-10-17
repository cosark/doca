// Real host + browser acceptance using only synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import {
  createDocuments,
  restoreDocument,
  b64,
} from "../packages/core/src/modules/collaboration/documents.js";
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
await createUser(
  db,
  {
    login: "editorupgrade",
    displayName: "Editor upgrade QA",
    password: "isolated-editor-upgrade-2026",
  },
  { bootstrap: true },
);
const origin = "http://127.0.0.1:39427";
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
    port: 39427,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/three-editor-upgrade-2026-10-17",
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
    if (data.resource.format === "canvas") {
      const { CanvasModel } = await import("@smartdoca/canvas/model");
      const model = CanvasModel.restore({
        codec: "aidcanvas-yjs",
        schemaVersion: 1,
        epochId: data.surface.epochId,
        update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
      });
      try {
        data.value = model.getValue();
      } finally {
        model.dispose();
      }
    }
    if (data.resource.format === "presentation") {
      const Y = await import("yjs"),
        { readDocument } = await import("@smartdoca/slides/core");
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(
          doc,
          new Uint8Array(Buffer.from(data.surface.update, "base64")),
        );
        data.value = readDocument(doc);
      } finally {
        doc.destroy();
      }
    }
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
  const create = (format: string) =>
    request(
      "/resources",
      { title: `2026-10-17 ${format} QA`, kind: "document", format },
      "POST",
    );
  const saved = async (page: Page) =>
    page
      .getByText(/(?:^| · )已保存到云端$/)
      .last()
      .waitFor({ state: "attached" });
  const open = async (id: string, selector: string) => {
    const watched = await watch();
    diagnosticPage = watched.page;
    await watched.page.goto(origin + "/#/r/" + id);
    await watched.page.locator(selector).waitFor();
    return watched;
  };
  const mode = async (page: Page, name: string) => {
    await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const pasteFile = async (page: Page, selector: string, image = false) => {
    await page.locator(selector).evaluate(async (element, image) => {
      const data = new DataTransfer();
      let file: File;
      if (image) {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 32;
        canvas.getContext("2d")!.fillRect(0, 0, 48, 32);
        file = new File(
          [
            await new Promise<Blob>((resolve) =>
              canvas.toBlob((b) => resolve(b!)),
            ),
          ],
          "qa.png",
          { type: "image/png" },
        );
      } else
        file = new File(["Isolated canvas attachment 画布附件"], "qa.txt", {
          type: "text/plain",
        });
      data.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, image);
  };
  const rich = await create("rich_text");
  const a = await open(rich.id, '.sk-editable[contenteditable="true"]');
  const peer = await open(rich.id, ".sk-editable");
  await a.page.bringToFront();
  const editor = a.page.locator('.sk-editable[contenteditable="true"]');
  await editor.click();
  await a.page.keyboard.insertText("三个编辑器升级验收");
  await a.page.keyboard.press("Enter");
  const insert = a.page
    .locator(".editor-fixed-toolbar")
    .getByRole("button", { name: "流程图", exact: true });
  if (!(await insert.isVisible()))
    await a.page.locator(".toolbar-overflow > summary").click();
  await insert.click();
  await a.page.locator(".sk-block-flowchart img").waitFor();
  await a.page
    .locator(".sk-block-flowchart")
    .getByRole("button", { name: "编辑流程图", exact: true })
    .click();
  const dialog = a.page.locator(".sk-diagram-dialog");
  await dialog.waitFor();
  await dialog.locator(".x6-node").first().dblclick();
  await a.page.screenshot({ path: join(output, "slate-label-selection.png") });
  const selectedLabel = await dialog
    .getByLabel("节点文字", { exact: true })
    .evaluate((el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      length: el.value.length,
    }));
  assert.equal(selectedLabel.start, 0);
  assert.equal(selectedLabel.end, selectedLabel.length);
  await a.page.keyboard.insertText("新版图形标签");
  await a.page.keyboard.press("Enter");
  await dialog.locator(".x6-node").first().click();
  await dialog.getByLabel("样式页 5", { exact: true }).click();
  const preset = dialog.locator(".sk-draw-presets > button").first();
  await preset.click();
  await dialog.getByLabel("下一组样式", { exact: true }).click();
  assert.equal(
    await dialog
      .getByLabel("样式页 1", { exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await a.page.screenshot({ path: join(output, "slate-color-palettes.png") });
  await a.page.keyboard.press("Control+s");
  await dialog.waitFor({ state: "detached" });
  await saved(a.page);
  await peer.page.locator(".sk-block-flowchart img").waitFor();
  assert.equal(peer.updates.length, 0);
  await a.page.reload();
  await editor.waitFor();
  assert(
    JSON.stringify((await preview(rich.id)).value).includes("新版图形标签"),
  );
  pass(
    "Slate 0.4.22: typing, diagram label replacement, durable ACK, peer convergence and reload",
  );

  const canvas = await create("canvas");
  const c = await open(canvas.id, ".canvas-host");
  const cp = await open(canvas.id, ".canvas-host");
  await c.page.bringToFront();
  const host = c.page.locator(".canvas-host");
  await c.page.locator('button[data-canvas-insert="mindmap"]').click();
  await host.click({ position: { x: 650, y: 240 } });
  await until(
    async () =>
      JSON.stringify((await preview(canvas.id)).value).includes("mindmap"),
    "canvas mindmap saved",
  );
  await c.page.keyboard.press("Tab");
  const plain = c.page.locator(".leafer-text-editor");
  await plain.waitFor();
  await plain.fill("协作分支");
  await until(
    async () =>
      cp.received.some((frame) =>
        JSON.stringify(frame).includes('"text":{"epochId"'),
      ),
    "canvas relative text presence forwarded",
  );
  await c.page.keyboard.press("Escape");
  await saved(c.page);
  await until(
    async () =>
      JSON.stringify((await preview(canvas.id)).value).includes("协作分支"),
    "mind branch text persisted",
  );
  pass(
    "Canvas native mind map insertion and keyboard child editing persist through host ACK",
  );
  await c.page.getByRole("button", { name: "表格", exact: true }).click();
  await c.page.getByRole("button", { name: "3 × 3", exact: true }).click();
  await host.click({ position: { x: 600, y: 550 } });
  const cellBounds = await c.page.locator(".table-axis-layer").boundingBox();
  assert(cellBounds);
  await c.page.mouse.click(cellBounds.x + 50, cellBounds.y + 20);
  const richInput = c.page.locator('[data-slate-editor="true"]');
  await richInput.waitFor();
  await richInput.focus();
  await c.page.keyboard.insertText("单元格富文本");
  await c.page.keyboard.press("ControlOrMeta+a");
  await c.page
    .getByRole("button", { name: "选中文字加粗", exact: true })
    .click();
  await c.page.keyboard.press("ArrowRight");
  await pasteFile(c.page, '[data-slate-editor="true"]');
  const file = richInput.locator('[data-resource-kind="attachment"]');
  await file.waitFor();
  await file.locator(".rich-file-chip").click();
  await file.getByRole("button", { name: "预览附件", exact: true }).click();
  await c.page.locator(".document-file-preview").waitFor();
  await c.page.screenshot({
    path: join(output, "canvas-attachment-preview.png"),
  });
  await c.page.locator(".document-file-preview header button").click();
  await c.page.keyboard.press("Escape");
  await saved(c.page);
  assert(JSON.stringify((await preview(canvas.id)).value).includes("qa.txt"));
  pass(
    "Canvas rich cell formatting, attachment upload and host-authorized preview",
  );
  await host.click({ position: { x: 920, y: 650 } });
  await host.focus();
  await pasteFile(c.page, ".canvas-app", true);
  await until(
    async () =>
      JSON.stringify((await preview(canvas.id)).value).includes(
        '"tag":"Image"',
      ),
    "canvas image persisted",
  );
  await saved(c.page);
  await c.page.screenshot({ path: join(output, "canvas-host.png") });
  assert.equal(cp.updates.length, 0, "Canvas peer echoed content");
  await c.page.reload();
  await host.waitFor();
  await until(
    async () =>
      JSON.stringify((await preview(canvas.id)).value).includes("qa.txt"),
    "canvas restore",
  );
  pass(
    "Canvas authorized image upload, same-user peer without echo and checkpoint reload",
  );
  await mode(c.page, "阅读");
  const beforeReadonly = await preview(canvas.id),
    readonlyWrites = c.updates.length;
  await pasteFile(c.page, ".canvas-app");
  await c.page.setViewportSize({ width: 1280, height: 800 });
  await c.page.screenshot({ path: join(output, "canvas-readonly.png") });
  assert.equal(c.updates.length, readonlyWrites);
  assert.equal((await preview(canvas.id)).seq, beforeReadonly.seq);
  pass("Canvas readonly paste and resize do not write content");
  await c.page.getByLabel("文档信息与更多操作", { exact: true }).click();
  await c.page.locator("#document-export-slot summary").click();
  const svgDownload = c.page.waitForEvent("download");
  await c.page.getByRole("button", { name: "SVG 图片", exact: true }).click();
  const svg = await svgDownload;
  await svg.saveAs(join(output, "canvas.svg"));
  assert(
    (await readFile(join(output, "canvas.svg"), "utf8")).includes(
      "data:image/",
    ),
  );
  assert.equal((await preview(canvas.id)).seq, beforeReadonly.seq);
  pass(
    "Canvas readonly SVG export embeds authorized images without writing document content",
  );

  const slides = await create("presentation");
  const p = await open(slides.id, ".eppt-workspace");
  await p.page.bringToFront();
  const pp = await open(slides.id, ".eppt-workspace");
  await p.page.bringToFront();
  await p.page
    .locator(".eppt-insert-actions")
    .getByRole("button", { name: "表格", exact: true })
    .click();
  const table = p.page.locator(".eppt-table-overlay");
  await table.waitFor();
  await table.locator('button[data-r="0"][data-c="0"]').dblclick();
  const cell = table.getByLabel("第 1 行第 1 列内容", { exact: true });
  await cell.fill("演示表格验收");
  await cell.press("Tab");
  await until(
    async () =>
      JSON.stringify((await preview(slides.id)).value).includes("演示表格验收"),
    "Slides first cell persisted after Tab",
  );
  await table.locator('button[data-r="0"][data-c="1"]').dblclick();
  await table.getByLabel("第 1 行第 2 列内容", { exact: true }).fill("第二格");
  await table
    .getByLabel("第 1 行第 2 列内容", { exact: true })
    .press("Control+Enter");
  await table
    .getByRole("button", { name: "选择整个表格", exact: true })
    .click();
  await p.page.getByRole("button", { name: "合并单元格", exact: true }).click();
  await p.page.getByRole("button", { name: "拆分单元格", exact: true }).click();
  await p.page.getByRole("button", { name: "加粗", exact: true }).click();
  await p.page
    .getByRole("button", { name: "在表格末尾增加一行", exact: true })
    .click();
  await saved(p.page);
  const persistedSlides = await preview(slides.id);
  await writeFile(
    join(output, "slides-projection.json"),
    JSON.stringify(persistedSlides.value, null, 2),
  );
  assert(
    (await table.innerText()).includes("演示表格验收"),
    "The edited table must render its saved text",
  );
  assert(JSON.stringify(persistedSlides.value).includes("演示表格验收"));
  assert(JSON.stringify(persistedSlides.value).includes('"bold":true'));
  assert.equal(pp.updates.length, 0);
  await p.page.screenshot({ path: join(output, "slides-table.png") });
  await p.page.reload();
  await p.page.locator(".eppt-workspace").waitFor();
  assert.deepEqual((await preview(slides.id)).value, persistedSlides.value);
  pass(
    "Slides revision 6: cell edit/Tab, merge/split, whole-cell bold, row insertion, host ACK, peer and reload",
  );
  await mode(p.page, "阅读");
  const beforePptRead = p.updates.length;
  await p.page.locator(".eppt-slide").first().click();
  await p.page.keyboard.insertText("不得写入");
  assert.equal(p.updates.length, beforePptRead);
  await p.page.screenshot({ path: join(output, "slides-readonly.png") });
  pass("Slides readonly selection and typing produce no writes");
  await p.page.getByLabel("文档信息与更多操作", { exact: true }).click();
  const pptDownload = p.page.waitForEvent("download");
  await p.page
    .locator("#document-export-slot")
    .getByRole("button", { name: "下载", exact: true })
    .click();
  const ppt = await pptDownload;
  await ppt.saveAs(join(output, "slides.pptx"));
  const { importPptx } = await import("@smartdoca/slides/pptx");
  const reimported = await importPptx(
    new Uint8Array(await readFile(join(output, "slides.pptx"))).buffer,
  );
  assert(JSON.stringify(reimported).includes("演示表格验收"));
  assert.equal(p.updates.length, beforePptRead);
  pass(
    "Slides readonly PPTX download reimports with native table content and no document writes",
  );

  const snapshots = await Promise.all([
    preview(rich.id),
    preview(canvas.id),
    preview(slides.id),
  ]);
  const writes = [
    a.updates.length,
    peer.updates.length,
    c.updates.length,
    cp.updates.length,
    p.updates.length,
  ];
  await delay(30_000);
  console.log("Idle observation 30 seconds");
  await delay(30_000);
  console.log("Idle observation 60 seconds");
  assert.deepEqual(
    [
      a.updates.length,
      peer.updates.length,
      c.updates.length,
      cp.updates.length,
      p.updates.length,
    ],
    writes,
  );
  assert.deepEqual(
    (
      await Promise.all([
        preview(rich.id),
        preview(canvas.id),
        preview(slides.id),
      ])
    ).map((v) => v.seq),
    snapshots.map((v) => v.seq),
  );
  assert.deepEqual(errors, []);
  pass(
    "60-second idle observation: zero content writes across all three editors and peers",
  );
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      { result: "passed", checks, errors, idleSeconds: 60 },
      null,
      2,
    ) + "\n",
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
