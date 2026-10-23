// Reopen this task's retained uncertain synthetic image operation without retrying it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";

assert.equal(process.env.DOCA_QA_ISOLATED, "1");
const input = resolve(".local/issue-tracker-ai-ui-image-final-candidate-2026-10-22");
const result = JSON.parse(await readFile(join(input, "results.json"), "utf8"));
assert.equal(result.isolated, true);
assert.equal(result.paidRequests, 1);
assert.equal(result.result, "failed");
assert.equal(result.stages[0].id, "d742f4c0-e427-4aa6-8206-ca9fc8d57dd4");
process.env.DOCA_CREDENTIAL_MASTER_KEY = (
  await readFile(join(input, ".credential-master-key"), "utf8")
).trim();
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: join(input, "storage") } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } = await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: join(input, "qa.db") });
let providerRequests = 0;
const forbidden: typeof fetch = async () => {
  providerRequests++;
  throw Error("Uncertain inspection must not call or retry a model provider");
};
const origin = "http://127.0.0.1:39490";
const app = await createApp(db, {
  origin,
  storage: storageRuntime(),
  ai: { memory: { driver: "sqlite", url: join(input, "memory.db") }, fetch: forbidden, imageFetch: forbidden },
});
const cache = await mkdtemp(join(tmpdir(), "doca-ai-uncertain-inspection-"));
const output = resolve(process.env.DOCA_QA_OUTPUT ?? "artifacts/verification/ai-ui-uncertain-inspection-2026-10-22");
const canvasVersion = JSON.parse(await readFile("node_modules/@smartdoca/canvas/package.json", "utf8")).version;
await mkdir(output, { recursive: true });
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: cache,
  server: { hmr: false, watch: { ignored: ["**/*"] }, host: "127.0.0.1", port: 39490, strictPort: true, proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } } },
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await web.listen();
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const response = await context.request.post(origin + "/api/v1/auth/login", {
    headers: { origin }, data: { login: "actualissue", password: "isolated-actual-issue-2026" },
  });
  assert(response.ok());
  const callId = "aae0625d-df9f-4118-8762-eb6cac1e5ff3";
  const operationId = "736a328e-1b47-43c0-a85b-a57bc3c0e717";
  const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const retained = async () => ({
    call: await db.selectFrom("ai_calls").selectAll().where("id", "=", callId).executeTakeFirstOrThrow(),
    operation: await db.selectFrom("ai_operations").selectAll().where("id", "=", operationId).executeTakeFirstOrThrow(),
  });
  const beforeRetained = digest(await retained());
  const before = await db.selectFrom("document_states").select(["seq"]).where("resource_id", "=", result.boardId).executeTakeFirstOrThrow();
  const page = await context.newPage();
  const errors: string[] = [], updates: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => socket.on("framesent", ({ payload }) => {
    try { const v = JSON.parse(String(payload)); if (v.type === "update") updates.push(v.id); } catch {}
  }));
  const uncertain = "图片生成未完成，结果和费用待核对，请稍后查看任务记录";
  await page.goto(`${origin}/#/r/${result.boardId}?session=${result.sessionId}`);
  await page.locator(".canvas-host canvas").first().waitFor();
  await page.getByText(uncertain, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
  const retry = page.getByRole("button", { name: "重试任务", exact: true });
  assert.equal(await retry.count(), 1, "Existing uncertain task retains a visible explanation with its disabled retry");
  assert.equal(await retry.isEnabled(), false);
  await page.screenshot({ path: join(output, "uncertain-visible.png") });
  await page.reload();
  await page.locator(".canvas-host canvas").first().waitFor();
  await page.getByText(uncertain, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(await retry.isEnabled(), false);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(output, "uncertain-reload.png") });
  const after = await db.selectFrom("document_states").select(["seq"]).where("resource_id", "=", result.boardId).executeTakeFirstOrThrow();
  assert.equal(after.seq, before.seq);
  assert.deepEqual(updates, []);
  assert.deepEqual(errors, []);
  assert.equal(providerRequests, 0);
  assert.equal(digest(await retained()), beforeRetained);
  await writeFile(join(output, "results.json"), JSON.stringify({ result: "uncertain_feedback_and_retention_passed", canvas: canvasVersion, input, jobId: result.stages[0].id, callId, operationId, seq: after.seq, sceneWrites: 0, errors, providerRequests, retainedRecordsSha256: beforeRetained, retainedRecordsUnchanged: true, feedbackVisibleAfterReload: true, unsafeRetryDisabledAfterReload: true, generationContentPassed: false, originalUsageStillUnknown: true }, null, 2) + "\n");
  console.log("PASS uncertain feedback/reload, retained call/operation unchanged and zero provider requests");
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(cache, { recursive: true, force: true });
}
