// Real Chrome + the actual Doca website and v2 quick-note HTTP routes.
// Synthetic accounts/documents/storage only; no extension bundle or model is run.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { readAIDocument } from "../packages/core/src/workflows/ai-documents.js";
import {
  createDocuments,
  restoreDocument,
  b64,
} from "../packages/core/src/modules/collaboration/documents.js";

const root = await mkdtemp(join(tmpdir(), "doca-quick-note-chrome-"));
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
const password = "isolated-browser-quick-note-2026";
const actor = {
  ...(await createUser(
    db,
    { login: "quicknotechrome", displayName: "Quick Note Chrome", password },
    { bootstrap: true },
  )),
  admin: 1,
};
const content = createContent(db),
  native = createDocuments(db);
const port = Number(process.env.DOCA_QA_PORT ?? 39507),
  origin = `http://127.0.0.1:${port}`;
let modelCalls = 0;
const app = await createApp(db, {
  origin,
  storage: storageRuntime(),
  ai: {
    memory: { driver: "sqlite", url: join(root, "memory.sqlite") },
    fetch: async () => {
      modelCalls++;
      throw Error("Quick-note QA must not call a model");
    },
  },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(root, "vite-cache"),
  server: {
    hmr: false,
    watch: { ignored: ["**/*"] },
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
await web.listen();
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? ".local/browser-quick-note-2026-10-22",
);
await mkdir(output, { recursive: true });
await rm(join(output, "results.json"), { force: true });
await rm(join(output, "failure.json"), { force: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cases: any[] = [],
  errors: string[] = [];
let diagnosticPage: Page | null = null,
  diagnosticCase = "setup";
try {
  const context = await browser.newContext({
    viewport: { width: 1380, height: 920 },
  });
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const request = async (
    path: string,
    data?: unknown,
    method = "GET",
    headers: Record<string, string> = {},
  ) => {
    const response = await context.request.fetch(origin + "/api/v1" + path, {
      method,
      headers: { origin, ...headers },
      data,
    });
    const text = await response.text();
    assert(response.ok(), `${method} ${path}: ${response.status()} ${text}`);
    return JSON.parse(text);
  };
  await request("/auth/login", { login: "quicknotechrome", password }, "POST");
  const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const connect = async () => {
    const verifier = randomBytes(32).toString("hex");
    const activation = await request(
      "/me/browser-clipper/authorize",
      {
        version: 2,
        installationId: randomUUID(),
        challenge: createHash("sha256").update(verifier).digest("hex"),
      },
      "POST",
    );
    return request(
      "/browser-clipper/token",
      { version: 2, code: activation.code, verifier },
      "POST",
      { origin: extensionOrigin, cookie: "" },
    );
  };
  const connection = await connect(),
    otherConnection = await connect();
  assert.notEqual(connection.connectionId, otherConnection.connectionId);
  const defaults = {
    enabled: true,
    isDefault: false,
    strategy: "append",
    libraryId: null,
    parentId: null,
    titleTemplate: "{title}",
    aiInstruction: "",
  };
  const createProfile = (
    targetId: string | null,
    values: Record<string, unknown> = {},
  ) =>
    request(
      "/me/browser-clipper/profiles",
      { ...defaults, name: "Synthetic quick-note target", targetId, ...values },
      "POST",
    );
  const docs: {
    format: "rich_text" | "markdown";
    resource: any;
    profile: any;
    original: string;
  }[] = [];
  for (const format of ["rich_text", "markdown"] as const) {
    const original = `原文_${format}_必须保留`;
    const resource = await content.create(actor, {
      kind: "document",
      format,
      title: `原文 ${format}`,
      ...(format === "markdown"
        ? { markdown: `# 原文 ${format}\n\n${original}` }
        : {}),
    });
    const baseline = await readAIDocument(db, { actor }, resource.id);
    if (format === "rich_text") {
      const loaded = await restoreDocument(db, resource.id);
      try {
        const last: any = loaded.runtime.getValue().at(-1);
        const update = loaded.runtime.editText(last.id, 0, 0, original);
        await native.exchange(actor, resource.id, {
          codec: "slate-kit",
          schemaVersion: 3,
          protocolVersion: 1,
          epochId: baseline.epochId!,
          messageId: randomUUID(),
          update: b64(update),
        });
      } finally {
        loaded.destroy();
      }
    }
    docs.push({
      format,
      resource,
      profile: await createProfile(resource.id, {
        name: `速记 ${format}`,
        isDefault: format === "rich_text",
      }),
      original,
    });
  }
  const unlisted = await content.create(actor, {
    kind: "document",
    format: "markdown",
    title: "Not an allowed quick-note target",
    markdown: "# 未授权目标\n保持原样",
  });
  await readAIDocument(db, { actor }, unlisted.id);
  await createProfile(unlisted.id, { enabled: false });
  await createProfile(null, { strategy: "create" });
  const browserQuick = async (
    page: Page,
    path: string,
    data?: unknown,
    token = connection.token,
    method = "POST",
  ) =>
    page.evaluate(
      async ({ origin, path, data, token, method }) => {
        try {
          const response = await fetch(
            origin + "/api/v1/browser-clipper/quick-note" + path,
            {
              method,
              credentials: "omit",
              headers: {
                authorization: `Bearer ${token}`,
                ...(data === undefined
                  ? {}
                  : { "content-type": "application/json" }),
              },
              ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            },
          );
          return {
            status: response.status,
            body: await response.json(),
            networkError: null,
          };
        } catch (error) {
          return {
            status: 0,
            body: null,
            networkError: (error as Error).message,
          };
        }
      },
      { origin, path, data, token, method },
    );
  const selector = (format: "rich_text" | "markdown") =>
    format === "rich_text" ? ".sk-editable" : ".cm-content";
  const visibleText = (page: Page, format: "rich_text" | "markdown") =>
    page.locator(selector(format)).first().innerText();
  const awaitText = (
    page: Page,
    format: "rich_text" | "markdown",
    text: string,
  ) =>
    page.waitForFunction(
      ({ selector, text }) =>
        document.querySelector(selector)?.textContent?.includes(text),
      { selector: selector(format), text },
    );
  const occurrences = (text: string, marker: string) =>
    text.split(marker).length - 1;

  for (const target of docs) {
    const { format, resource, profile, original } = target;
    diagnosticCase = format;
    const a = await context.newPage(),
      b = await context.newPage();
    diagnosticPage = a;
    await Promise.all([
      a.goto(`${origin}/#/r/${resource.id}`),
      b.goto(`${origin}/#/r/${resource.id}`),
    ]);
    await Promise.all([
      awaitText(a, format, original),
      awaitText(b, format, original),
    ]);
    const before = await readAIDocument(db, { actor }, resource.id);
    const stateBefore = await db
      .selectFrom("document_states")
      .selectAll()
      .where("resource_id", "=", resource.id)
      .executeTakeFirstOrThrow();
    await a.screenshot({ path: join(output, `${format}-before.png`) });
    const targets = await browserQuick(
      a,
      "/targets",
      undefined,
      connection.token,
      "GET",
    );
    assert.equal(targets.status, 200);
    assert.deepEqual(
      targets.body.items.map((item: any) => item.targetId).sort(),
      docs.map((doc) => doc.resource.id).sort(),
    );
    const requestId = randomUUID(),
      note = `新note_${format}_${requestId}\n第二行纯文字 **literal**`;
    const noteMarker = note.split("\n")[0]!;
    const preparation = await browserQuick(a, "/prepare", {
      requestId,
      profileId: profile.id,
      profileRevision: profile.revision,
      text: note,
    });
    assert.equal(preparation.status, 200, JSON.stringify(preparation));
    assert.equal(preparation.body.targetId, resource.id);
    assert.equal(preparation.body.format, format);
    assert.deepEqual(
      await db
        .selectFrom("document_states")
        .selectAll()
        .where("resource_id", "=", resource.id)
        .executeTakeFirstOrThrow(),
      stateBefore,
      "Preparing an already-open baseline must not write document state",
    );
    const commit = { requestId, ticket: preparation.body.ticket };
    let lostCommit: any = null;
    const routePattern = origin + "/api/v1/browser-clipper/quick-note/commit";
    await a.route(routePattern, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      lostCommit = await response.json();
      // Commit completed on the actual host; discard its first HTTP response.
      await route.abort("failed");
    });
    const lostReply = await browserQuick(a, "/commit", commit);
    await a.unroute(routePattern);
    assert.equal(
      lostReply.status,
      0,
      "The first browser request must lose its committed response",
    );
    assert(lostReply.networkError);
    assert(lostCommit?.changed);
    await Promise.all([
      awaitText(a, format, noteMarker),
      awaitText(b, format, noteMarker),
    ]);
    const committed = await readAIDocument(db, { actor }, resource.id);
    const retry = await browserQuick(a, "/commit", commit);
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.equal(retry.body.changed, false);
    assert.equal(retry.body.seq, lostCommit.seq);
    assert.equal(retry.body.epochId, before.epochId);
    assert.equal(retry.body.url, `${origin}/#/r/${resource.id}`);
    const after = await readAIDocument(db, { actor }, resource.id);
    assert.equal(after.epochId, before.epochId);
    assert.equal(after.seq, before.seq + 1);
    assert.deepEqual(
      after,
      committed,
      "Duplicate commit must not change native state or sequence",
    );
    if (format === "markdown")
      assert.equal(after.value, `${before.value}\n\n${note}`);
    else {
      assert.deepEqual(
        (after.value as any[]).slice(0, (before.value as any[]).length),
        before.value,
        "The original rich-text blocks must remain unchanged",
      );
      assert.deepEqual(
        (after.value as any[])
          .slice(-2)
          .map((node) => ({ type: node.type, children: node.children })),
        note
          .split("\n")
          .map((text) => ({ type: "paragraph", children: [{ text }] })),
      );
    }
    for (const [name, page] of [
      ["sender", a],
      ["peer", b],
    ] as const) {
      const value = await visibleText(page, format);
      assert(value.includes(original));
      assert.equal(
        occurrences(value, noteMarker),
        1,
        "Each open website editor must show exactly one appended note",
      );
      await page.screenshot({
        path: join(output, `${format}-${name}-live.png`),
      });
      await page.reload();
      await awaitText(page, format, noteMarker);
      assert((await visibleText(page, format)).includes(original));
      assert.equal(occurrences(await visibleText(page, format), noteMarker), 1);
      await page.screenshot({
        path: join(output, `${format}-${name}-reloaded.png`),
      });
    }
    const receipts = await db
      .selectFrom(
        format === "markdown" ? "markdown_receipts" : "editor_receipts",
      )
      .selectAll()
      .where("resource_id", "=", resource.id)
      .where("message_id", "=", requestId)
      .execute();
    assert.equal(receipts.length, 1);
    cases.push({
      format,
      requestId,
      originalContentPreserved: true,
      exactTargetList: true,
      prepareWithoutDocumentWrite: true,
      firstCommitReplyLost: true,
      sameTicketRetryWithoutSequenceIncrease: true,
      originalEpochPreserved: true,
      liveTwoPagesOnce: true,
      reloadTwoPagesOnce: true,
      nativeReceiptCount: receipts.length,
      seqBefore: before.seq,
      seqAfter: after.seq,
    });
    await a.close();
    await b.close();
  }

  diagnosticCase = "authorization-boundaries";
  const page = await context.newPage();
  diagnosticPage = page;
  await page.goto(`${origin}/#/r/${docs[0]!.resource.id}`);
  await awaitText(page, "rich_text", docs[0]!.original);
  const target = docs[0]!,
    snapshot = await readAIDocument(db, { actor }, target.resource.id),
    otherSnapshot = await readAIDocument(db, { actor }, unlisted.id);
  const requestId = randomUUID();
  const prepared = await browserQuick(page, "/prepare", {
    requestId,
    profileId: target.profile.id,
    profileRevision: target.profile.revision,
    text: "边界拒绝内容不应写入",
  });
  assert.equal(prepared.status, 200, JSON.stringify(prepared));
  const commit = { requestId, ticket: prepared.body.ticket };
  const wrongConnection = await browserQuick(
    page,
    "/commit",
    commit,
    otherConnection.token,
  );
  assert.equal(wrongConnection.status, 409);
  const wrongTargetPrepare = await browserQuick(page, "/prepare", {
    requestId: randomUUID(),
    profileId: target.profile.id,
    profileRevision: target.profile.revision,
    text: "不得扩张目标",
    targetId: unlisted.id,
  });
  assert.equal(wrongTargetPrepare.status, 400);
  const wrongTargetCommit = await browserQuick(page, "/commit", {
    ...commit,
    targetId: unlisted.id,
  });
  assert.equal(wrongTargetCommit.status, 400);
  const revised = await request(
    `/me/browser-clipper/profiles/${target.profile.id}`,
    {
      ...defaults,
      name: "Changed exact target",
      targetId: unlisted.id,
      revision: target.profile.revision,
    },
    "PUT",
  );
  assert(revised.revision > target.profile.revision);
  const changedProfile = await browserQuick(page, "/commit", commit);
  assert.equal(changedProfile.status, 409);
  assert.deepEqual(
    await readAIDocument(db, { actor }, target.resource.id),
    snapshot,
    "Rejected commits must not touch the old target",
  );
  assert.deepEqual(
    await readAIDocument(db, { actor }, unlisted.id),
    otherSnapshot,
    "Rejected commits must not write a changed target",
  );
  await page.screenshot({
    path: join(output, "authorization-boundaries-original-preserved.png"),
  });
  cases.push({
    case: "authorization-boundaries",
    differentConnectionStatus: wrongConnection.status,
    arbitraryPrepareTargetStatus: wrongTargetPrepare.status,
    arbitraryCommitTargetStatus: wrongTargetCommit.status,
    changedProfileStatus: changedProfile.status,
    oldAndNewTargetsUnchanged: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(modelCalls, 0);
  assert.equal(
    (await db.selectFrom("ai_calls").select("id").execute()).length,
    0,
  );
  assert.equal(
    (await db.selectFrom("ai_jobs").select("id").execute()).length,
    0,
  );
  assert.equal(
    (await db.selectFrom("browser_clipper_receipts").selectAll().execute())
      .length,
    0,
  );
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        synthetic: true,
        actualChromeWebsite: true,
        actualV2BrowserConnection: true,
        extensionBundleExecuted: false,
        paidProviderCalls: 0,
        aiCalls: 0,
        aiJobs: 0,
        clipReceipts: 0,
        cases,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: true, cases: cases.length, output }));
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    await diagnosticPage
      .screenshot({ path: join(output, `${diagnosticCase}-failure.png`) })
      .catch(() => {});
    await writeFile(
      join(output, "failure.json"),
      JSON.stringify(
        {
          passed: false,
          case: diagnosticCase,
          error: (error as Error).stack ?? String(error),
          errors,
          body: await diagnosticPage
            .locator("body")
            .innerText()
            .catch(() => "unavailable"),
        },
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
