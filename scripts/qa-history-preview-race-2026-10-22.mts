// Real Doca UI and authorized snapshot responses; isolated accounts/data only.
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

const temporary = await mkdtemp(join(tmpdir(), "doca-history-preview-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: temporary } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } = await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
await createUser(db, {
  login: "historyraceqa", displayName: "History race QA",
  password: "isolated-history-preview-2026",
}, { bootstrap: true });
const origin = "http://127.0.0.1:39448";
const app = await createApp(db, {
  origin, storage: { ...storageRuntime(), root: temporary },
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(temporary, "vite-cache"),
  server: {
    host: "127.0.0.1", port: 39448, strictPort: true, hmr: false,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(process.env.DOCA_QA_OUTPUT ??
  "artifacts/verification/issue-tracker-2026-10-21/history-preview-browser");
await mkdir(output, { recursive: true });
const checks: string[] = [], errors: string[] = [], transport: unknown[] = [];
const pass = (text: string) => { checks.push(text); console.log("PASS " + text); };
async function until(predicate: () => Promise<boolean>, label: string) {
  for (let n = 0; n < 150; n++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
}
let page: Page | undefined;
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"] });
  const request = async (path: string, data?: unknown, method = "GET") => {
    const response = await context.request.fetch(origin + "/api/v1" + path,
      { method, data, headers: { origin } });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await request("/auth/login", { login: "historyraceqa",
    password: "isolated-history-preview-2026" }, "POST");
  const resource = await request("/resources", {
    kind: "document", format: "markdown", title: "History preview race QA",
  }, "POST");
  const sharp = (await import("sharp")).default;
  const assets: string[] = [];
  for (const [name, color] of [["A-first.png", "#a21c36"], ["A-second.png", "#dfb129"],
    ["B-first.png", "#195bbf"], ["B-second.png", "#149d73"]]) {
    const response = await context.request.post(origin +
      `/api/v1/assets?purpose=attachment&resourceId=${resource.id}&filename=${name}`, {
      headers: { origin, "content-type": "application/octet-stream" },
      data: await sharp({ create: { width: 160, height: 100, channels: 4,
        background: color! } }).png().toBuffer(),
    });
    assert.equal(response.status(), 201, await response.text());
    assets.push((await response.json()).id);
  }
  page = await context.newPage();
  page.setDefaultTimeout(18000);
  const updates: unknown[] = [];
  page.on("pageerror", e => errors.push(e.stack ?? e.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("websocket", socket => socket.on("framesent", ({ payload }) => {
    try { const frame = JSON.parse(String(payload)); if (frame.type === "update") updates.push(frame); } catch {}
  }));
  const aborted: string[] = [];
  page.on("requestfailed", req => {
    if (req.url().includes("/versions/")) aborted.push(req.url());
  });
  await page.goto(origin + "/#/r/" + resource.id);
  const input = page.locator('.cm-content[contenteditable="true"]');
  await input.waitFor();
  const versions: string[] = [];
  for (const [name, offset] of [["A", 0], ["B", 2]] as const) {
    await input.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate(text => navigator.clipboard.writeText(text),
      `# Snapshot ${name}\n\n![${name} first](${assets[offset]})\n\n![${name} second](${assets[offset + 1]})`);
    await page.keyboard.press("ControlOrMeta+v");
    await until(async () => (await request(`/ai/resources/${resource.id}/preview`))
      .markdown?.includes(`# Snapshot ${name}`) ?? false, `native ${name} content persists`);
    versions.push((await request(`/resources/${resource.id}/versions`, undefined, "POST")).id);
  }
  const before = await db.selectFrom("document_states").select("seq")
    .where("resource_id", "=", resource.id).executeTakeFirstOrThrow();
  const writesBefore = updates.length;
  const list = (await request(`/resources/${resource.id}/versions`)).items;
  const rowIndex = (version: string) => list.findIndex((item: {id: string}) => item.id === version);
  const history = page.getByRole("dialog", { name: "历史记录", exact: true });
  const preview = page.locator(".version-preview-dialog");
  const imageDialog = page.locator(".document-image-preview");
  const image = page.locator(".document-image-preview-viewport img");
  const openHistory = async () => {
    await page!.getByRole("button", { name: "查看历史记录", exact: true }).click();
    await history.locator(".record-row").nth(rowIndex(versions[0]!)).waitFor();
  };
  const view = (version: string) => history.locator(".record-row").nth(rowIndex(version))
    .getByRole("button", { name: "查看", exact: true });
  const held = new Map<string, { release: () => void; started: boolean; delivered: boolean }>();
  const gates = new Map<string, Promise<void>>();
  const hold = (version: string) => {
    let release = () => {};
    gates.set(version, new Promise<void>(resolve => { release = resolve; }));
    const state = { release, started: false, delivered: false }; held.set(version, state);
    return state;
  };
  await page.route(`**/api/v1/resources/${resource.id}/versions/*`, async route => {
    const version = route.request().url().split("/").at(-1)!;
    const response = await route.fetch(); // Always the real authorized snapshot response.
    const state = held.get(version);
    if (state) { state.started = true; await gates.get(version); }
    try { await route.fulfill({ response }); }
    catch (e) { transport.push({ version, cancelled: String(e) }); }
    if (state) state.delivered = true;
    transport.push({ version, status: response.status(), held: !!state });
  });
  await openHistory();
  const slow = hold(versions[0]!);
  await view(versions[0]!).click();
  await until(async () => slow.started, "A request held after authorized response");
  await view(versions[1]!).click();
  await preview.getByRole("heading", { name: "Snapshot B", exact: true }).last().waitFor();
  await preview.locator('[data-exmd-preview-kind="image"]').first().click();
  await until(async () => (await image.getAttribute("src"))?.includes(assets[2]!) ?? false,
    "B gallery uses B original asset");
  slow.release();
  await until(async () => slow.delivered, "late A response was released");
  await delay(250);
  assert.equal(await imageDialog.getAttribute("aria-label"), "B first");
  assert.equal(await preview.locator('[data-exmd-preview-kind="image"]').count(), 2);
  assert.equal(await preview.getByRole("heading", { name: "Snapshot A", exact: true }).count(), 0);
  await page.screenshot({ path: join(output, "latest-wins-B-gallery.png") });
  pass("Actual View clicks A(slow) then B(fast) keep B and its gallery after A is released");
  held.clear(); gates.clear();

  // Public DOM button activation isolates the state boundary while a modal is
  // already open. It invokes the real View handler, never editor/model internals.
  await view(versions[0]!).evaluate((button: HTMLButtonElement) => button.click());
  await preview.getByRole("heading", { name: "Snapshot A", exact: true }).last().waitFor();
  await imageDialog.waitFor({ state: "detached" });
  await preview.locator('[data-exmd-preview-kind="image"]').first().click();
  await until(async () => (await image.getAttribute("src"))?.includes(assets[0]!) ?? false,
    "new snapshot starts at its first image");
  assert.equal(await page.locator(".document-image-preview-position").textContent(), "1 / 2");
  await page.screenshot({ path: join(output, "snapshot-A-gallery-reset.png") });
  pass("Changing accepted snapshot identity unmounts the previous Markdown gallery and starts A at 1/2");
  const sameImage = await image.elementHandle();
  assert(sameImage);
  const imageBounds = await image.boundingBox();
  assert(imageBounds);
  await page.mouse.move(imageBounds.x + 30, imageBounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(imageBounds.x + 90, imageBounds.y + 55, { steps: 5 });
  await page.mouse.up();
  const panBeforeRefresh = await image.getAttribute("style");
  const refreshed = page.waitForResponse(response => response.url().endsWith(`/versions/${versions[0]}`));
  await view(versions[0]!).evaluate((button: HTMLButtonElement) => button.click());
  await refreshed;
  await delay(150);
  assert(await sameImage.evaluate(element => element.isConnected));
  assert.equal(await image.getAttribute("style"), panBeforeRefresh);
  assert.equal(await imageDialog.getAttribute("aria-label"), "A first");
  pass("Refreshing the same immutable snapshot keeps its open gallery and current pan without remounting or rewriting data");
  await page.keyboard.press("Escape");
  await preview.getByRole("button", { name: "关闭", exact: true }).last().click();

  const closing = hold(versions[0]!);
  await view(versions[0]!).click();
  await until(async () => closing.started, "pending request before close");
  await history.getByRole("button", { name: "关闭", exact: true }).first().click();
  closing.release();
  await until(async () => closing.delivered, "closed request released");
  await delay(250);
  assert.equal(await preview.count(), 0);
  await openHistory();
  assert.equal(await preview.count(), 0);
  pass("Closing the history panel cancels pending preview and late completion cannot reopen it, including after reopening history");
  held.clear(); gates.clear();

  const navigating = hold(versions[0]!);
  await view(versions[0]!).click();
  await until(async () => navigating.started, "pending request before unmount");
  await page.goto(origin + "/#/home");
  navigating.release();
  await until(async () => navigating.delivered, "unmounted request released");
  await delay(250);
  assert.equal(await preview.count(), 0);
  assert.equal(await imageDialog.count(), 0);
  pass("Navigating away unmounts history and ignores its late preview response");
  assert(aborted.length >= 3, "superseded, closed and unmounted fetches are aborted");
  assert.deepEqual(await db.selectFrom("document_states").select("seq")
    .where("resource_id", "=", resource.id).executeTakeFirstOrThrow(), before);
  assert.equal(updates.length, writesBefore);

  // Exercise the same keyed boundary with the native Canvas surface preview.
  held.clear(); gates.clear();
  const canvas = await request("/resources", {
    kind: "document", format: "canvas", title: "Canvas history identity QA",
  }, "POST");
  await page.goto(origin + "/#/r/" + canvas.id);
  await page.locator(".canvas-host").waitFor();
  const canvasVersions: string[] = [];
  for (const [name, color] of [["canvas-A.png", "#a21c36"], ["canvas-B.png", "#195bbf"]]) {
    await page.locator('.board-tools input[type="file"][accept="image/*"], input[type="file"][accept="image/*"]')
      .first().setInputFiles({ name: name!, mimeType: "image/png",
        buffer: await sharp({ create: { width: 160, height: 100, channels: 4,
          background: color! } }).png().toBuffer() });
    await until(async () => {
      const result = await request(`/ai/resources/${canvas.id}/preview`);
      const { CanvasModel } = await import("@smartdoca/canvas/model");
      const model = CanvasModel.restore({ codec: "aidcanvas-yjs", schemaVersion: 1,
        epochId: result.surface.epochId,
        update: new Uint8Array(Buffer.from(result.surface.update, "base64")) });
      try { return JSON.stringify(model.getValue()).includes(name!); }
      finally { model.dispose(); }
    }, `Canvas ${name} native upload persists`);
    canvasVersions.push((await request(`/resources/${canvas.id}/versions`, undefined, "POST")).id);
  }
  const canvasBefore = await db.selectFrom("document_states").select("seq")
    .where("resource_id", "=", canvas.id).executeTakeFirstOrThrow();
  const canvasWrites = updates.length;
  const canvasList = (await request(`/resources/${canvas.id}/versions`)).items;
  await page.getByRole("button", { name: "查看历史记录", exact: true }).click();
  const canvasView = (version: string) => history.locator(".record-row")
    .nth(canvasList.findIndex((item: {id: string}) => item.id === version))
    .getByRole("button", { name: "查看", exact: true });
  await canvasView(canvasVersions[1]!).click();
  await preview.locator(".canvas-host").waitFor();
  await delay(250);
  const fitCanvasPreview = async () => {
    await preview.getByRole("button", { name: "主菜单", exact: true }).click();
    await preview.getByRole("menuitem", { name: /适合画布/ }).click();
    await delay(200);
  };
  await fitCanvasPreview();
  const canvasHost = preview.locator(".canvas-host");
  const bounds = await canvasHost.boundingBox();
  assert(bounds);
  await canvasHost.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  if (!(await imageDialog.count())) {
    await delay(250);
    await canvasHost.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  }
  await imageDialog.waitFor();
  assert.equal(await page.locator(".document-image-preview-position").textContent(), "2 / 2");
  await canvasView(canvasVersions[0]!).evaluate((button: HTMLButtonElement) => button.click());
  await imageDialog.waitFor({ state: "detached" });
  await preview.locator(".canvas-host").waitFor();
  await delay(250);
  await fitCanvasPreview();
  await preview.locator(".canvas-host").click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  if (!(await imageDialog.count())) {
    await delay(250);
    await preview.locator(".canvas-host").click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  }
  await imageDialog.waitFor();
  assert.equal(await imageDialog.getAttribute("aria-label"), "canvas-A.png");
  assert.equal(await page.locator(".document-image-preview-position").count(), 0);
  await page.screenshot({ path: join(output, "canvas-snapshot-gallery-reset.png") });
  assert.deepEqual(await db.selectFrom("document_states").select("seq")
    .where("resource_id", "=", canvas.id).executeTakeFirstOrThrow(), canvasBefore);
  assert.equal(updates.length, canvasWrites);
  pass("Canvas history switches from the two-image snapshot to the original one-image snapshot, closes the old gallery and preserves both document sequences");
  assert.deepEqual(errors, []);
  pass("History races, gallery navigation and close/unmount produce zero document updates and no page errors");
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, errors, transport,
    aborted, resourceId: resource.id, versions, seq: before.seq,
    canvasResourceId: canvas.id, canvasVersions, canvasSeq: canvasBefore.seq,
    contentUpdates: updates.length - canvasWrites }, null, 2));
  await rm(join(output, "failure.txt"), { force: true });
  await rm(join(output, "failure.png"), { force: true });
} catch (error) {
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  await writeFile(join(output, "failure.txt"), String(error));
  throw error;
} finally {
  await browser.close(); await web.close(); await app.close(); await db.destroy();
  await rm(temporary, { recursive: true, force: true });
}
