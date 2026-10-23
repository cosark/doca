// Real shared AIChat in Chromium; only synthetic stores and a mocked model.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { saveAIConfig, aiDefaults } from "../packages/core/src/modules/ai/config.js";
import { mockAI } from "../tests/ai-mock.js";

const root = await mkdtemp(join(tmpdir(), "doca-pending-refresh-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({ version: 1, stores: { local: { provider: "local", root } } });
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } = await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const actor = await createUser(db, { login: "pendingrefresh", displayName: "Pending refresh", password: "isolated-pending-refresh" }, { bootstrap: true });
await saveAIConfig(db, { ...aiDefaults, defaultModel: "test", memoryEnabled: false,
  vendors: [{ id: "test", name: "Synthetic", provider: "compatible", baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-key", enabled: true }],
  models: [{ id: "test", vendorId: "test", model: "test", alias: "Synthetic model", enabled: true, maxInput: 64000, maxOutput: 2000, tools: true }],
}, 0);
const port = Number(process.env.DOCA_QA_PORT ?? 39492), origin = `http://127.0.0.1:${port}`;
const app = await createApp(db, { origin, storage: storageRuntime(), ai: { memory: { driver: "sqlite", url: join(root, "memory.sqlite") }, fetch: mockAI() } });
const request = async (method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const reply = await app.inject({ method: method as any, url: "/api/v1" + path, payload, headers: { host: `127.0.0.1:${port}`, origin, ...headers } });
  const body = reply.json();
  if (reply.statusCode >= 400) throw Object.assign(new Error(body.message), { status: reply.statusCode });
  return body;
};
const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin, host: `127.0.0.1:${port}` }, payload: { login: "pendingrefresh", password: "isolated-pending-refresh" } });
assert.equal(login.statusCode, 200, login.body);
const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
const profile = await request("POST", "/me/browser-clipper/profiles", { name: "Synthetic rule", enabled: true, isDefault: true, strategy: "create", libraryId: null, parentId: null, targetId: null, titleTemplate: "{title}", aiInstruction: "" }, { cookie });
const verifier = randomBytes(32).toString("hex");
const authorization = await request("POST", "/me/browser-clipper/authorize", { version: 2, installationId: randomUUID(), challenge: createHash("sha256").update(verifier).digest("hex") }, { cookie });
const connection = await request("POST", "/browser-clipper/token", { version: 2, code: authorization.code, verifier }, { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
const browserHeaders = { authorization: `Bearer ${connection.token}`, origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", cookie: "" };
const web = await createServer({ configFile: resolve("apps/web/vite.config.ts"), cacheDir: join(root, "vite-cache"), plugins: [{
  name: "isolated-pending-fixture",
  resolveId(id) { if (id === "virtual:pending-qa") return "\0virtual:pending-qa"; },
  load(id) { if (id === "\0virtual:pending-qa") return `
    import { mountBrowserAssistant } from '/src/features/ai/browser-assistant-entry.tsx';
    import { listPendingEntries } from '/src/features/ai/ai-pending-store.ts';
    const config = await window.fixtureConfig();
    const pendingScope = {docaOrigin: config.origin, userId: config.userId,
      connectionId: config.connectionId, profile: {id: config.profile.id, revision: config.profile.revision}};
    window.fixturePendingProbe = () => listPendingEntries(pendingScope);
    window.fixtureMount = mountBrowserAssistant(document.getElementById('mount'), {
      ...config, request: async (path, method='GET', body, signal) => {
        signal?.throwIfAborted();
        const result = await window.fixtureRequest({path, method, body});
        signal?.throwIfAborted();
        if (result.error) throw Object.assign(new Error(result.error), {status: result.status});
        return result.value;
      }, captureCurrentPage: () => window.fixtureCapture(),
      onSessionChange: id => window.fixtureSession(id), openDoca: () => {},
    });
  `; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (req.url?.split("?")[0] !== "/__pending-fixture") return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><head><style>html,body,#mount{margin:0;width:100%;height:100%}</style></head><body><div id="mount"></div><script type="module">import "virtual:pending-qa"</script></body></html>'));
  }); },
}], server: { hmr: false, watch: { ignored: ["**/*"] }, host: "127.0.0.1", port, strictPort: true } });
await web.listen();
const mode = process.env.DOCA_QA_MODE ?? "refresh";
assert(["refresh", "storage-failure", "legacy"].includes(mode), "Unknown pending QA mode");
const output = resolve(process.env.DOCA_QA_OUTPUT ?? `artifacts/verification/ai-pending-${mode}-2026-10-22`);
await mkdir(output, { recursive: true });
await rm(join(output, "results.json"), { force: true });
await rm(join(output, "failure.json"), { force: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: any[] = [];
let diagnosticPage: Page | null = null, diagnosticCase = "setup";
let diagnosticState: () => unknown = () => ({});
try {
  for (const stage of mode === "refresh" ? ["paint", "create-session", "prepare-page", "accepted-reply-lost"] : []) {
    const context = await browser.newContext({ viewport: { width: 470, height: 900 } });
    const page = await context.newPage();
    diagnosticPage = page; diagnosticCase = stage;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let sessionId: string | null = null, phaseEntered = false, interrupted = false, armed = stage !== "paint", posts = 0, prepared = 0;
    let captureAttempts = 0;
    const requestsAfterRefresh: { method: string; path: string }[] = [];
    diagnosticState = () => ({ sessionId, phaseEntered, interrupted, posts, prepared, captureAttempts, requestsAfterRefresh, errors });
    let releasePhase!: () => void, releaseResume!: () => void;
    const phaseGate = new Promise<void>(resolve => { releasePhase = resolve; });
    const resumeGate = new Promise<void>(resolve => { releaseResume = resolve; });
    await page.exposeFunction("fixtureConfig", () => ({ userId: actor.id, connectionId: connection.connectionId, origin, sessionId,
      profile: { id: profile.id, revision: profile.revision, name: profile.name }, page: { title: "Synthetic page", url: "https://synthetic.test/page" }, locale: "zh" }));
    await page.exposeFunction("fixtureSession", (id: string | null) => { sessionId = id; });
    await page.exposeFunction("fixtureRequest", async (input: { path: string; method: string; body?: any }) => {
      try {
        if (interrupted) requestsAfterRefresh.push({ method: input.method, path: input.path });
        if (armed && stage === "create-session" && input.method === "POST" && input.path === "/ai/sessions") {
          armed = false; phaseEntered = true;
          await phaseGate;
          if (interrupted) return { error: "Synthetic navigation interrupted creation", status: 499 };
        }
        if (input.method === "POST" && input.path.endsWith("/messages")) posts++;
        const value = await request(input.method, "/browser-clipper/assistant/ui" + input.path.slice(3), input.body, browserHeaders);
        if (armed && stage === "accepted-reply-lost" && input.method === "POST" && input.path.endsWith("/messages")) {
          // The real isolated server committed the original job. The renderer
          // never receives this reply, so only readonly reconciliation may run
          // after refresh; capture or another POST would be a regression.
          armed = false; phaseEntered = true;
          await phaseGate;
          if (interrupted) return { error: "Synthetic reply lost after server acceptance", status: 499 };
        }
        return { value };
      } catch (error) { return { error: (error as Error).message, status: (error as any).status ?? 500 }; }
    });
    await page.exposeFunction("fixtureCapture", async () => {
      captureAttempts++;
      if (armed && stage === "prepare-page") {
        armed = false; phaseEntered = true;
        await phaseGate;
        if (interrupted) throw Error("Synthetic navigation interrupted preparation");
      }
      if (interrupted) await resumeGate;
      const captureRequestId = randomUUID();
      await request("POST", "/browser-clipper/clips", { version: 1, requestId: captureRequestId, profileId: profile.id, profileRevision: profile.revision, mode: "page", title: "Synthetic page", url: "https://synthetic.test/page", capturedAt: new Date().toISOString(), markdown: "Synthetic isolated page material", images: [] }, browserHeaders);
      prepared++;
      return { captureRequestId, title: "Synthetic page", url: "https://synthetic.test/page" };
    });
    const legacyKey = `doca.ai.pending-send.browser:${actor.id}:${connection.connectionId}`;
    const legacyId = randomUUID();
    const legacyRaw = JSON.stringify({ draft: [{ id: legacyId, text: `LEGACY_REQUIRES_EXPLICIT_CONTINUE_${stage}`,
      references: [], attachments: [], modelId: "test", scope: "all", createdAt: new Date().toISOString() }] }, null, 2);
    await page.addInitScript(({ legacyKey, legacyRaw }) => {
      if (localStorage.getItem(legacyKey) === null) localStorage.setItem(legacyKey, legacyRaw);
      const timer = window.setTimeout.bind(window), frame = window.requestAnimationFrame.bind(window);
      (window as any).holdPaint = false;
      window.setTimeout = ((callback: TimerHandler, ms?: number, ...args: any[]) => {
        if ((window as any).holdPaint && ms === 100) return timer(() => {}, 60000);
        return timer(callback, ms, ...args);
      }) as typeof window.setTimeout;
      window.requestAnimationFrame = callback => (window as any).holdPaint ? timer(() => {}, 60000) : frame(callback);
    }, { legacyKey, legacyRaw });
    const url = origin + "/__pending-fixture";
    await page.goto(url);
    const composer = page.locator('.ai-composer [contenteditable="true"]');
    await composer.waitFor();
    const marker = `REFRESH_${stage}_ORIGINAL`;
    await composer.fill(marker);
    const sendButton = page.getByRole("button", { name: "发送", exact: true });
    for (let n = 0; !(await sendButton.isEnabled()) && n < 200; n++) await delay(20);
    assert(await sendButton.isEnabled(), "The model selector must be ready before Send");
    if (stage === "paint") await page.evaluate(() => { (window as any).holdPaint = true; });
    await sendButton.evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForFunction(async marker => (await (window as any).fixturePendingProbe?.() ?? [])
      .some((entry: any) => entry.state === "pending" && entry.item.text === marker), marker);
    if (stage !== "paint") {
      for (let n = 0; !phaseEntered && n < 300; n++) await delay(20);
      assert(phaseEntered, stage + " did not reach its intended interruption");
    }
    const retained = await page.evaluate(() => (window as any).fixturePendingProbe());
    const original: any = retained.find((entry: any) => entry.state === "pending" && entry.item.text === marker)?.item;
    assert(original?.id);
    assert.equal(posts, stage === "accepted-reply-lost" ? 1 : 0, "Only the lost-reply stage may have committed a job before refresh");
    const postsBeforeRefresh = posts, preparationsBeforeRefresh = prepared, captureAttemptsBeforeRefresh = captureAttempts;
    await page.screenshot({ path: join(output, `${stage}-before-refresh.png`) });
    interrupted = true;
    const reload = page.reload({ waitUntil: "domcontentloaded" });
    releasePhase();
    await reload;
    await composer.waitFor();
    const localDraft = `NEW_LOCAL_DRAFT_${stage}`;
    await composer.fill(localDraft);
    if (stage === "paint" || stage === "create-session") {
      assert.equal(sessionId, null);
      await page.locator(".ai-pending-item").filter({ hasText: marker }).getByRole("button", { name: "立即发送", exact: true }).click();
    }
    releaseResume();
    for (let n = 0; n < 400; n++) {
      const job = await db.selectFrom("ai_jobs").select("status").where("id", "=", original.id).executeTakeFirst();
      if (job?.status === "completed") break;
      if (job && ["failed", "cancelled", "interrupted"].includes(job.status)) throw Error(`${stage}: ${job.status}`);
      await delay(25);
    }
    const job = await db.selectFrom("ai_jobs").selectAll().where("id", "=", original.id).executeTakeFirstOrThrow();
    assert.equal(job.status, "completed", job.error);
    await page.locator(".ai-user-message-text").filter({ hasText: marker }).waitFor({ timeout: 15000 });
    await page.waitForFunction(async id => (await (window as any).fixturePendingProbe())
      .some((entry: any) => entry.messageId === id && entry.state === "accepted" && entry.serverJobId === id), original.id);
    assert.equal(await composer.innerText(), localDraft, "Continuing an old item must retain the later local draft");
    assert.equal(posts, 1, "The original ID must create only one model job");
    assert.equal(prepared, 1, "Only one page preparation was committed");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), legacyKey), legacyRaw, "Old 0.2.7 bytes must remain unchanged");
    assert.equal(await db.selectFrom("ai_jobs").select("id").where("id", "=", legacyId).executeTakeFirst(), undefined,
      "Legacy localStorage items must never auto-drain");
    if (stage === "accepted-reply-lost") {
      assert.equal(posts - postsBeforeRefresh, 0, "An accepted job must not be submitted after refresh");
      assert.equal(prepared - preparationsBeforeRefresh, 0, "An accepted job must not capture the page again");
      assert.equal(captureAttempts - captureAttemptsBeforeRefresh, 0, "An accepted job must not attempt a new capture after refresh");
      assert(requestsAfterRefresh.some(entry => entry.method === "GET" && entry.path.includes(`pendingId=${original.id}`)),
        "Lost reply recovery must use an exact readonly pendingId lookup");
    }
    const jobs = await db.selectFrom("ai_jobs").select("id").where("id", "=", original.id).execute();
    assert.equal(jobs.length, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, `${stage}-resumed.png`) });
    results.push({ stage, messageId: original.id, status: job.status, posts, committedPreparations: prepared,
      postsAfterRefresh: posts - postsBeforeRefresh, preparationsAfterRefresh: prepared - preparationsBeforeRefresh,
      captureAttemptsAfterRefresh: captureAttempts - captureAttemptsBeforeRefresh,
      exactPendingReconciliationAfterRefresh: requestsAfterRefresh.some(entry => entry.method === "GET" && entry.path.includes(`pendingId=${original.id}`)),
      indexedDBAcceptedTombstone: true, legacyBytesPreserved: true, legacyNotAutoSent: true,
      localDraftPreserved: true, originalMessageVisible: true, errors });
    await context.close();
  }
  for (const failure of mode === "storage-failure" ? ["unavailable", "blocked", "transaction-abort", "quota"] : []) {
    const context = await browser.newContext({ viewport: { width: 470, height: 900 } });
    const page = await context.newPage();
    diagnosticPage = page; diagnosticCase = failure;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let posts = 0, prepared = 0;
    diagnosticState = () => ({ posts, prepared, errors });
    await page.exposeFunction("fixtureConfig", () => ({ userId: actor.id, connectionId: connection.connectionId, origin, sessionId: null,
      profile: { id: profile.id, revision: profile.revision, name: profile.name }, page: { title: "Synthetic page", url: "https://synthetic.test/page" }, locale: "zh" }));
    await page.exposeFunction("fixtureSession", () => {});
    await page.exposeFunction("fixtureRequest", async (input: { path: string; method: string; body?: any }) => {
      if (input.method === "POST") posts++;
      try { return { value: await request(input.method, "/browser-clipper/assistant/ui" + input.path.slice(3), input.body, browserHeaders) }; }
      catch (error) { return { error: (error as Error).message, status: (error as any).status ?? 500 }; }
    });
    await page.exposeFunction("fixtureCapture", () => { prepared++; throw Error("Storage failure must not capture the page"); });
    const legacyKey = `doca.ai.pending-send.browser:${actor.id}:${connection.connectionId}`;
    const legacyRaw = '{"future-format":{"version":99,"preserve":"original bytes, including whitespace"}}\n';
    await page.addInitScript(({ failure, legacyKey, legacyRaw }) => {
      localStorage.setItem(legacyKey, legacyRaw);
      if (failure === "unavailable") {
        Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new DOMException("Synthetic denied storage", "SecurityError"); } });
      } else if (failure === "blocked") {
        Object.defineProperty(indexedDB, "open", { configurable: true, value() {
          const request = Object.assign(new EventTarget(), { onblocked: null, onerror: null, onsuccess: null, onupgradeneeded: null });
          queueMicrotask(() => {
            const event = new Event("blocked");
            (request.onblocked as ((event: Event) => void) | null)?.(event);
            request.dispatchEvent(event);
          });
          return request;
        } });
      } else if (failure === "transaction-abort") {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args: Parameters<typeof original>) {
          const transaction = original.apply(this, args);
          if (args[1] === "readwrite") queueMicrotask(() => { try { transaction.abort(); } catch {} });
          return transaction;
        } as typeof original;
      } else if (failure === "quota") {
        IDBObjectStore.prototype.put = function() { throw new DOMException("Synthetic exhausted quota", "QuotaExceededError"); };
        IDBObjectStore.prototype.add = function() { throw new DOMException("Synthetic exhausted quota", "QuotaExceededError"); };
      }
    }, { failure, legacyKey, legacyRaw });
    await page.goto(origin + "/__pending-fixture");
    const composer = page.locator('.ai-composer [contenteditable="true"]');
    await composer.waitFor();
    const marker = `STORAGE_${failure}_INPUT_MUST_REMAIN`;
    await composer.fill(marker);
    const send = page.getByRole("button", { name: "发送", exact: true });
    for (let n = 0; !(await send.isEnabled()) && n < 200; n++) await delay(20);
    assert(await send.isEnabled(), "The synthetic model must be ready before storage failure submission");
    await send.click();
    await page.locator('.ant-alert[role="alert"]').filter({ hasText: "草稿未能保存到此浏览器" }).waitFor();
    assert.equal(await composer.innerText(), marker, "A failed durable commit must preserve the composer");
    // Give the ordinary runner one synchronization interval to expose a late
    // fallback send. This is not a correctness delay for storage writes.
    await delay(2200);
    assert.equal(posts, 0, "A failed durable commit must make zero POSTs, including session creation");
    assert.equal(prepared, 0, "A failed durable commit must not prepare a capture");
    assert.equal((await db.selectFrom("ai_jobs").select("id").execute()).length, 0, "No isolated AI job may be created by any failed-storage case");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), legacyKey), legacyRaw, "Storage failure must preserve old bytes exactly");
    assert.deepEqual(errors, [], "Storage failures must be rendered, not leak unhandled page errors");
    await page.screenshot({ path: join(output, `${failure}-input-preserved.png`) });
    results.push({ failure, composerPreserved: true, posts, committedPreparations: prepared, legacyBytesPreserved: true, renderedError: true, errors });
    await context.close();
  }
  for (const legacyCase of mode === "legacy" ? ["missing-options", "accepted", "withdrawn"] : []) {
    const context = await browser.newContext({ viewport: { width: 470, height: 900 } });
    const page = await context.newPage();
    diagnosticPage = page; diagnosticCase = `legacy-${legacyCase}`;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const original = { id: randomUUID(), text: `LEGACY_${legacyCase}_ORIGINAL`, attachments: [], references: [], createdAt: new Date().toISOString(),
      ...(legacyCase === "accepted" ? { modelId: "test", scope: "all" } : {}) };
    let sessionId: string | null = null, posts = 0, prepared = 0;
    const requests: { method: string; path: string }[] = [];
    diagnosticState = () => ({ sessionId, posts, prepared, requests, errors });
    if (legacyCase === "accepted") {
      const session = await request("POST", "/browser-clipper/assistant/ui/sessions", { profileId: profile.id, profileRevision: profile.revision }, browserHeaders);
      sessionId = session.id;
      const captureRequestId = randomUUID();
      await request("POST", "/browser-clipper/clips", { version: 1, requestId: captureRequestId, profileId: profile.id, profileRevision: profile.revision,
        mode: "page", title: "Synthetic existing page", url: "https://synthetic.test/existing", capturedAt: new Date().toISOString(), markdown: "Synthetic existing captured material", images: [] }, browserHeaders);
      await request("POST", `/browser-clipper/assistant/ui/sessions/${sessionId}/messages`, { id: original.id, modelId: "test", text: original.text, captureRequestId }, browserHeaders);
      for (let n = 0; n < 400; n++) {
        const job = await db.selectFrom("ai_jobs").select("status").where("id", "=", original.id).executeTakeFirst();
        if (job?.status === "completed") break;
        if (job && ["failed", "cancelled", "interrupted"].includes(job.status)) throw Error(`Legacy accepted fixture: ${job.status}`);
        await delay(25);
      }
      assert.equal((await db.selectFrom("ai_jobs").select("status").where("id", "=", original.id).executeTakeFirstOrThrow()).status, "completed");
    }
    const originalSessionKey = sessionId ?? "draft";
    const legacyKey = `doca.ai.pending-send.browser:${actor.id}:${connection.connectionId}`;
    const legacyRaw = JSON.stringify({ [originalSessionKey]: [original] }, null, 2) + "\n";
    await page.exposeFunction("fixtureConfig", () => ({ userId: actor.id, connectionId: connection.connectionId, origin, sessionId,
      profile: { id: profile.id, revision: profile.revision, name: profile.name }, page: { title: "Synthetic page", url: "https://synthetic.test/page" }, locale: "zh" }));
    await page.exposeFunction("fixtureSession", (id: string | null) => { sessionId = id; });
    await page.exposeFunction("fixtureRequest", async (input: { path: string; method: string; body?: any }) => {
      requests.push({ method: input.method, path: input.path });
      if (input.method === "POST" && input.path.endsWith("/messages")) posts++;
      try { return { value: await request(input.method, "/browser-clipper/assistant/ui" + input.path.slice(3), input.body, browserHeaders) }; }
      catch (error) { return { error: (error as Error).message, status: (error as any).status ?? 500 }; }
    });
    await page.exposeFunction("fixtureCapture", async () => {
      const captureRequestId = randomUUID();
      await request("POST", "/browser-clipper/clips", { version: 1, requestId: captureRequestId, profileId: profile.id, profileRevision: profile.revision,
        mode: "page", title: "Synthetic page", url: "https://synthetic.test/page", capturedAt: new Date().toISOString(), markdown: "Synthetic isolated page material", images: [] }, browserHeaders);
      prepared++;
      return { captureRequestId, title: "Synthetic page", url: "https://synthetic.test/page" };
    });
    await page.addInitScript(({ legacyKey, legacyRaw, id }) => {
      if (localStorage.getItem(legacyKey) === null) localStorage.setItem(legacyKey, legacyRaw);
      (window as any).fixtureStoredStates = [];
      for (const method of ["put", "add"] as const) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function(...args: Parameters<typeof original>) {
          const value = args[0];
          if (value?.messageId === id) (window as any).fixtureStoredStates.push(value.state);
          return original.apply(this, args);
        };
      }
    }, { legacyKey, legacyRaw, id: original.id });
    await page.goto(origin + "/__pending-fixture");
    const composer = page.locator('.ai-composer [contenteditable="true"]');
    await composer.waitFor();
    const row = page.locator(".ai-legacy-pending-list .ai-pending-item").filter({ hasText: original.text });
    await row.waitFor();
    await delay(2200); // Exercise an ordinary automatic runner synchronization.
    assert.equal(posts, 0, "A recognized legacy item still requires explicit Continue");
    assert.equal(prepared, 0, "Legacy display must not capture the page");
    assert.deepEqual(await page.evaluate(() => (window as any).fixturePendingProbe()), [], "Opening the legacy list must not migrate it");
    const localDraft = `NEW_LOCAL_DRAFT_LEGACY_${legacyCase}`;
    await composer.fill(localDraft);
    await row.getByRole("button", { name: legacyCase === "withdrawn" ? "撤回原消息" : "继续原消息", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await confirmation.waitFor();
    await confirmation.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    assert((await confirmation.innerText()).includes(origin), "The modal must identify the current target Doca site");
    assert((await confirmation.innerText()).includes(actor.id), "The modal must identify the current account");
    assert((await confirmation.innerText()).includes(profile.id), "The modal must identify the selected capture profile");
    if (legacyCase !== "accepted") {
      // The old record contains no model or scope. Make the new selection
      // explicit in the actual confirmation UI rather than guessing it in JS.
      await confirmation.locator(".ant-select").nth(0).click();
      await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText("Synthetic model", { exact: true }).click();
      await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
      await confirmation.locator(".ant-select").nth(1).click();
      await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText("当前有权限的全部资源", { exact: true }).click();
      await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
      assert((await confirmation.locator(".ant-select").nth(0).innerText()).includes("Synthetic model"));
      assert((await confirmation.locator(".ant-select").nth(1).innerText()).includes("当前有权限的全部资源"));
    }
    assert.equal(await confirmation.getByRole("combobox").count(), 3, "Legacy confirmation must expose model, scope and skills selections");
    await confirmation.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: join(output, `legacy-${legacyCase}-confirm.png`) });
    const beforeAction = requests.length;
    await confirmation.getByRole("button", { name: legacyCase === "withdrawn" ? "撤回原消息" : "继续原消息", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    const finalState = legacyCase === "withdrawn" ? "withdrawn" : "accepted";
    await page.waitForFunction(async ({ id, state }) => (await (window as any).fixturePendingProbe())
      .some((entry: any) => entry.messageId === id && entry.state === state), { id: original.id, state: finalState });
    const finalEntry = (await page.evaluate(() => (window as any).fixturePendingProbe())).find((entry: any) => entry.messageId === original.id);
    assert.equal(finalEntry.source.storageKey, legacyKey);
    assert.equal(finalEntry.source.sessionKey, originalSessionKey);
    assert.equal(finalEntry.item.id, original.id);
    assert.equal(finalEntry.item.modelId, "test");
    assert.equal(finalEntry.item.scope, "all");
    assert.equal(await composer.innerText(), localDraft, "Explicit legacy actions must preserve the later composer draft");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), legacyKey), legacyRaw, "Explicit legacy actions must preserve original bytes");
    const states = await page.evaluate(() => (window as any).fixtureStoredStates);
    if (legacyCase === "missing-options") {
      assert.equal(posts, 1); assert.equal(prepared, 1);
      await page.locator(".ai-user-message-text").filter({ hasText: original.text }).waitFor();
      assert.equal((await db.selectFrom("ai_jobs").select("id").where("id", "=", original.id).execute()).length, 1);
    } else {
      assert.equal(posts, 0, "Accepted or withdrawn legacy data must not create a model POST");
      assert.equal(prepared, 0, "Accepted or withdrawn legacy data must not capture");
      assert(requests.slice(beforeAction).every(input => input.method === "GET"), "Resolved legacy actions may only make readonly requests");
      assert(states.length > 0 && states.every((state: string) => state === finalState), "The first store write must be the final tombstone, with no transient pending state");
      if (legacyCase === "accepted") assert(requests.slice(beforeAction).some(input => input.method === "GET" && input.path.includes(`pendingId=${original.id}`)),
        "An accepted legacy item must be proven by exact readonly pendingId reconciliation");
    }
    await page.screenshot({ path: join(output, `legacy-${legacyCase}-resolved.png`) });
    const postsBeforeReload = posts, preparationsBeforeReload = prepared;
    await page.reload();
    await composer.waitFor();
    await page.waitForFunction(async ({ id, state }) => (await (window as any).fixturePendingProbe())
      .some((entry: any) => entry.messageId === id && entry.state === state), { id: original.id, state: finalState });
    await delay(2200);
    assert.equal(await page.locator(".ai-legacy-pending-list .ai-pending-item").filter({ hasText: original.text }).count(), 0, "The unchanged legacy source must remain suppressed after reload");
    assert.equal(posts, postsBeforeReload, "Reload must not replay a resolved legacy item");
    assert.equal(prepared, preparationsBeforeReload, "Reload must not recapture a resolved legacy item");
    assert.equal(await composer.innerText(), localDraft, "A later draft must survive legacy resolution and reload");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), legacyKey), legacyRaw);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, `legacy-${legacyCase}-reloaded.png`) });
    results.push({ legacyCase, messageId: original.id, finalState, posts, committedPreparations: prepared, originalIdPreserved: true,
      explicitModelAndScope: legacyCase !== "accepted", onlyFinalTombstoneWritten: legacyCase === "missing-options" ? null : true,
      legacyBytesPreserved: true, noAutomaticMigration: true, noResurrectionAfterReload: true, localDraftPreserved: true, errors });
    await context.close();
  }
  await writeFile(join(output, "results.json"), JSON.stringify({ passed: true, synthetic: true, realSharedAIChat: true, paidProviderCalls: 0, cases: results }, null, 2));
  process.stdout.write(JSON.stringify({ passed: true, cases: results.length, output }) + "\n");
} catch (error) {
  const page = diagnosticPage;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, `${diagnosticCase}-failure.png`) }).catch(() => {});
    await writeFile(join(output, "failure.json"), JSON.stringify({ passed: false, case: diagnosticCase,
      error: (error as Error).stack ?? String(error), state: diagnosticState(),
      body: await page.locator("body").innerText().catch(() => "unavailable"),
    }, null, 2));
  }
  throw error;
} finally {
  await browser.close(); await web.close(); await app.close(); await db.destroy();
  await rm(root, { recursive: true, force: true });
}
