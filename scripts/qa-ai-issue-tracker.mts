// Real local Doca/browser acceptance with synthetic documents and no paid model.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { openDatabase, type Schema } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { editAIDocument, readAIDocument } from "../packages/core/src/workflows/ai-documents.js";
import { createAIRunner } from "../apps/server/src/services/ai/runner.js";
import { saveChatMessage } from "../apps/server/src/services/ai/memory.js";

const root = await mkdtemp(join(tmpdir(), "doca-issue-ai-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({ version: 1, stores: { local: { provider: "local", root } } });
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } = await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const actor = { ...await createUser(db, { login: "issueai", displayName: "Issue QA", password: "isolated-issue-ai-2026" }, { bootstrap: true }), admin: 1 };
const content = createContent(db), ctx = { actor };
const board = await content.create(actor, { kind: "document", format: "canvas", title: "AI issue QA phone" });
const initial = await readAIDocument(db, ctx, board.id);
await editAIDocument(db, ctx, board.id, { seq: initial.seq, epochId: initial.epochId! }, [{
  type: "createContainer", id: "qa-phone", containerType: "phone", title: "阅读首页", x: 40, y: 40,
  children: [
    { id: "qa-card", tag: "Rect", x: 24, y: 120, width: 342, height: 190, fill: "#eaf1ff", cornerRadius: 16 },
    { id: "qa-heading", tag: "Text", x: 40, y: 140, width: 300, height: 40, text: "今日阅读", fontSize: 24, fill: "#183153" },
    { id: "qa-body", tag: "Text", x: 40, y: 195, width: 300, height: 60, text: "内容属于手机容器\n移动手机时整页一起移动", fontSize: 16, fill: "#334155" },
  ],
}], randomUUID());
const phoneBefore = await readAIDocument(db, ctx, board.id);
const phone = (phoneBefore.value as any).scene.children.find((node: any) => node.id === "qa-phone");
assert(phone.children.some((node: any) => node.id === "qa-card"));
assert(!(phoneBefore.value as any).scene.children.some((node: any) => node.id === "qa-card"));
const sheet = await content.create(actor, { kind: "document", format: "spreadsheet", title: "AI issue QA cell colors" });
const beforeSheet = await readAIDocument(db, ctx, sheet.id), sheetId = (beforeSheet.value as any).sheetOrder[0];
await editAIDocument(db, ctx, sheet.id, { seq: beforeSheet.seq, epochId: beforeSheet.epochId! }, [{ type: "cells", sheetId, cells: [
  { row: 0, column: 0, v: "实际背景色", s: { bg: { rgb: "#FFCC00" }, bl: 1 } },
  { row: 1, column: 0, v: "蓝色", s: { bg: { rgb: "#3370FF" }, cl: { rgb: "#FFFFFF" } } },
] }], randomUUID());

const now = new Date().toISOString();
const session: Schema["ai_sessions"] = { id: randomUUID(), user_id: actor.id, title: "画布导出交付", model_id: null, resource_ids: JSON.stringify([board.id]), mentioned_resource_ids: "[]", approved_resource_ids: "[]", archived: 0, revision: 1, created_at: now, updated_at: now };
const job: Schema["ai_jobs"] = { id: randomUUID(), session_id: session.id, user_id: actor.id, model_id: "mcp-client", status: "running", input: JSON.stringify({ text: "将当前画面发我PNG", scope: "all", references: [], attachments: [], files: [], skillIds: [], webSearch: false }), digest: "export", result: "", error: "", lease: randomUUID(), lease_until: new Date(Date.now() + 120000).toISOString(), attempts: 1, cancelled: 0, created_at: now, updated_at: now };
await db.insertInto("ai_sessions").values(session).execute();
await db.insertInto("ai_jobs").values(job).execute();
const storage = storageRuntime();
const memoryConfig = { driver: "sqlite" as const, url: join(root, "memory.db") };
const exporter = createAIRunner(db, { storage, memory: memoryConfig, fetch: async () => { throw new Error("Export must not call a model"); } });
const memory = await exporter.ensureThread(session);
await saveChatMessage(memory.memory, actor.id, session.id, job.id, "user", "将当前画面发我PNG", [], []);
const tools = await exporter.externalTools(job, new AbortController().signal, { actor, session, allowsTool: id => id === "canvas_export", allowsSkill: () => true, authorize: async () => {} });
const exportRequest = randomUUID();
const exported: any = (await tools.call("canvas_export", { resourceId: board.id, name: "画布验收.png" }, exportRequest)).output;
assert(exported.ok);
const repeated: any = (await tools.call("canvas_export", { resourceId: board.id, name: "画布验收.png" }, exportRequest)).output;
assert.equal(repeated.file.id, exported.file.id);
const saved = await db.selectFrom("ai_jobs").select("result").where("id", "=", job.id).executeTakeFirstOrThrow();
const completedResult = JSON.parse(saved.result);
completedResult.progress.text = "画布图片已导出，请通过下方文件卡片下载。";
completedResult.progress.phase = "completed";
await db.updateTable("ai_jobs").set({ status: "completed", lease: null, lease_until: null, result: JSON.stringify(completedResult) }).where("id", "=", job.id).execute();
await saveChatMessage(memory.memory, actor.id, session.id, `${job.id}-answer`, "assistant", "画布图片已导出，请通过下方文件卡片下载。", [], []);
await exporter.close();
const port = Number(process.env.DOCA_QA_PORT ?? 39487), origin = `http://127.0.0.1:${port}`;
const app = await createApp(db, { origin, storage, ai: { memory: memoryConfig } });
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({ configFile: resolve("apps/web/vite.config.ts"), server: { hmr: false, watch: { ignored: ["**/*"] }, host: "127.0.0.1", port, strictPort: true, proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } } } });
await web.listen();
const output = resolve(process.env.DOCA_QA_OUTPUT ?? "artifacts/verification/issue-tracker-2026-10-21/ai-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const request = async (path: string, data?: unknown, method = "GET") => {
    const response = await context.request.fetch(origin + "/api/v1" + path, { method, headers: { origin }, data });
    assert(response.ok(), await response.text()); return response.json();
  };
  await request("/auth/login", { login: "issueai", password: "isolated-issue-ai-2026" }, "POST");
  const profile = await request("/me/browser-clipper/profiles", { name: "Browser source QA", enabled: true, isDefault: true, strategy: "create", libraryId: null, parentId: null, targetId: null, titleTemplate: "{title}", aiInstruction: "" }, "POST");
  const verifier = randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const activation = await request("/me/browser-clipper/authorize", { version: 2, installationId: randomUUID(), challenge: createHash("sha256").update(verifier).digest("hex") }, "POST");
  const extension = async (path: string, data: unknown, token = "") => {
    const response = await context.request.post(origin + "/api/v1/browser-clipper" + path, { headers: { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", authorization: `Bearer ${token}`, cookie: "" }, data });
    assert(response.ok(), await response.text()); return response.json();
  };
  const connection = await extension("/token", { version: 2, code: activation.code, verifier });
  const browserSession = await extension("/assistant/sessions", { profileId: profile.id, profileRevision: profile.revision }, connection.token);
  await db.updateTable("ai_sessions").set({ title: "网页研究记录" }).where("id", "=", browserSession.id).execute();
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/#/ai?session=${browserSession.id}`);
  await page.locator(".ai-chat-header .ai-session-source").filter({ hasText: "浏览器助手" }).waitFor();
  await page.locator(".ai-session-list .ai-session-source").filter({ hasText: "浏览器助手" }).waitFor();
  assert.equal((await request(`/ai/sessions/${browserSession.id}`)).session.source, "browser_assistant");
  await page.reload();
  await page.locator(".ai-chat-header .ai-session-source").filter({ hasText: "浏览器助手" }).waitFor();
  await page.screenshot({ path: join(output, "browser-assistant-source.png") });
  await page.goto(`${origin}/#/r/${board.id}`);
  await page.locator(".canvas-host canvas").first().waitFor();
  await delay(900);
  await page.screenshot({ path: join(output, "phone-container.png") });
  assert.deepEqual(await readAIDocument(db, ctx, board.id), phoneBefore);
  await page.goto(`${origin}/#/ai?session=${session.id}`);
  await writeFile(join(output, "export-history.json"), JSON.stringify(await request(`/ai/sessions/${session.id}`), null, 2));
  await page.locator(".ai-file-card").filter({ hasText: "画布验收.png" }).first().waitFor().catch(async error => {
    await page.screenshot({ path: join(output, "export-failure.png") });
    await writeFile(join(output, "export-failure.txt"), await page.locator("body").innerText());
    throw error;
  });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".ai-file-card-thumb")].some(image => image.naturalWidth > 0));
  await page.screenshot({ path: join(output, "canvas-export-card.png") });
  const downloaded = await context.request.get(origin + exported.file.downloadUrl);
  assert(downloaded.ok());
  assert.equal((await sharp(await downloaded.body()).metadata()).format, "png");
  await page.reload();
  await page.locator(".ai-file-card").filter({ hasText: "画布验收.png" }).first().waitFor();
  await db.updateTable("resources").set({ deleted_at: new Date().toISOString() }).where("id", "=", board.id).execute();
  await page.reload();
  await page.locator(".ai-file-card").filter({ hasText: "画布验收.png" }).first().waitFor();
  assert.equal((await request(`/ai/sessions/${session.id}`)).session.resource_ids, "[]");
  assert((await context.request.get(origin + exported.file.downloadUrl)).ok());
  await page.screenshot({ path: join(output, "deleted-source-chat.png") });
  const fresh = await request("/ai/sessions", { resourceIds: [] }, "POST");
  assert(fresh.id);
  await page.goto(`${origin}/#/r/${sheet.id}`);
  await page.locator(".uos-editor__select-all").waitFor();
  await delay(1000);
  const sheetPng = await page.screenshot({ path: join(output, "spreadsheet-colors.png") });
  const { data: pixels, info } = await sharp(sheetPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let yellow = 0, blue = 0;
  for (let index = 0; index < pixels.length; index += info.channels) {
    if (pixels[index]! > 240 && pixels[index + 1]! > 190 && pixels[index + 1]! < 220 && pixels[index + 2]! < 20) yellow++;
    if (pixels[index]! > 35 && pixels[index]! < 75 && pixels[index + 1]! > 95 && pixels[index + 1]! < 130 && pixels[index + 2]! > 240) blue++;
  }
  assert(yellow > 400, `Yellow cell background absent (${yellow} pixels)`);
  assert(blue > 400, `Blue cell background absent (${blue} pixels)`);
  assert.deepEqual(errors, []);
  assert.equal((await db.selectFrom("ai_calls").select("id").execute()).length, 0);
  await writeFile(join(output, "browser.json"), JSON.stringify({ result: "passed", browserAssistantOriginInListAndHistoryAfterReload: true, phoneHierarchy: true, canvasExportCardAndAuthorizedPng: true, exportReplaySingleFile: true, deletedSourceChatAndFileRetained: true, newSessionAfterDeletion: true, spreadsheetBackgroundPixels: { yellow, blue }, errors, paidModelCalls: 0 }, null, 2) + "\n");
  console.log("PASS phone hierarchy, native spreadsheet colors, PNG file card/download/replay, deleted-source chat and new session; zero model calls");
} finally {
  await browser.close(); await web.close(); await app.close(); await db.destroy(); await rm(root, { recursive: true, force: true });
}
