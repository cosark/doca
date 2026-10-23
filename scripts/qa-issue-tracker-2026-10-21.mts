// Website acceptance for the tracker: creates only isolated synthetic data.
// DOCA_TEST_POSTGRES, when supplied, must name a dedicated disposable test server.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { zipSync, strToU8 } from "fflate";
import sharp from "sharp";
import { openTestDatabase } from "../tests/database.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";

const temporary = await mkdtemp(join(tmpdir(), "doca-tracker-qa-"));
const output = resolve(process.env.DOCA_QA_OUTPUT ?? "artifacts/verification/issue-tracker-2026-10-21/host-browser");
const stages = new Set((process.env.DOCA_QA_STAGES ?? "favicon,search,mentions,plugins").split(","));
const port = Number(process.env.DOCA_QA_PORT ?? "39461");
assert(port > 1024 && port < 65536);
const origin = `http://127.0.0.1:${port}`;
await mkdir(output, { recursive: true });
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({ version: 1, stores: { local: { provider: "local", root: join(temporary, "files") } } });
// This acceptance never needs a real store, model vendor or configured deployment.
process.env.DOCA_PLUGIN_STORE_URL = "https://isolated-store.invalid";
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } = await import("../apps/server/src/adapters/storage.js");
const { databaseConfig } = await import("../packages/db/src/connection.js");
const { PLUGIN_SDK_VERSION } = await import("../packages/plugin-sdk/src/version.js");
const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
const owner = await createUser(db, { login: "trackerqa", displayName: "Tracker QA owner", password: "isolated-tracker-qa-2026" }, { bootstrap: true });
await createUser(db, { login: "trackermember", displayName: "Tracker QA member", password: "isolated-tracker-member-2026" }, { actor: { ...owner, admin: 1 } });
const appOptions = { origin, storage: storageRuntime(), pluginDirectory: join(temporary, "plugins"), ai: { memory: { driver: "sqlite" as const, url: ":memory:" } } };
let app = await createApp(db, appOptions);
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const backendPort = address.port;
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(temporary, "vite-cache"),
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, proxy: { "/api": { target: `http://127.0.0.1:${backendPort}`, ws: true } } },
});
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
type Check = { rows: number[]; name: string; result: "passed" | "failed"; details?: unknown; screenshot?: string };
const checks: Check[] = [], pageErrors: string[] = [];
let currentPage: Page | undefined;
const packages = JSON.parse(await readFile("package.json", "utf8")).dependencies;
const until = async (predicate: () => Promise<boolean>, label: string, attempts = 150) => {
  for (let n = 0; n < attempts; n++) { if (await predicate()) return; await delay(100); }
  throw Error(`Timed out: ${label}`);
};
const request = async (path: string, data?: unknown, method = "GET", contentType?: string) => {
  const response = await context.request.fetch(origin + "/api/v1" + path, { method, headers: { origin, ...(contentType ? { "Content-Type": contentType } : {}) }, data });
  assert.equal(response.status(), 200, `${method} ${path}: ${await response.text()}`);
  return response.json();
};
const page = async () => {
  const value = await context.newPage(); value.setDefaultTimeout(20000);
  value.on("pageerror", error => pageErrors.push(error.message)); currentPage = value; return value;
};
const screenshot = async (p: Page, name: string) => { const file = `${name}.png`; await p.screenshot({ path: join(output, file), fullPage: false }); return file; };
const record = (rows: number[], name: string, details?: unknown, image?: string) => { checks.push({ rows, name, result: "passed", details, screenshot: image }); console.log("PASS " + rows.join(",") + " " + name); };
const run = async (rows: number[], name: string, operation: () => Promise<void>) => {
  try { await operation(); }
  catch (error) { checks.push({ rows, name, result: "failed", details: String(error), screenshot: currentPage ? await screenshot(currentPage, "failure-" + rows.join("-")).catch(() => undefined) : undefined }); throw error; }
};
const create = (format: string, title: string) => request("/resources", { kind: "document", format, title }, "POST");
const iconSvg = async (href: string) => {
  if (href.startsWith("data:")) {
    const comma = href.indexOf(","), encoded = href.slice(comma + 1);
    return href.slice(0, comma).endsWith(";base64") ? Buffer.from(encoded, "base64").toString("utf8") : decodeURIComponent(encoded);
  }
  const response = await context.request.get(new URL(href, origin).href);
  assert.equal(response.status(), 200); return response.text();
};
const seq = async (id: string) => (await db.selectFrom("document_states").select("seq").where("resource_id", "=", id).executeTakeFirst())?.seq ?? 0;
const idleUpdates = new Map<string, number>();
function fixture(id: string) {
  const manifest = { schemaVersion: 1, id, version: "1.0.0", displayName: "Tracker " + id, sdkRange: "^" + PLUGIN_SDK_VERSION };
  const source = `const sql = {id:'storage.sql.v1'}, http = {id:'http.v1'};
export default () => ({manifest:${JSON.stringify(manifest)},injections:{required:[sql,http]},
async initialize(ctx) { const db = ctx.inject(sql); await db.defineSchema({version:1,tables:{notes:{columns:{id:{type:'text',nullable:false},value:{type:'text',nullable:false}},primaryKey:['id'],unique:[]}}}); if (!(await db.select('notes')).length) await db.insert('notes',[{id:'same-row-id',value:${JSON.stringify(id)}}]); },
async mount(ctx) { const db = ctx.inject(sql); await ctx.inject(http).register(${JSON.stringify(id)},[{method:'GET',path:'/identity',async handle() { return {rows:await db.select('notes')}; }}]); },
async uninstall() {}});`;
  return zipSync({ "package.json": strToU8(JSON.stringify({ name: id, version: "1.0.0", type: "module", doca: { dataVersion: "1", storage: "host", manifest: "./manifest.json", server: "./server.js" } })), "manifest.json": strToU8(JSON.stringify(manifest)), "server.js": strToU8(source) }, { mtime: new Date("2020-01-01T00:00:00Z") });
}
let caught: unknown;
try {
  await request("/auth/login", { login: "trackerqa", password: "isolated-tracker-qa-2026" }, "POST");
  if (stages.has("favicon")) await run([21], "type favicon", async () => {
    const p = await page(), observations: unknown[] = [];
    for (const format of ["rich_text", "markdown", "spreadsheet", "canvas", "presentation"]) {
      const resource = await create(format, `Tracker ${format}`);
      await p.goto(origin + "/#/r/" + resource.id);
      const expectedSvg = (await readFile(`apps/web/src/shared/assets/document-icons/${format}.svg`, "utf8")).trim();
      await until(async () => {
        const current = await p.locator('link[rel="icon"]').getAttribute("href");
        if (!current || current.endsWith("/favicon.svg")) return false;
        const actual = await iconSvg(current);
        return p.evaluate(({ actual, expected }) => {
          const parser = new DOMParser();
          return parser.parseFromString(actual, "image/svg+xml").documentElement.isEqualNode(parser.parseFromString(expected, "image/svg+xml").documentElement);
        }, { actual: actual.trim(), expected: expectedSvg });
      }, format + " type icon");
      const href = await p.locator('link[rel="icon"]').getAttribute("href");
      assert(href);
      assert((await iconSvg(href)).includes("<svg"));
      observations.push({ format, href }); idleUpdates.set(resource.id, await seq(resource.id));
      await screenshot(p, "row21-" + format);
      await p.reload();
      await until(async () => (await p.locator('link[rel="icon"]').getAttribute("href")) === href, "favicon after reload");
    }
    record([21], "all five no-emoji document types use their actual type favicon and retain it on reload", observations);
  });
  if (stages.has("search")) await run([19], "file search navigation", async () => {
    const resource = await create("markdown", "Tracker image source document"), p = await page();
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#60a5fa" } }).png().toBuffer();
    const asset = await request(`/files/items?parentType=document&parentId=${resource.id}&filename=tracker-search-picture.png`, png, "POST", "application/octet-stream");
    await db.updateTable("file_storage_objects").set({ ai_description: "tracker-search-picture image for morning navigation", ai_status: "ready" }).where("id", "=", asset.storage_object_id).execute();
    const state = await seq(resource.id);
    await p.goto(origin + "/#/r/" + resource.id);
    await p.locator(".doca-markdown.markdown-sdk-container").waitFor();
    const openSearch = async () => {
      await p.keyboard.press("ControlOrMeta+k");
      await p.getByRole("textbox", { name: "输入关键字", exact: true }).fill("tracker-search-picture");
      await p.locator(".search-file-result").filter({ hasText: "tracker-search-picture.png" }).waitFor();
    };
    // The original report is a file attached to the document already on screen.
    await openSearch();
    await p.locator(".search-file-result").filter({ hasText: "tracker-search-picture.png" }).click();
    await p.locator(".search-dialog").waitFor({ state: "detached" });
    assert.equal(new URL(p.url()).hash, "#/r/" + resource.id);
    await openSearch();
    await p.locator(".search-file-locations button").filter({ hasText: resource.title }).click();
    await p.locator(".search-dialog").waitFor({ state: "detached" });
    assert.equal(new URL(p.url()).hash, "#/r/" + resource.id);
    assert.equal(await seq(resource.id), state);
    record([19], "attached image search result and its location both close search and reveal the existing document without content writes", { resourceId: resource.id, fileId: asset.id }, await screenshot(p, "row19-search-target"));
  });
  if (stages.has("mentions")) await run([3, 16], "sheet mention placement", async () => {
    const resource = await create("spreadsheet", "Tracker mention boundary"), p = await page();
    await p.goto(origin + "/#/r/" + resource.id);
    await p.locator(".uos-editor__select-all").waitFor();
    await p.getByText(/已保存到云端$/).last().waitFor({ state: "attached" });
    const editor = p.locator(".uos-editor"), name = editor.getByRole("textbox", { exact: true });
    await p.setViewportSize({ width: 1200, height: 620 });
    // The native canvas debounces viewport reflow; let that finish before moving the cell.
    await delay(350);
    await name.fill("A30"); await name.press("Enter");
    await delay(150);
    await p.keyboard.press("F2"); await p.keyboard.insertText("@");
    const menu = p.locator(".sheet-native-candidates");
    await menu.locator('[role="option"]').first().waitFor();
    const geometry = await p.evaluate(() => {
      const panel = document.querySelector(".sheet-native-candidates")!.getBoundingClientRect();
      const active = document.activeElement?.getBoundingClientRect();
      const cellEditor = [...document.querySelectorAll('.uos-editor .univer-absolute.univer-z-10.univer-flex')].map(el => el.getBoundingClientRect()).find(rect => rect.width > 1 && rect.height > 1);
      const inputs = [...document.querySelectorAll('[contenteditable="true"],textarea,input')].map(el => ({ tag: el.tagName, rect: el.getBoundingClientRect().toJSON(), active: el === document.activeElement })).filter(x => x.rect.width > 0 && x.rect.height > 0);
      return { menu: panel.toJSON(), cellEditor: cellEditor?.toJSON(), active: active?.toJSON(), inputs, width: innerWidth, height: innerHeight };
    });
    assert(geometry.menu.y >= 7 && geometry.menu.y + geometry.menu.height <= geometry.height - 7, JSON.stringify(geometry));
    assert(geometry.cellEditor, "native cell editor container is visible");
    assert(geometry.menu.y + geometry.menu.height <= geometry.cellEditor.y || geometry.menu.y >= geometry.cellEditor.y + geometry.cellEditor.height, JSON.stringify(geometry));
    const image = await screenshot(p, "row16-sheet-mention-bottom");
    await p.keyboard.press("ArrowUp"); assert(await menu.isVisible());
    await p.keyboard.press("Enter"); await menu.waitFor({ state: "detached" });
    await p.keyboard.press("Enter");
    await until(async () => (await seq(resource.id)) > 0, "mention durable commit");
    await p.reload(); await p.locator(".uos-editor__select-all").waitFor();
    const preview = await request(`/ai/resources/${resource.id}/preview`);
    const { projectExlsxWorkbook } = await import("@smartdoca/sheet/model");
    const value = await projectExlsxWorkbook({ baseline: preview.surface.baseline, update: new Uint8Array(Buffer.from(preview.surface.update, "base64")), checkpointSeq: 0 });
    assert(JSON.stringify(value).includes("exlsxInlineV1"));
    record([3, 16], "bottom-edge sheet mention menu stays inside viewport without covering the active input; ArrowUp retains it and Enter inserts a durable atomic mention", geometry, image);
  });
  const pluginRows = databaseConfig(db).driver === "postgres" ? [7, 9] : [7];
  if (stages.has("plugins")) await run(pluginRows, "plugin database installation", async () => {
    const p = await page(); await p.goto(origin + "/#/admin?tab=plugins");
    await p.locator(".plugin-manager-tabs").getByRole("button", { name: "设置", exact: true }).click();
    const ids = ["tracker.storage.one", "tracker.storage.two"];
    for (const id of ids) {
      await p.locator('.plugin-upload input[type="file"]').setInputFiles({ name: id + ".zip", mimeType: "application/zip", buffer: Buffer.from(fixture(id)) });
      await p.locator(".ant-modal-confirm").getByRole("button", { name: /^确\s*定$/ }).click();
      await p.locator(".ant-modal-confirm").waitFor({ state: "detached" });
      await until(async () => (await request("/admin/plugins")).plugins.some((plugin: any) => plugin.id === id), "plugin install " + id);
      await until(async () => (await p.locator('.plugin-progress-toast').getAttribute("data-status")) === "completed", "plugin install UI completed");
    }
    assert.equal(await p.locator('.plugin-settings input:not([type="file"])').count(), 2); // npm name/version only; no per-plugin database selector.
    await screenshot(p, "row7-plugin-install-staged");
    await p.goto("about:blank");
    await app.close(); app = await createApp(db, appOptions); await app.listen({ host: "127.0.0.1", port: backendPort });
    const identities: unknown[] = [];
    for (const id of ids) {
      const identity = await request(`/plugins/${id}/identity`);
      assert.deepEqual(identity.rows, [{ id: "same-row-id", value: id }]); identities.push(identity);
    }
    const inventory = await request("/admin/plugins"); assert.equal(inventory.restartRequired, false);
    await p.goto(origin + "/#/admin?tab=plugins");
    await p.locator(".plugin-manager-tabs").getByRole("button", { name: "已安装", exact: true }).click();
    await p.getByText("Tracker tracker.storage.one", { exact: true }).waitFor();
    record(pluginRows, "two actual ZIP installations use public storage.sql.v1 in isolated namespaces without per-plugin connection setup; restart restores both rows", { engine: databaseConfig(db).driver, identities, plugins: inventory.plugins.map((item: any) => ({ id: item.id, version: item.version })) }, await screenshot(p, "row7-9-installed-plugins"));
  });
  for (const [id, expected] of idleUpdates) assert.equal(await seq(id), expected);
  assert.deepEqual(pageErrors, []);
} catch (error) { caught = error; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(join(output, "browser.json"), JSON.stringify({ result: caught ? "failed" : "passed", scope: "isolated synthetic accounts/documents only", engine: databaseConfig(db).driver, packages: Object.fromEntries(Object.entries(packages).filter(([name]) => name.startsWith("@smartdoca/") && !String(packages[name]).startsWith("workspace:"))), checks, pageErrors, error: caught ? String(caught) : null, limits: ["Does not establish production deployment acceptance", "Only explicitly listed rows are covered; other tracker rows remain unverified by this script", "No paid model calls are used"] }, null, 2) + "\n");
  await browser.close(); await web.close(); await app.close(); await db.destroy(); await rm(temporary, { recursive: true, force: true });
}
