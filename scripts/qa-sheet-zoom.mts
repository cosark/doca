// Real built Doca, synthetic accounts/documents and isolated databases only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { sheetZoomKey } from "../apps/web/src/features/documents/sheet-zoom-preference.js";
import { captureRuntimeFingerprint } from "./qa-runtime-fingerprint.js";

const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/verification/sheet-zoom-2026-10-23/browser",
);
assert(
  !(await stat(join(output, "results.json")).catch(() => null)),
  "Use a new output directory; preserve retained failures",
);
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "doca-sheet-zoom-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: temporary } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const password = "isolated-sheet-zoom-2026";
const owner = await createUser(
  db,
  { login: "zoomowner", displayName: "Zoom owner", password },
  { bootstrap: true },
);
const other = await createUser(
  db,
  { login: "zoomother", displayName: "Zoom reader", password },
  { actor: { ...owner, admin: 1 } },
);
const port = Number(process.env.DOCA_QA_PORT ?? 39730),
  origin = `http://127.0.0.1:${port}`;
let providerRequests = 0;
const forbidden = async () => {
  providerRequests++;
  throw Error("Zoom QA must never call a model");
};
const app = await createApp(db, {
  origin,
  staticDirectory: resolve("apps/web/dist"),
  storage: storageRuntime(),
  ai: {
    memory: { driver: "sqlite", url: ":memory:" },
    fetch: forbidden,
    imageFetch: forbidden,
  },
});
await app.listen({ host: "127.0.0.1", port });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
const runtimeBefore = await captureRuntimeFingerprint(true);
const checks: any[] = [],
  errors: string[] = [],
  watched: { page: Page; updates: unknown[] }[] = [];
let page: Page | undefined;
const request = async (path: string, data?: unknown, method = "GET") => {
  const response = await context.request.fetch(origin + "/api/v1" + path, {
    method,
    headers: { origin },
    data,
  });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
};
const until = async (check: () => Promise<boolean>, label: string) => {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
};
const watch = async () => {
  const p = await context.newPage(),
    updates: unknown[] = [];
  p.setDefaultTimeout(15000);
  p.on("pageerror", (error) => errors.push(error.message));
  p.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        const value = JSON.parse(String(payload));
        if (value.type === "update") updates.push(value);
      } catch {}
    }),
  );
  watched.push({ page: p, updates });
  return p;
};
const scale = (p: Page) =>
  p.locator(".uos-editor").getByRole("button", { name: /^\d+%$/ });
const scaleValue = async (p: Page) =>
  Number((await scale(p).innerText()).replace("%", ""));
const ready = async (p: Page) => {
  // The native footer mounts before its loading overlay is removed. Wait for
  // SelectAllCorner, which the package renders only after runtime.whenRendered.
  await p.locator(".uos-editor__select-all").waitFor();
  await p
    .getByText(/(?:^| · )已保存到云端$/)
    .last()
    .waitFor({ state: "attached" });
  await scale(p).waitFor();
};
const open = async (p: Page, id: string) => {
  await p.goto(origin + "/#/r/" + id);
  await ready(p);
};
const changeZoom = async (p: Page, target = 0.65) => {
  await p.bringToFront();
  const before = await scaleValue(p);
  const track = p.locator('.uos-editor [role="track"]'),
    handle = track.locator('[role="handle"]');
  const rail = await track.boundingBox(),
    thumb = await handle.boundingBox();
  assert(rail && thumb);
  await p.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await p.mouse.down();
  await p.mouse.move(rail.x + rail.width * target, rail.y + rail.height / 2, {
    steps: 12,
  });
  await p.mouse.up();
  await until(
    async () => (await scaleValue(p)) > 100 && (await scaleValue(p)) !== before,
    "actual native slider drag changes the percentage",
  );
  return scaleValue(p);
};
const stored = async (p: Page, key: string) =>
  p.evaluate((key) => localStorage.getItem(key), key);
