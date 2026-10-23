// Real host + browser acceptance using only synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
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
const account = await createUser(
  db,
  {
    login: "editorupgrade",
    displayName: "Editor upgrade QA",
    password: "isolated-editor-upgrade-2026",
  },
  { bootstrap: true },
);
const origin = "http://127.0.0.1:39436";
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
    port: 39436,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/verification/editor-packages-2026-10-20",
);
const packageVersions = JSON.parse(
  await readFile(resolve("package.json"), "utf8"),
).dependencies;
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
    if (data.resource.format === "spreadsheet") {
      const { projectExlsxWorkbook } = await import("@smartdoca/sheet/model");
      data.value = await projectExlsxWorkbook({
        baseline: data.surface.baseline,
        update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
        checkpointSeq: 0,
      });
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
      { title: `2026-10-20 ${format} QA`, kind: "document", format },
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
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { createDocuments, b64, unb64 } =
    await import("../packages/core/src/modules/collaboration/documents.js");
  const { CanvasModel } = await import("@smartdoca/canvas/model");
  const canvas = await create("canvas");
  const docs = createDocuments(db),
    protocol = { protocolVersion: 1, codec: "aidcanvas-yjs", schemaVersion: 1 };
  const actor = { ...account, admin: 1 };
  const initial = await docs.exchange(actor, canvas.id, protocol);
  const seed = CanvasModel.restore({
    codec: "aidcanvas-yjs",
    schemaVersion: 1,
    epochId: initial.epochId!,
    update: unb64(initial.update),
  });
  const fixture = JSON.parse(
    await readFile(
      resolve("tests/fixtures/editor-upgrade-2026-10-20/canvas-0.5.5.json"),
      "utf8",
    ),
  );
  for (const node of fixture.value.scene.children) seed.add(node);
  await docs.exchange(actor, canvas.id, {
    ...protocol,
    epochId: initial.epochId,
    messageId: crypto.randomUUID(),
    update: b64(seed.checkpoint().update),
  });
  seed.dispose();
  const original = await preview(canvas.id);
  const a = await open(canvas.id, ".canvas-host"),
    b = await open(canvas.id, ".canvas-host");
  await saved(a.page);
  await saved(b.page);
  await a.page.bringToFront();
  await a.page.locator(".canvas-host").click({ position: { x: 350, y: 240 } });
  await a.page
    .locator('[data-node-id="legacy-diagram"].graph-port')
    .first()
    .waitFor();
  assert.equal(
    await a.page.locator('[data-node-id="legacy-diagram"].graph-port').count(),
    12,
  );
  await a.page.setViewportSize({ width: 1400, height: 900 });
  await a.page.screenshot({ path: join(output, "canvas-legacy-view.png") });
  await a.page.reload();
  await a.page.locator(".canvas-host").waitFor();
  await saved(a.page);
  assert.deepEqual((await preview(canvas.id)).value, original.value);
  assert.equal((await preview(canvas.id)).seq, original.seq);
  assert.equal(a.updates.length, 0);
  assert.equal(b.updates.length, 0);
  pass(
    "released 0.5.5 name-only diagram opens, selects, resizes viewport and reloads without checkpoint writes; twelve native ports",
  );

  await a.page.getByRole("button", { name: "主菜单", exact: true }).click();
  await a.page
    .getByRole("menuitemradio", { name: "点阵", exact: true })
    .click();
  assert.equal(
    await a.page.locator(".canvas-stage").getAttribute("data-grid-pattern"),
    "dots",
  );
  await a.page.getByRole("button", { name: "主菜单", exact: true }).click();
  await a.page
    .getByRole("menuitemradio", { name: "网格", exact: true })
    .click();
  assert.equal(
    await a.page.locator(".canvas-stage").getAttribute("data-grid-pattern"),
    "lines",
  );
  await a.page.getByRole("button", { name: "主菜单", exact: true }).click();
  await a.page
    .getByRole("menuitemradio", { name: "背景色 #edf3ff", exact: true })
    .click();
  assert.equal((await preview(canvas.id)).seq, original.seq);
  assert.equal(a.updates.length, 0);
  pass(
    "embedded canvas exposes native grid/background controls without content writes",
  );

  await a.page.locator(".canvas-host").click({ position: { x: 350, y: 240 } });
  const legacyHost = await a.page.locator(".canvas-host").boundingBox();
  assert(legacyHost);
  await a.page.mouse.move(legacyHost.x + 580, legacyHost.y + 360);
  await a.page.mouse.down();
  await a.page.mouse.move(legacyHost.x + 680, legacyHost.y + 440, {
    steps: 12,
  });
  await a.page.mouse.up();
  await until(
    async () => (await preview(canvas.id)).seq > original.seq,
    "legacy resize durable save",
  );
  await saved(a.page);
  const resized = await preview(canvas.id),
    node = resized.value.scene.children.find(
      (n: any) => n.id === "legacy-diagram",
    );
  assert(node.width > 420);
  assert.equal(
    node.children.find((n: any) => n.id === "legacy-body").width,
    node.width,
  );
  assert.equal(
    node.children.find((n: any) => n.id === "legacy-text").width,
    node.width - 28,
  );
  await a.page.keyboard.press("ControlOrMeta+z");
  await saved(a.page);
  await until(
    async () =>
      JSON.stringify((await preview(canvas.id)).value) ===
      JSON.stringify(original.value),
    "legacy resize undo",
  );
  await a.page.keyboard.press("ControlOrMeta+Shift+z");
  await saved(a.page);
  await until(
    async () =>
      JSON.stringify((await preview(canvas.id)).value) ===
      JSON.stringify(resized.value),
    "legacy resize redo",
  );
  await b.page.reload();
  await b.page.locator(".canvas-host").waitFor();
  await saved(b.page);
  assert.equal(b.updates.length, 0);
  pass(
    "explicit legacy resize synchronizes body/text geometry and supports host undo, redo, peer replay and reload",
  );

  const lineDoc = await create("canvas");
  const lineInitial = await docs.exchange(actor, lineDoc.id, protocol);
  const lineSeed = CanvasModel.restore({
    codec: "aidcanvas-yjs",
    schemaVersion: 1,
    epochId: lineInitial.epochId!,
    update: unb64(lineInitial.update),
  });
  lineSeed.add({
    id: "unbound-line",
    tag: "Path",
    name: "connector",
    path: "M 300 240 L 700 420",
    stroke: "#646a73",
    strokeWidth: 1.5,
    hitRadius: 8,
    editable: true,
    editConfig: { moveable: false, resizeable: false, rotateable: false },
    data: {
      kind: "connector",
      from: { x: 300, y: 240 },
      to: { x: 700, y: 420 },
      sourceId: "",
      targetId: "",
      mode: "straight",
    },
  });
  await docs.exchange(actor, lineDoc.id, {
    ...protocol,
    epochId: lineInitial.epochId,
    messageId: crypto.randomUUID(),
    update: b64(lineSeed.checkpoint().update),
  });
  lineSeed.dispose();
  for (const page of [a.page, b.page]) {
    await page.goto(origin + "/#/r/" + lineDoc.id);
    await page.locator(".canvas-host").waitFor();
    await saved(page);
  }
  const beforeLine = await preview(lineDoc.id),
    lineUpdates = a.updates.length;
  const lineBox = await a.page.locator(".canvas-host").boundingBox();
  assert(lineBox);
  await a.page.mouse.move(lineBox.x + 420, lineBox.y + 294);
  await a.page.mouse.down();
  await a.page.mouse.move(lineBox.x + 516, lineBox.y + 246, { steps: 12 });
  await a.page.locator(".graph-gesture-preview path").waitFor();
  assert.equal(a.updates.length, lineUpdates);
  await a.page.mouse.up();
  await until(
    async () => (await preview(lineDoc.id)).seq === beforeLine.seq + 1,
    "connector translation commit",
  );
  const movedLine = await preview(lineDoc.id);
  const line = movedLine.value.scene.children.find(
    (node: any) => node.id === "unbound-line",
  );
  assert.deepEqual(line.data.from, { x: 396, y: 192 });
  assert.deepEqual(line.data.to, { x: 796, y: 372 });
  assert.equal(a.updates.length, lineUpdates + 1);
  await a.page.keyboard.press("ControlOrMeta+z");
  await until(
    async () =>
      JSON.stringify((await preview(lineDoc.id)).value) ===
      JSON.stringify(beforeLine.value),
    "connector translation undo",
  );
  await a.page.mouse.move(lineBox.x + 900, lineBox.y + 550);
  await delay(350);
  await a.page.keyboard.press("ControlOrMeta+Shift+z");
  await until(
    async () =>
      JSON.stringify((await preview(lineDoc.id)).value) ===
      JSON.stringify(movedLine.value),
    "connector translation redo after idle",
  );
  await b.page.reload();
  await b.page.locator(".canvas-host").waitFor();
  await saved(b.page);
  assert.equal(b.updates.length, 0);
  assert.deepEqual((await preview(lineDoc.id)).value, movedLine.value);
  await a.page.screenshot({
    path: join(output, "canvas-connector-translation.png"),
  });
  pass(
    "unbound connector body drag commits once, preserves redo after idle and restores without peer echo",
  );
  const imageDoc = await create("canvas");
  diagnosticPage = a.page;
  await a.page.goto(origin + "/#/r/" + imageDoc.id);
  await a.page.locator(".canvas-host").waitFor();
  await saved(a.page);
  await a.page
    .locator(
      '.board-tools input[type="file"][accept="image/*"], input[type="file"][accept="image/*"]',
    )
    .first()
    .setInputFiles({
      name: "qa.png",
      mimeType: "image/png",
      buffer: await (
        await import("sharp")
      )
        .default({
          create: { width: 48, height: 32, channels: 4, background: "#3370ff" },
        })
        .png()
        .toBuffer(),
    });
  await until(
    async () =>
      JSON.stringify((await preview(imageDoc.id)).value).includes("qa.png"),
    "image durable upload",
  );
  await saved(a.page);
  const imageBefore = await preview(imageDoc.id);
  // Native selected-image toolbar gives screen coordinates without peeking into the editor runtime.
  const image = imageBefore.value.scene.children.find(
    (n: any) => n.tag === "Image",
  );
  assert(image);
  const canvasHost = a.page.locator(".canvas-host");
  await canvasHost.click({ position: { x: 100, y: 100 } });
  // The image is placed at the visible center by the native insertion command.
  const hostBox = await canvasHost.boundingBox();
  assert(hostBox);
  const center = { x: hostBox.width / 2, y: hostBox.height / 2 };
  await canvasHost.click({ position: center });
  assert.equal(
    await a.page.getByRole("dialog", { name: "qa.png", exact: true }).count(),
    0,
  );
  await canvasHost.click({ position: center });
  await a.page.getByRole("dialog", { name: "qa.png", exact: true }).waitFor();
  await a.page.screenshot({ path: join(output, "canvas-image-preview.png") });
  await a.page.getByRole("button", { name: "关闭", exact: true }).click();
  const copies: string[] = [];
  a.page.on("request", (r) => {
    if (r.url().includes("/assets/") && r.url().includes("download=1"))
      copies.push(r.url());
  });
  await canvasHost.click({ position: center, button: "right" });
  await a.page.getByRole("menuitem", { name: "复制图片", exact: true }).click();
  await until(
    async () =>
      a.page.evaluate(async () => {
        try {
          return (
            (await navigator.clipboard.read())[0]?.types.includes(
              "image/png",
            ) ?? false
          );
        } catch {
          return false;
        }
      }),
    "authorized PNG clipboard",
  );
  assert(copies.length > 0);
  assert.deepEqual((await preview(imageDoc.id)).value, imageBefore.value);
  await mode(a.page, "阅读");
  await canvasHost.click({ position: center, button: "right" });
  await a.page.getByRole("menuitem", { name: "复制图片", exact: true }).click();
  await a.page.screenshot({ path: join(output, "canvas-image-readonly.png") });
  assert.equal((await preview(imageDoc.id)).seq, imageBefore.seq);
  pass(
    "native image select/preview and authorized PNG clipboard in edit and readonly preserve document content",
  );

  // The snapshot surface uses the separate readonly resource adapter.
  await a.page
    .getByRole("button", { name: "查看历史记录", exact: true })
    .click();
  const records = a.page.getByRole("dialog", { name: "历史记录", exact: true });
  await records
    .getByRole("button", { name: "保存当前快照", exact: true })
    .click();
  await records
    .getByRole("button", { name: "查看", exact: true })
    .first()
    .click();
  const history = a.page.locator(".version-preview-dialog");
  await history.locator(".canvas-host").waitFor();
  const historyHost = history.locator(".canvas-host"),
    historyBox = await historyHost.boundingBox();
  assert(historyBox);
  const priorDownloads = copies.length;
  await historyHost.click({
    position: { x: image.x + image.width / 2, y: image.y + image.height / 2 },
    button: "right",
  });
  await history
    .getByRole("menuitem", { name: "复制图片", exact: true })
    .click();
  await until(
    async () => copies.length > priorDownloads,
    "history copy authorization",
  );
  await a.page.screenshot({ path: join(output, "canvas-history-copy.png") });
  await history
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await records
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  assert.equal((await preview(imageDoc.id)).seq, imageBefore.seq);
  pass(
    "readonly history preview copies through the host download authorization without live-document writes",
  );
  const sheet = await create("spreadsheet");
  const s = await open(sheet.id, ".uos-editor__select-all"),
    peer = await open(sheet.id, ".uos-editor__select-all");
  diagnosticPage = s.page;
  await s.page.bringToFront();
  await saved(s.page);
  const select = async (range: string) => {
    const input = s.page
      .locator(".uos-editor")
      .getByRole("textbox", { exact: true });
    await input.fill(range);
    await input.press("Enter");
  };
  await select("A1");
  await s.page.evaluate(() =>
    navigator.clipboard.writeText("类别\t状态\n甲\t保留\n乙\t隐藏\n丙\t保留"),
  );
  await s.page.keyboard.press("ControlOrMeta+v");
  await until(
    async () =>
      JSON.stringify((await preview(sheet.id)).value).includes("隐藏"),
    "native sheet paste",
  );
  await select("A1:B4");
  const filter = () =>
    s.page.getByRole("button", { name: "筛选", exact: true });
  const hasFilter = async () =>
    JSON.stringify((await preview(sheet.id)).value.resources ?? []).includes(
      "SHEET_FILTER_PLUGIN",
    );
  await filter().click();
  await until(hasFilter, "filter range saved");
  await saved(s.page);
  await s.page.screenshot({ path: join(output, "sheet-filter.png") });
  await filter().click();
  await saved(s.page);
  await filter().click();
  await saved(s.page);
  await s.page.reload();
  await s.page.locator(".uos-editor__select-all").waitFor();
  await saved(s.page);
  assert(await hasFilter());
  assert.equal(peer.updates.length, 0);
  pass(
    "native filter create/remove/recreate and reload use host ACKs without peer echo",
  );

  await select("D1");
  await s.page.getByRole("button", { name: "插入", exact: true }).click();
  await s.page
    .getByRole("menuitem", { name: "单元格内图片", exact: true })
    .click();
  const mediaDialog = s.page.getByRole("dialog", {
    name: "插入内联图片",
    exact: true,
  });
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 48, height: 32, channels: 4, background: "#e5484d" },
    })
    .png()
    .toBuffer();
  await mediaDialog.getByLabel("选择内联图片", { exact: true }).setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png },
    { name: "second.png", mimeType: "image/png", buffer: png },
  ]);
  await mediaDialog
    .getByRole("button", { name: "插入完成", exact: true })
    .click();
  await s.page.keyboard.press("Enter");
  await saved(s.page);
  const mediaBefore = await preview(sheet.id),
    firstSheet = mediaBefore.value.sheets[mediaBefore.value.sheetOrder[0]];
  const richCell = firstSheet.cellData[0][3];
  assert.equal(richCell.p.drawingsOrder.length, 2);
  await s.page.reload();
  await s.page.locator(".uos-editor__select-all").waitFor();
  await saved(s.page);
  const grid = s.page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  // Resolve the cell through native name selection, then leave editing before preview.
  await select("D1");
  await s.page.keyboard.press("Escape");
  const gridBox = await grid.boundingBox();
  assert(gridBox);
  await grid.click({ position: { x: 48 + 3 * 79.2 + 12, y: 22 + 12 } });
  await s.page
    .getByRole("dialog", { name: "Image gallery", exact: true })
    .waitFor();
  await s.page.screenshot({
    path: join(output, "sheet-inline-image-preview.png"),
  });
  await s.page.keyboard.press("Escape");
  assert.equal((await preview(sheet.id)).seq, mediaBefore.seq);
  assert.equal(peer.updates.length, 0);
  pass(
    "two in-cell images upload, persist, reload and preview without content writes or peer echo",
  );
  await mode(s.page, "阅读");
  await s.page.setViewportSize({ width: 1280, height: 900 });
  const idleCanvas = await preview(imageDoc.id),
    idleSheet = await preview(sheet.id);
  const counts = [
    a.updates.length,
    b.updates.length,
    s.updates.length,
    peer.updates.length,
  ];
  for (let n = 0; n < 6; n++) {
    await delay(10000);
    if (n % 3 === 2) console.log(`Idle observation ${(n + 1) * 10} seconds`);
  }
  assert.deepEqual(
    [a.updates.length, b.updates.length, s.updates.length, peer.updates.length],
    counts,
  );
  assert.equal((await preview(imageDoc.id)).seq, idleCanvas.seq);
  assert.equal((await preview(sheet.id)).seq, idleSheet.seq);
  assert.deepEqual(errors, []);
  pass(
    "60 seconds of two-editor idle, readonly and resize produce zero writes",
  );
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      {
        result: "passed",
        canvasVersion: packageVersions["@smartdoca/canvas"],
        sheetVersion: packageVersions["@smartdoca/sheet"],
        checks,
        errors,
        idleSeconds: 60,
      },
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
