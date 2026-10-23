// One explicitly enabled Agent Plan image request through the real Doca tools.
// Read the credential from stdin; persist only a synthetic transport placeholder.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

assert.equal(
  process.env.DOCA_QA_ALLOW_IMAGE_GENERATION,
  "1",
  "Explicitly enable the single real image request",
);
const output = path.resolve(
  process.argv[2] ?? "artifacts/verification/ark-plan-image",
);
assert(!existsSync(output), "Use a fresh verification directory");
mkdirSync(output, { recursive: true });
const input = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});
const apiKey = (
  await input.question("Agent Plan credential (stdin only): ")
).trim();
input.close();
assert(apiKey.length > 10);
const redact = (value: unknown) =>
  String(value).replaceAll(apiKey, "[redacted]");
const write = (name: string, value: unknown) => {
  const bytes = JSON.stringify(value, null, 2) + "\n";
  assert(!bytes.includes(apiKey), "Credential must never enter an artifact");
  writeFileSync(path.join(output, name), bytes);
};
const source = process.env.DOCA_QA_RETAINED_DB;
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const originalHash =
  source && existsSync(source) ? sha256(readFileSync(source)) : undefined;
const endpoint = "https://ark.cn-beijing.volces.com/api/plan/v3";
const model = "doubao-seedream-5.0-pro";
const profile = "doubao-seedream-5-0-pro-260628";
const placeholder = "synthetic-credential-replaced-only-in-transport";
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
// Retain this synthetic fixture's unrelated host key for later application reopens.
// The actual Agent Plan credential is still used only in transport memory.
writeFileSync(
  path.join(output, ".qa-credential-master-key"),
  process.env.DOCA_CREDENTIAL_MASTER_KEY,
  { mode: 0o600 },
);
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: path.join(output, "storage") } },
});
const { openDatabase } = await import("../packages/db/src/index.js");
const { createUser } =
  await import("../packages/core/src/modules/identity/passwords.js");
const { aiDefaults, saveAIConfig } =
  await import("../packages/core/src/modules/ai/config.js");
const { createAIRunner } =
  await import("../apps/server/src/services/ai/runner.js");