const fingerprint = async (ids: string[]) =>
  Promise.all(
    ids.map(async (id) => ({
      id,
      state: await db
        .selectFrom("document_states")
        .selectAll()
        .where("resource_id", "=", id)
        .executeTakeFirstOrThrow(),
    })),
  );
const pass = (name: string, details: unknown = {}) => {
  checks.push({ name, details, result: "passed" });
  console.log("PASS", name);
};
let result: any = {
  result: "running",
  scope: "isolated synthetic built Doca only",
  productionAccepted: false,
  runtimeBefore,
};
try {
  await request("/auth/login", { login: "zoomowner", password }, "POST");
  const a = await request(
    "/resources",
    { kind: "document", format: "spreadsheet", title: "Zoom document A" },
    "POST",
  );
  const b = await request(
    "/resources",
    { kind: "document", format: "spreadsheet", title: "Zoom document B" },
    "POST",
  );
  await request(
    `/resources/${a.id}/permissions`,
    {
      version: a.version,
      visibility: "invited",
      accessMode: "custom",
      grants: [{ userId: other.id, role: "reader" }],
    },
    "PUT",
  );
  page = await watch();
  await open(page, a.id);
  const keyA = sheetZoomKey(owner.id, a.id)!,
    keyB = sheetZoomKey(owner.id, b.id)!;
  assert.equal(await scaleValue(page), 100);
  assert.equal(await stored(page, keyA), null);
  const preview = await request(`/ai/resources/${a.id}/preview`);
  const first = preview.surface.baseline.snapshot.sheetOrder[0];
  assert.equal(
    preview.surface.baseline.snapshot.sheets[first].defaultRowHeight,
    21.78,
  );
  assert.equal(
    preview.surface.baseline.snapshot.sheets[first].defaultColumnWidth,
    87.12,
  );
  await page.screenshot({ path: join(output, "default-100-larger-cells.png") });
  pass(
    "default percentage remains100, new baseline cells are21.78x87.12, opening creates no preference",
  );
  const peer = await watch();
  await open(peer, a.id);
  const beforeA = await fingerprint([a.id]);
  const dragged = await changeZoom(page);
  await until(
    async () =>
      JSON.parse((await stored(page!, keyA)) ?? "null")?.zoomRatio ===
      dragged / 100,
    "dragged zoom committed to the document's browser record",
  );
  await until(
    async () => (await scaleValue(peer)) === dragged,
    "same-browser peer receives preference without a content update",
  );
  const nativeSlider = page
    .locator('.uos-editor [role="track"]')
    .locator("../..");
  const stepButtons = nativeSlider.locator(":scope > button");
  await stepButtons.nth(1).click();
  await until(
    async () => (await scaleValue(page!)) === dragged + 10,
    "plus button zoom",
  );
  await stepButtons.nth(0).click();
  await until(
    async () => (await scaleValue(page!)) === dragged,
    "minus button zoom",
  );
  await page.reload();
  await ready(page);
  await until(
    async () => (await scaleValue(page!)) === dragged,
    "refresh restores last slider percentage",
  );
  assert.deepEqual(await fingerprint([a.id]), beforeA);
  await page.screenshot({ path: join(output, "drag-and-refresh.png") });
  pass(
    "real slider and plus/minus persist, peer updates and refresh restores exact zoom without document writes",
    { dragged },
  );
  await open(page, b.id);
  assert.equal(await scaleValue(page), 100);
  assert.equal(await stored(page, keyB), null);
  await open(page, a.id);
  assert.equal(await scaleValue(page), dragged);
  pass(
    "documentB starts100 while returning to documentA restores its own ratio",
  );
  await peer.close();
  await page.close();
  await request("/auth/login", { login: "zoomother", password }, "POST");
  page = await watch();
  await open(page, a.id);
  assert.equal(await scaleValue(page), 100);
  const keyOther = sheetZoomKey(other.id, a.id)!;
  assert.equal(await stored(page, keyOther), null);
  const otherRatio = await changeZoom(page, 0.72);
  await until(
    async () =>
      JSON.parse((await stored(page!, keyOther)) ?? "null")?.zoomRatio ===
      otherRatio / 100,
    "readonly native zoom saved independently",
  );
  assert.equal(
    JSON.parse((await stored(page, keyA))!).zoomRatio,
    dragged / 100,
  );
  assert.deepEqual(await fingerprint([a.id]), beforeA);
  await page.screenshot({
    path: join(output, "readonly-account-independent.png"),
  });
  pass(
    "a different account on the same browser has a separate readonly zoom, preserving the owner's record",
  );
  await page.close();
  await request("/auth/login", { login: "zoomowner", password }, "POST");
  page = await watch();
  await open(page, a.id);
  assert.equal(await scaleValue(page), dragged);
  const unknown = '{"version":2,"zoomRatio":1.2,"preserve":"original"}';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: keyA,
    raw: unknown,
  });
  await page.reload();
  await ready(page);
  assert.equal(await scaleValue(page), 100);
  await page
    .getByText(
      "本浏览器保存的表格缩放记录格式暂不支持，已保留原记录；本次调整不会覆盖它。",
      { exact: true },
    )
    .waitFor();
  await changeZoom(page);
  assert.equal(await stored(page, keyA), unknown);
  await page.reload();
  await ready(page);
  assert.equal(await scaleValue(page), 100);
  assert.equal(await stored(page, keyA), unknown);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: keyA,
    raw: "{broken",
  });
  await page.reload();
  await ready(page);
  await changeZoom(page);
  assert.equal(await stored(page, keyA), "{broken");
  await page.screenshot({ path: join(output, "unknown-record-preserved.png") });
  pass(
    "unknown versions and malformedJSON stay intact while explicit zoom still works in the mounted view",
  );
  await page.evaluate(
    ({ key, ratio }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, zoomRatio: ratio }),
      ),
    { key: keyA, ratio: dragged / 100 },
  );
  await page.reload();
  await ready(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Denied", "QuotaExceededError");
    };
  });
  await changeZoom(page, 0.7);
  await page
    .getByText("无法在本浏览器保存表格缩放，本次调整仅在当前视图生效。", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    JSON.parse((await stored(page, keyA))!).zoomRatio,
    dragged / 100,
  );
  await page.reload();
  await ready(page);
  assert.equal(await scaleValue(page), dragged);
  pass(
    "denied writes preserve saved zoom and keep explicit current-view choice usable",
  );
  assert.deepEqual(await fingerprint([a.id]), beforeA);
  assert.deepEqual(
    watched.flatMap((item) => item.updates),
    [],
    "Zoom and preference failure handling never send content updates",
  );
  const beforeIdle = await fingerprint([a.id, b.id]);
  for (const item of watched) item.updates.length = 0;
  const started = Date.now();
  await delay(30000);
  console.log("Idle30seconds");
  await delay(30000);
  assert.deepEqual(await fingerprint([a.id, b.id]), beforeIdle);
  assert.deepEqual(
    watched.flatMap((item) => item.updates),
    [],
  );
  assert.deepEqual(errors, []);
  assert.equal(providerRequests, 0);
  pass(
    "60seconds idle and every zoom operation preserve checkpoint/seq and send zero content frames",
    { milliseconds: Date.now() - started },
  );
  result.result = "passed";
} catch (error) {
  result.result = "failed";
  result.error = String(error);
  result.stack = error instanceof Error ? error.stack : undefined;
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  if (page && !page.isClosed())
    await writeFile(join(output, "failure.html"), await page.content()).catch(
      () => {},
    );
  process.exitCode = 1;
} finally {
  result.checks = checks;
  result.pageErrors = errors;
  result.providerRequests = providerRequests;
  result.runtimeAfter = await captureRuntimeFingerprint(true);
  result.runtimeUnchanged =
    JSON.stringify(result.runtimeBefore) ===
    JSON.stringify(result.runtimeAfter);
  if (!result.runtimeUnchanged) {
    result.result = "failed";
    process.exitCode = 1;
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await browser.close();
  await app.close();
  await db.destroy();
  await rm(temporary, { recursive: true, force: true });
}
