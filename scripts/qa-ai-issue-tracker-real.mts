// Explicit isolated acceptance against already-configured providers. The source
// configuration database is opened read-only and is never passed to createApp.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { openDatabase, type Schema } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { aiConfig, saveAIConfig } from "../packages/core/src/modules/ai/config.js";
import { readAIDocument } from "../packages/core/src/workflows/ai-documents.js";
import { provisionSurface } from "../packages/core/src/modules/documents/codecs/surfaces.js";
import { rejectedExistingCanvasContainer } from "./qa-ai-negative-evidence.js";

assert.equal(process.env.DOCA_QA_ISOLATED, "1");
assert(process.env.DOCA_QA_CONFIG_DB, "Pass an explicit read-only source configuration DB");
const source = new Kysely<Schema>({ dialect: new SqliteDialect({ database: new Database(resolve(process.env.DOCA_QA_CONFIG_DB), { readonly: true, fileMustExist: true }) }) });
const configured = await aiConfig(source);
await source.destroy();
const sourcePath = resolve(process.env.DOCA_QA_CONFIG_DB);
const sourceSha256 = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
const nativeOnly = process.env.DOCA_QA_NATIVE_ONLY === "1";
const builtWeb = process.env.DOCA_QA_BUILT_WEB === "1";
const nativeLifecycle = process.env.DOCA_QA_NATIVE_LIFECYCLE === "1";
if (nativeLifecycle) assert(nativeOnly, "Native lifecycle must prohibit image generation");
const fixturePath = process.env.DOCA_QA_NATIVE_FIXTURE ? resolve(process.env.DOCA_QA_NATIVE_FIXTURE) : undefined;
if (fixturePath) {
  assert(nativeLifecycle && nativeOnly);
  assert.equal(fixturePath,resolve(".local/issue-tracker-ai-native-official-0.5.12-lifecycle-2026-10-23/native-database-canvas.json"),"Only the retained synthetic pre-continue scene is authorized");
}
const fixtureBytes = fixturePath ? await readFile(fixturePath) : undefined;
const fixture = fixtureBytes ? JSON.parse(fixtureBytes.toString("utf8")) : undefined;
if (fixture) assert.equal(fixture.version,1,"Use the current native scene format unchanged");
const fixtureSha256 = fixtureBytes ? createHash("sha256").update(fixtureBytes).digest("hex") : undefined;
const imageScenario = process.env.DOCA_QA_IMAGE_SCENARIO ?? "photo";
assert(["photo", "ui"].includes(imageScenario));
const executor = configured.models.find(model => model.enabled && model.tools && !model.imageGeneration && !model.embedding && !model.vision);
assert(executor && configured.mediaModel && (nativeOnly || configured.imageModel));
const output = resolve(process.env.DOCA_QA_OUTPUT ?? `artifacts/verification/issue-tracker-2026-10-21/ai-real-${Date.now()}`);
await mkdir(output, { recursive: true });
const dbPath = join(output, "qa.db");
assert(!(await stat(dbPath).catch(() => null)), "Use a fresh output directory; never repeat a potentially paid run automatically");
const storageRoot = join(output, "storage");
await mkdir(storageRoot, { recursive: true });
let indexSha256: string | undefined;
if (builtWeb) {
  indexSha256 = createHash("sha256").update(await readFile("apps/web/dist/index.html")).digest("hex");
  await cp(resolve("apps/web/dist"), join(output, "web"), { recursive: true });
  assert.equal(createHash("sha256").update(await readFile(join(output,"web/index.html"))).digest("hex"), indexSha256);
}
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
await writeFile(join(output, ".credential-master-key"), process.env.DOCA_CREDENTIAL_MASTER_KEY, { mode: 0o600 });
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({ version: 1, stores: { local: { provider: "local", root: storageRoot } } });
process.env.DOCA_AI_IMAGE_MAX_ATTEMPTS_PER_PAGE = "1";
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } = await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: dbPath });
const actor = { ...await createUser(db, { login: "actualissue", displayName: "Actual provider QA", password: "isolated-actual-issue-2026" }, { bootstrap: true }), admin: 1 };
const { revision: _sourceRevision, ...configuration } = configured;
const imageProfile = process.env.DOCA_QA_IMAGE_PROFILE;
const imageModel = process.env.DOCA_QA_IMAGE_MODEL;
await saveAIConfig(db, { ...configuration, defaultModel: executor.id, maxSteps: 30,
  ...(nativeOnly ? { imageModel: undefined, models: configuration.models.filter(model => !model.imageGeneration) } : {}),
  ...(imageProfile ? { models: configuration.models.map(model => model.id === configuration.imageModel ? { ...model, ...(imageModel ? { model: imageModel } : {}), imageProfile, imageSize: process.env.DOCA_QA_IMAGE_SIZE ?? "2048x2048" } : model) } : {}),
}, 0);
const board = await createContent(db).create(actor, { kind: "document", format: "canvas", title: nativeOnly ? "真实原生UI与关系图验收（合成测试）" : "真实生图与画布验收（合成测试）" });
if (fixture) {
  // Isolated fixture setup through the same current native codec initializer as
  // fresh/copy creation. No old DB, epoch, tombstone or deleted ID is restored.
  await db.transaction().execute(tx=>provisionSurface(tx,board,fixture));
  await writeFile(join(output,"input-canvas.json"),fixtureBytes!);
}
const port = Number(process.env.DOCA_QA_PORT ?? 39488), origin = `http://127.0.0.1:${port}`;
const secrets = configured.vendors.flatMap(vendor => vendor.apiKey ? [vendor.apiKey] : []);
const redact = (value: string) => secrets.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), value);
const requests: any[] = [];
let paidRequests = 0;
let blockedImageRequests = 0, negativeExpectedSeq: number | undefined, negativeObserved = false;
let negativePriorReplies = new Set<string>();
let negativeExistingId: string | undefined;
const toolReplies: any[] = [];
const modelToolCalls = new Map<string,any>();
const replyIdentity = (reply: any) => JSON.stringify([reply.callId,reply.content]);
const tracedFetch = (kind: "chat" | "image"): typeof fetch => async (url, init) => {
  const parsed = new URL(String(url));
  const paid = kind === "image" && (init?.method ?? "GET").toUpperCase() === "POST";
  if (paid) {
    assert.equal(paidRequests, 0, "One paid request maximum; do not retry uncertain generation");
    paidRequests++;
  }
  const record: any = { kind, method: init?.method ?? "GET", host: parsed.host, path: parsed.pathname, startedAt: new Date().toISOString() };
  requests.push(record);
  if (nativeOnly && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    const collect = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (value.role === "assistant" && Array.isArray(value.tool_calls)) for (const call of value.tool_calls) {
        modelToolCalls.set(call.id,{request:requests.length,id:call.id,name:call.function?.name,arguments:call.function?.arguments});
      }
      if (value.role === "tool" || ["tool_result","function_call_output"].includes(value.type)) {
        const reply = { request: requests.length, role: value.role, type: value.type, callId: value.tool_call_id ?? value.tool_use_id ?? value.call_id, content: value.content ?? value.output };
        toolReplies.push(reply);
      }
      if (Array.isArray(value)) value.forEach(collect); else Object.values(value).forEach(collect);
    };
    collect(body);
    if (negativeExpectedSeq !== undefined && !negativeObserved && negativeExistingId && toolReplies.some(reply => !negativePriorReplies.has(replyIdentity(reply)) && rejectedExistingCanvasContainer(reply, modelToolCalls.get(reply.callId), negativeExistingId!))) {
      const snapshot = await readAIDocument(db, { actor }, board.id);
      assert.equal(snapshot.seq, negativeExpectedSeq, "The rejected duplicate-ID command must not partially write");
      negativeObserved = true;
      results.duplicateIdRejection = { source: "correlated canvas_edit error for the actual single live-ID createContainer call", actualError: "INVALID_ELEMENT_ID", scope: "existing live ID only; deleted-ID reuse not exercised", seq: snapshot.seq, zeroPartialWrites: true };
    }
    await writeFile(join(output,"tool-replies.json"),redact(JSON.stringify(toolReplies,null,2)));
    await writeFile(join(output,"model-tool-calls.json"),redact(JSON.stringify([...modelToolCalls.values()],null,2)));
  }
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(600000)]) });
    record.status = response.status;
    record.requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("x-tt-logid");
    if (!response.ok) record.error = redact((await response.clone().text()).slice(0, 12000));
    return response;
  } catch (error) {
    record.error = redact(String(error));
    throw error;
  } finally {
    await writeFile(join(output, "provider-requests.json"), JSON.stringify(requests, null, 2));
  }
};
const app = await createApp(db, { origin, ...(builtWeb ? { staticDirectory: join(output,"web") } : {}), storage: storageRuntime(), ai: { memory: { driver: "sqlite", url: join(output, "memory.db") }, fetch: tracedFetch("chat"), imageFetch: nativeOnly ? async () => { blockedImageRequests++; throw Error("This native UI acceptance prohibits image-generation requests"); } : tracedFetch("image") } });
await app.listen({ host: "127.0.0.1", port: builtWeb ? port : 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = builtWeb ? undefined : await createServer({ configFile: resolve("apps/web/vite.config.ts"), server: { hmr: false, watch: { ignored: ["**/*"] }, host: "127.0.0.1", port, strictPort: true, proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } } } });
await web?.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: any = { sourceReadOnly: true, sourceSha256, isolated: true, scenario: nativeOnly ? "native" : imageScenario, nativeLifecycle, fixture:fixturePath?{path:fixturePath,sha256:fixtureSha256,sourceSeq:7,initialization:"new resource/new epoch through current provisionSurface and CanvasModel.initialize; original DB untouched"}:undefined, webMode: builtWeb ? "production-build-copy" : "development-server", indexSha256, canvasVersion: JSON.parse(await readFile("node_modules/@smartdoca/canvas/package.json","utf8")).version, explicitImageProfile: imageProfile, executor: executor.model, media: configured.models.find(model => model.id === configured.mediaModel)?.model, image: nativeOnly ? null : imageModel ?? configured.models.find(model => model.id === configured.imageModel)?.model, boardId: board.id, stages: [] };
if (nativeLifecycle) assert.equal(results.canvasVersion,process.env.DOCA_QA_CANVAS_VERSION??"0.5.12");
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const request = async (path: string, data?: unknown, method = "GET") => {
    const response = await context.request.fetch(origin + "/api/v1" + path, { method, headers: { origin }, data });
    assert(response.ok(), `${path}: ${response.status()} ${await response.text()}`); return response.json();
  };
  await request("/auth/login", { login: "actualissue", password: "isolated-actual-issue-2026" }, "POST");
  const session = await request("/ai/sessions", { modelId: executor.id, resourceIds: [board.id] }, "POST");
  results.sessionId = session.id;
  const page = await context.newPage(), errors: string[] = [];
  const nativeUpdates: any[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket",socket=>socket.on("framesent",({payload})=>{try{const frame=JSON.parse(String(payload));if(frame.type==="update")nativeUpdates.push(frame)}catch{}}));
  await page.goto(`${origin}/#/r/${board.id}?session=${session.id}`);
  const send = async (text: string, stage: string) => {
    const id = randomUUID();
    await request(`/ai/sessions/${session.id}/messages`, { id, text, modelId: executor.id, scope: "all", currentResourceId: board.id, references: [], attachments: [], webSearch: false, skipApprovals: { create: true, modify: true } }, "POST");
    let conversation: any, lastEvent = "", lastReport = Date.now();
    for (let attempt = 0; attempt < 1200; attempt++) {
      conversation = await request(`/ai/sessions/${session.id}`);
      const job = conversation.jobs.find((item: any) => item.id === id);
      if (requests.some(record => record.kind === "image" && record.status >= 400) && job && ["queued", "running"].includes(job.status)) {
        await request(`/ai/jobs/${id}/cancel`, {}, "POST");
      }
      const event = job?.progress?.events?.at(-1);
      const marker = `${job?.status}:${event?.code ?? event?.kind}:${event?.data?.toolName ?? ""}`;
      if (marker !== lastEvent) { console.log(`${stage}: ${marker}`); lastEvent = marker; }
      if (Date.now() - lastReport > 45000) { console.log(`${stage}: waiting for the original job; provider requests=${requests.length}, imageRequests=${paidRequests}`); lastReport = Date.now(); }
      if (job && !["queued", "running"].includes(job.status)) {
        await writeFile(join(output, `${stage}-conversation.json`), redact(JSON.stringify(conversation, null, 2)));
        await page.screenshot({ path: join(output, `${stage}.png`) });
        results.stages.push({ stage, id, status: job.status, error: job.error, review: job.progress?.review });
        await writeFile(join(output,"results.json"),redact(JSON.stringify({...results,result:"in_progress"},null,2)));
        if (nativeOnly) assert(!job.progress?.events?.some((event: any) => /^image_(generate|edit|recompose|batch|mask)/.test(event.data?.toolName ?? "")), "Native acceptance must never invoke a paid image tool");
        assert.equal(job.status, "completed", redact(JSON.stringify(job)));
        return conversation;
      }
      await delay(500);
    }
    throw new Error(`${stage}: timed out; inspect retained DB before any retry`);
  };
  if (nativeOnly) {
    const flatten = (value: any): any[] => { const visit = (node: any): any[] => [node,...(node.children ?? []).flatMap(visit)]; return value.scene.children.flatMap(visit); };
    const nativeSnapshot = async (stage: string) => {
      const content = await readAIDocument(db, { actor }, board.id);
      assert(!flatten(content.value).some(node=>node.tag==="Image"),"This run must remain native editable shapes without bitmap generation");
      await writeFile(join(output, `${stage}-canvas.json`), JSON.stringify(content.value, null, 2));
      const writes = nativeUpdates.length;
      await page.reload();
      const canvas = page.locator(".canvas-host");
      await canvas.locator("canvas").first().waitFor();
      await canvas.click({ position: { x: 900, y: 750 } });
      await page.keyboard.press("Shift+Digit1");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(output, `${stage}-reloaded-fit.png`) });
      assert.equal((await readAIDocument(db, { actor }, board.id)).seq, content.seq, "reload and fit must not write native content");
      assert.equal(nativeUpdates.length,writes,"Website remote rendering/reload must not echo content");
      results.stages.at(-1).reload = { seq: content.seq, nativeWrites: 0, contentEcho: 0 };
      assert.equal(paidRequests, 0); assert.equal(blockedImageRequests,0);
      return content;
    };
    const requestedStages = new Set(fixture ? [] : (process.env.DOCA_QA_NATIVE_STAGES ?? "native-phone,native-web,native-database").split(","));
    assert((fixture || requestedStages.size > 0) && [...requestedStages].every(stage => ["native-phone", "native-web", "native-database"].includes(stage)));
    for (const [stage, instruction] of [
      ["native-phone", "在当前空白画布创建一套原生可编辑手机设置界面：390×844手机容器，标题‘合成设置’，两张设置卡片含‘通知’和‘隐私’，底部一个‘保存’按钮。所有内容实际嵌套手机容器，边框清晰可见且内容不溢出。保留并使用容器原生派生标题，不删原生标题再同位置自绘；给内容留出手机硬件与原生标题安全区。禁止image_generate及任何图片生成工具，只用原生图形。完成后实际canvas_view看四边、角和嵌套边界并独立验收，不能凭stroke字段代替像素证据。"],
      ["native-web", "保留已有手机UI，在右侧另建原生可编辑浏览器容器的桌面管理界面：标题‘合成管理台’，侧边栏‘概览’‘订单’，主体两张统计卡‘订单 128’‘收入 2560’和一个‘导出’按钮。内容真实嵌套浏览器容器，文字与边框清晰且不相互遮挡。使用容器已有原生标题并预留安全区，不同位置重复绘标题。禁止image_generate及任何图片生成工具。完成后canvas_view实际看整板及四边/标题细节并独立验收；不能凭scene字段代替轮廓像素。"],
      ["native-database", "保留已有UI，在下方的独立原生section容器中创建原生可编辑数据库关系图，容器标题‘合成关系图’：users(id,name)、orders(id,user_id,book_id)、books(id,title)三张表。两条关系明确为users.id→orders.user_id和books.id→orders.book_id，标注1:N。表名、所有字段、关系方向可读，节点及文字不重叠，使用新的唯一对象ID。禁止image_generate及任何图片生成工具。完成后canvas_view逐条看实际起点/箭头/字段归属/标签，独立验收，不把JSON端点当像素可读证据。"],
    ] as const) {
      if (!requestedStages.has(stage)) continue;
      const conversation = await send(instruction, stage);
      assert.equal(conversation.jobs.find((job: any) => job.id === results.stages.at(-1).id)?.progress?.review?.verdict, "pass");
      await nativeSnapshot(stage);
    }
    if (nativeLifecycle) {
      assert.equal(requestedStages.size,fixture?0:3,"A fixture continuation must not regenerate the three completed native stages");
      const beforeEdit = await readAIDocument(db,{actor},board.id);
      const retainedIds = new Set(flatten(beforeEdit.value).map(node=>node.id));
      if(fixture)assert.deepEqual([...retainedIds].sort(),flatten(fixture).map(node=>node.id).sort(),"Current fixture initialization must retain every original ID");
      const baselineEvidence = (ids:Set<string>) => "\n本次修改前真实完整对象ID清单（由隔离验收fixture当前原始读取取得，包含Text/label/所有子层级，并非执行者自述）："+JSON.stringify([...ids]);
      await send("继续修改当前画板中的手机、Web和关系图，保留所有现有对象ID和容器，不删除重建：手机保存按钮文字改成‘保存更改’，按钮底色改为#0f766e；Web订单统计由128改为256，导出按钮文字改为‘导出报表’；orders表在原字段后新增created_at，并用当前合法diagramNode工作流调整orders节点到宽320高240，使外框、内部表体、字段和连线一致，保持两条1:N关系和字段归属。先完整读取当前结构再编辑，实际canvas_view检查所有修改后的整体和局部，独立审核，禁止任何图片生成工具。"+baselineEvidence(retainedIds),"native-continue");
      assert.equal(results.stages.at(-1).review?.verdict,"pass");
      const edited = await nativeSnapshot("native-continue");
      const afterEditIds = new Set(flatten(edited.value).map(node=>node.id));
      for (const id of retainedIds) assert(afterEditIds.has(id),"Continue must retain existing ID: "+id);
      const editedText = JSON.stringify(edited.value);
      for (const text of ["保存更改","导出报表","created_at","#0f766e"]) assert(editedText.includes(text),text);
      const phone = flatten(edited.value).find(node=>node.data?.containerType==="phone"); assert(phone?.id);
      negativeExpectedSeq = edited.seq;
      negativeExistingId = phone.id;
      negativePriorReplies = new Set(toolReplies.map(replyIdentity));
      await send(`现在只在这份合成画板做一次明确的错误恢复验收。先发起一次createContainer命令，id必须复用已存在的手机容器ID「${phone.id}」，只使用当前capabilities声明的合法参数：type=createContainer、containerType=phone、x=0、y=0、title=合成负例、children=[]，不传width或height，预期被当前原生重复ID校验拒绝；只尝试这一次，禁止删除原对象或换新ID重建，失败必须整批不写。收到真实错误回执后，按回执改用合法patch/text更新原手机标题为‘合成设置·已校正’，容器data.title和原生标题文字一致，不新增重叠标题；保留全部其他对象ID、UI、修改后的按钮和三表两关系。最后document_read回读、canvas_view看像素并独立审核。禁止image_generate及任何图片生成/修改工具。${baselineEvidence(afterEditIds)}`,"native-correct");
      assert(negativeObserved,"An actual correlated live-ID tool-error result, rather than inspection commentary, is required");
      assert.equal(results.stages.at(-1).review?.verdict,"pass");
      const corrected = await nativeSnapshot("native-correct");
      assert(JSON.stringify(corrected.value).includes("合成设置·已校正"));
      for (const id of afterEditIds) assert(flatten(corrected.value).some(node=>node.id===id),"Correction must retain ID: "+id);
      const exportSeq = corrected.seq;
      const exported = await send("将当前实际画布导出PNG文件交付给我：整板一份‘合成原生全板.png’，手机容器、Web容器、合成关系图section容器各一份局部PNG，使用canvas_export和真实文件卡片。不得新增/删除/修改画布元素，不调用图片生成或付费图片工具。导出后实际查看并说明原生导出字体等警告，不能拿canvas_view文字回执代替真实文件。","native-export");
      const exportJob = results.stages.at(-1).id;
      const files = exported.operations.filter((op:any)=>op.job_id===exportJob).map((op:any)=>op.result).filter((receipt:any)=>receipt.kind==="file_item"&&receipt.mime==="image/png");
      assert(files.length>=4,"Deliver the whole board and three native region PNG files");
      results.exports=[];
      for (const [index,file] of files.entries()) {
        const response=await context.request.get(origin+file.downloadUrl); assert(response.ok());
        const bytes=await response.body();const filename=`native-export-${index+1}.png`;await writeFile(join(output,filename),bytes);
        results.exports.push({fileId:file.id,name:file.name,filename,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length});
      }
      await page.locator(".ai-file-card-thumb").last().waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>(".ai-file-card-thumb")].some(image=>image.naturalWidth>0));
      await page.screenshot({path:join(output,"native-export-cards.png")});
      assert.equal((await readAIDocument(db,{actor},board.id)).seq,exportSeq,"canvas_export must not write canvas content");
      await nativeSnapshot("native-export");
    }
    results.errors = errors;
    assert.deepEqual(errors, []);
    results.paidRequests = 0;
    results.paidImageProviderRequests = paidRequests;
    results.blockedImageProviderRequests = blockedImageRequests;
    results.modelProviderRequests = requests.length;
    results.billingScope = "Real configured language/vision model calls; zero image-generation provider calls. This is not zero model-token usage.";
    results.result = "passed";
    console.log("PASS requested actual model native stages with independent review and website reload; manual pixel inspection is still required");
  } else {
  const generation = await send(imageScenario === "ui"
    ? "在当前空白画布生成一张高保真桌面任务管理网页UI设计图片：白色和浅灰界面，蓝色主色，左侧导航Overview/Projects/Tasks，顶部搜索区，两个统计卡Active 12和Done 48，中部三条任务列表。调用真实图片生成工具，只提交一次付费请求；成功后插入当前画布，整套UI必须位于同一张位图图片里。不要用原生可编辑图形代替图片，不要摄影或手机实物。随后用image_view和canvas_view实际检查导航、统计卡、任务列表和构图；本次不重新付费生成。"
    : "在当前空白画布中生成一张写实摄影图片：一只黑白边牧站在晴天草地上，画面右下角有一只清楚可见的灰色小老鼠，自然光，无文字。调用真实图片生成工具，只提交一次付费请求；成功后插入当前画布。不要用原生图形或UI代替照片。随后用实际图片查看和画布查看工具检查边牧、小老鼠及构图；本次测试不重新付费生成。", "generation");
  assert.equal(paidRequests, 1);
  const imageReceipts = generation.operations.map((operation: any) => operation.result).filter((receipt: any) => receipt.kind === "image_generation" && receipt.state === "saved");
  assert.equal(imageReceipts.length, 1);
  const imageReceipt = imageReceipts[0];
  results.imageReceipt = imageReceipt;
  const downloaded = await context.request.get(origin + imageReceipt.url);
  if (downloaded.ok()) await writeFile(join(output, "generated-image.png"), await downloaded.body());
  const value = await readAIDocument(db, { actor }, board.id);
  await writeFile(join(output, "canvas.json"), JSON.stringify(value.value, null, 2));
  const exported = await send(`将当前画布的完整实际画面导出为PNG文件发给我，文件名为「${imageScenario === "ui" ? "合成UI图片验收" : "合成摄影验收"}.png」。使用canvas_export，不调用任何图片生成工具，不新增或修改画布元素，交付真实文件卡片。`, "export");
  assert.equal(paidRequests, 1);
  const file = exported.operations.map((operation: any) => operation.result).find((receipt: any) => receipt.kind === "file_item" && receipt.mime === "image/png");
  assert(file);
  await page.locator(".ai-file-card-thumb").last().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".ai-file-card-thumb")].some(image => image.naturalWidth > 0));
  await page.screenshot({ path: join(output, "export-card.png") });
  const png = await context.request.get(origin + file.downloadUrl);
  assert(png.ok());
  await writeFile(join(output, "canvas-export.png"), await png.body());
  await page.reload();
  await page.locator(".ai-file-card-thumb").last().waitFor();
  assert.equal((await readAIDocument(db, { actor }, board.id)).seq, value.seq);
  results.errors = errors;
  assert.deepEqual(errors, []);
  results.paidRequests = paidRequests;
  results.result = "passed";
  console.log("PASS actual image generation, insertion, independent visual review, exported PNG card and reload");
  }
} catch (error) {
  results.result = "failed";
  results.error = redact(String(error));
  results.paidRequests = paidRequests;
  process.exitCode = 1;
  console.log(results.error);
} finally {
  results.retainedData = "Synthetic QA database, memory and asset store retained privately for reconciliation; source DB was read-only";
  if(fixturePath) { results.fixtureUnchanged=createHash("sha256").update(await readFile(fixturePath)).digest("hex")===fixtureSha256; assert(results.fixtureUnchanged); }
  results.sourceUnchanged = createHash("sha256").update(await readFile(sourcePath)).digest("hex")===sourceSha256;
  assert(results.sourceUnchanged,"The read-only source configuration DB must be preserved");
  await writeFile(join(output, "results.json"), redact(JSON.stringify(results, null, 2)));
  await browser.close(); await web?.close(); await app.close(); await db.destroy();
  console.log(`RESULT ${output}`);
}