const { generateImageAsset } =
  await import("../apps/server/src/services/ai/images.js");
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const { default: sharp } = await import("sharp");
const storage = storageRuntime();
const dbPath = path.join(output, "qa.db");
const memory = {
  driver: "sqlite" as const,
  url: path.join(output, "memory.db"),
};
let db = await openDatabase({ driver: "sqlite", path: dbPath });
let runner: ReturnType<typeof createAIRunner> | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
const requests: Record<string, unknown>[] = [];
let providerCalls = 0;
const noProvider: typeof fetch = async () => {
  throw new Error("Replay and API reads must not call a provider");
};
const transport: typeof fetch = async (url, init) => {
  assert.equal(String(url), endpoint + "/images/generations");
  assert.equal(init?.method, "POST");
  assert.equal(
    providerCalls,
    0,
    "Only one image submission is authorized for this verification",
  );
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), "Bearer " + placeholder);
  headers.set("authorization", "Bearer " + apiKey);
  const request = JSON.parse(String(init.body));
  assert.equal(request.model, model);
  const trace: Record<string, unknown> = {
    url: String(url),
    method: "POST",
    model,
    size: request.size,
    startedAt: new Date().toISOString(),
  };
  requests.push(trace);
  write("provider-requests.json", requests);
  const start = performance.now();
  try {
    providerCalls++;
    const response = await fetch(url, { ...init, headers, redirect: "error" });
    Object.assign(trace, {
      status: response.status,
      responseHeadersMs: Math.round(performance.now() - start),
      requestId:
        response.headers.get("x-request-id") ??
        response.headers.get("x-tt-logid"),
    });
    write("provider-requests.json", requests);
    return response;
  } catch (error) {
    Object.assign(trace, {
      transportError: redact(error),
      elapsedMs: Math.round(performance.now() - start),
    });
    write("provider-requests.json", requests);
    throw error;
  }
};
try {
  const actor = {
    ...(await createUser(
      db,
      {
        login: "ark-plan-qa",
        displayName: "Agent Plan QA",
        password: "synthetic-ark-plan-qa-2026",
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
  await saveAIConfig(
    db,
    {
      ...aiDefaults,
      imageModel: "ark-plan-image",
      vendors: [
        {
          id: "ark-plan",
          name: "Direct Ark Agent Plan QA",
          provider: "doubao",
          baseUrl: endpoint,
          apiKey: placeholder,
          enabled: true,
        },
      ],
      models: [
        {
          id: "ark-plan-image",
          vendorId: "ark-plan",
          model,
          alias: "Seedream Pro direct QA",
          enabled: true,
          tools: false,
          imageGeneration: true,
          imageProfile: profile,
          imageSize: "2731x1536",
          maxInput: 32000,
          maxOutput: 1000,
        },
      ],
    },
    0,
  );
  const prompt =
    "生成一张用于连接验收的高保真阅读应用界面位图，16:9横幅，浅色背景，左侧窄导航栏，右侧为今日阅读、阅读进度、推荐书籍卡片，青绿色强调色，中文文字清晰，简洁专业。仅一张完整扁平UI图片，不要手机外壳，不要透视效果。";
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    user_id: actor.id,
    title: "Direct Agent Plan image and restart QA",
    model_id: null,
    resource_ids: "[]",
    mentioned_resource_ids: "[]",
    approved_resource_ids: "[]",
    archived: 0,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  const job = {
    id: randomUUID(),
    session_id: session.id,
    user_id: actor.id,
    model_id: "mcp-client",
    status: "running",
    input: JSON.stringify({
      text: prompt,
      scope: "all",
      attachments: [],
      references: [],
      files: [],
      skillIds: [],
      webSearch: false,
    }),
    digest: randomUUID(),
    result: "",
    error: "",
    lease: randomUUID(),
    lease_until: new Date(Date.now() + 600000).toISOString(),
    attempts: 1,
    cancelled: 0,
    created_at: now,
    updated_at: now,
  };
  await db.insertInto("ai_sessions").values(session).execute();
  await db.insertInto("ai_jobs").values(job).execute();
  const args = { prompt, size: "2731x1536" };
  const toolsFor = async () =>
    runner!.externalTools(job, new AbortController().signal, {
      actor,
      session,
      allowsTool: (id) => id === "image_generate",
      allowsSkill: () => false,
      authorize: async () => {},
    });
  runner = createAIRunner(db, {
    storage,
    memory,
    fetch: noProvider,
    imageFetch: transport,
  });
  const start = performance.now();
  const first: any = (
    await (await toolsFor()).call("image_generate", args, randomUUID())
  ).output;
  assert.equal(first.state, "saved");
  assert(first.assetId && first.rawCandidate && first.providerCallId);
  assert.equal(providerCalls, 1);
  const operation = await db
    .selectFrom("ai_operations")
    .selectAll()
    .where("id", "=", first.generationOperationId)
    .executeTakeFirstOrThrow();
  const call = await db
    .selectFrom("ai_calls")
    .selectAll()
    .where("id", "=", first.providerCallId)
    .executeTakeFirstOrThrow();
  const nativeUsage = JSON.parse(call.usage);
  write("saved-operation.json", operation);
  write("provider-call.json", call);
  const beforeCounts = {
    assets: (await db.selectFrom("assets").select("id").execute()).length,
    calls: (await db.selectFrom("ai_calls").select("id").execute()).length,
    operations: (await db.selectFrom("ai_operations").select("id").execute())
      .length,
  };
  await runner.close();
  runner = undefined;
  await db.destroy();
  db = await openDatabase({ driver: "sqlite", path: dbPath });
  // MCP request IDs still have their existing at-most-once/conflict contract.
  // Test durable image-receipt reuse directly, without submitting a new MCP call.
  const second = await generateImageAsset(
    db,
    { actor, jobId: job.id, lease: job.lease },
    args,
    first.generationOperationId,
    { storage, fetch: noProvider },
  );
  assert.equal(second.assetId, first.assetId);
  assert.equal(second.generationOperationId, first.generationOperationId);
  assert.deepEqual(
    await db
      .selectFrom("ai_operations")
      .selectAll()
      .where("id", "=", first.generationOperationId)
      .executeTakeFirstOrThrow(),
    operation,
  );
  assert.deepEqual(
    await db
      .selectFrom("ai_calls")
      .selectAll()
      .where("id", "=", first.providerCallId)
      .executeTakeFirstOrThrow(),
    call,
  );
  assert.deepEqual(
    {
      assets: (await db.selectFrom("assets").select("id").execute()).length,
      calls: (await db.selectFrom("ai_calls").select("id").execute()).length,
      operations: (await db.selectFrom("ai_operations").select("id").execute())
        .length,
    },
    beforeCounts,
  );
  app = await createApp(db, {
    origin: "http://localhost:39496",
    storage,
    ai: { memory, fetch: noProvider, imageFetch: noProvider },
  });
  const headers = {
    origin: "http://localhost:39496",
    host: "localhost:39496",
    cookie: "",
  };
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers,
    payload: { login: "ark-plan-qa", password: "synthetic-ark-plan-qa-2026" },
  });
  assert.equal(login.statusCode, 200);
  headers.cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const downloaded = await app.inject({
    method: "GET",
    url: first.url,
    headers,
  });
  assert.equal(downloaded.statusCode, 200);
  const bytes = downloaded.rawPayload;
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, first.width);
  assert.equal(metadata.height, first.height);
  writeFileSync(path.join(output, "generated-ui.png"), bytes);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: first.url,
        headers: { ...headers, cookie: "" },
      })
    ).statusCode,
    404,
  );
  if (originalHash)
    assert.equal(
      sha256(readFileSync(source!)),
      originalHash,
      "Original uncertain database must remain unchanged",
    );
  const report = {
    passed: true,
    scope:
      "New isolated Agent Plan image request through the real Doca image_generate tool, then DB restart, saved-receipt reuse and authenticated download",
    endpoint,
    model,
    profile,
    providerCalls,
    retries: 0,
    totalElapsedMs: Math.round(performance.now() - start),
    jobId: job.id,
    operationId: first.generationOperationId,
    providerCallId: first.providerCallId,
    image: {
      path: "generated-ui.png",
      width: metadata.width,
      height: metadata.height,
      size: bytes.length,
      sha256: sha256(bytes),
    },
    rawCandidateRetained: true,
    persistedReplaySameAssetAndOperation: true,
    replayCreatedNoAssetsCallsOrOperations: true,
    downloadAfterRestart: true,
    anonymousDownloadDenied: true,
    providerUsage: nativeUsage,
    originalUncertainDatabaseUnchanged: originalHash ?? "not-present",
    originalUncertainResultReconciled: false,
    credentialPersisted: false,
    productionConfigurationChanged: false,
  };
  write("results.json", report);
  console.log(
    JSON.stringify({
      passed: true,
      providerCalls,
      replayAfterRestart: true,
      image: report.image,
    }),
  );
} catch (error) {
  write("failure.json", {
    passed: false,
    error: redact(error instanceof Error ? error.stack : error),
    providerCalls,
    retries: 0,
    originalUncertainResultReconciled: false,
  });
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await runner?.close();
  await app?.close();
  await db.destroy();
}
