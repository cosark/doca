// Verify a retained synthetic run without credentials or another provider call.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const existing = path.resolve(process.argv[2]!);
const output = path.resolve(process.argv[3]!);
assert(!existsSync(output), "Use a fresh verification directory");
mkdirSync(output, { recursive: true });
const read = (file: string) =>
  JSON.parse(readFileSync(path.join(existing, file), "utf8"));
const operation = read("saved-operation.json"),
  call = read("provider-call.json");
const receipt = JSON.parse(operation.result);
const traces = read("provider-requests.json");
assert.equal(traces.length, 1);
assert.equal(traces[0].status, 200);
assert.equal(
  traces[0].url,
  "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations",
);
assert.equal(receipt.state, "saved");
assert(
  receipt.rawCandidate &&
    receipt.providerCallId === call.id &&
    call.job_id === operation.job_id,
);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const retained = process.env.DOCA_QA_RETAINED_DB;
const retainedHash = retained ? sha256(readFileSync(retained)) : undefined;
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: {
    local: { provider: "local", root: path.join(existing, "storage") },
  },
});
const { openDatabase } = await import("../packages/db/src/index.js");
const { generateImageAsset } =
  await import("../apps/server/src/services/ai/images.js");
const { storageRuntime, createStorage, storageConfigForProfile } =
  await import("../apps/server/src/adapters/storage.js");
const { default: sharp } = await import("sharp");
const db = await openDatabase({
  driver: "sqlite",
  path: path.join(existing, "qa.db"),
});
let providerCalls = 0;
const noProvider: typeof fetch = async () => {
  providerCalls++;
  throw new Error("Saved-result verification cannot call a provider");
};
const storage = storageRuntime();
try {
  const actor = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", operation.user_id)
    .executeTakeFirstOrThrow();
  const job = await db
    .selectFrom("ai_jobs")
    .selectAll()
    .where("id", "=", operation.job_id)
    .executeTakeFirstOrThrow();
  assert.equal(job.user_id, actor.id);
  const before = {
    calls: await db.selectFrom("ai_calls").selectAll().orderBy("id").execute(),
    operations: await db
      .selectFrom("ai_operations")
      .selectAll()
      .orderBy("id")
      .execute(),
    assets: await db.selectFrom("assets").selectAll().orderBy("id").execute(),
  };
  assert.deepEqual(
    before.calls.find((row) => row.id === call.id),
    call,
  );
  assert.deepEqual(
    before.operations.find((row) => row.id === operation.id),
    operation,
  );
  const result = await generateImageAsset(
    db,
    { actor },
    { prompt: receipt.generation.prompt, size: traces[0].size },
    operation.id,
    { storage, fetch: noProvider },
  );
  assert.equal(result.assetId, receipt.assetId);
  assert.equal(result.generationOperationId, operation.id);
  const asset = await db
    .selectFrom("assets")
    .selectAll()
    .where("id", "=", receipt.assetId)
    .where("owner_id", "=", actor.id)
    .where("deleted_at", "is", null)
    .executeTakeFirstOrThrow();
  const profile = await db
    .selectFrom("storage_profiles")
    .selectAll()
    .where("id", "=", asset.profile_id)
    .executeTakeFirstOrThrow();
  const bytes = await createStorage(storage).read(
    storageConfigForProfile(storage, profile),
    asset.object_key,
    asset.size,
  );
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, receipt.width);
  assert.equal(metadata.height, receipt.height);
  assert.equal(
    sha256(bytes),
    sha256(readFileSync(path.join(existing, "generated-ui.png"))),
  );
  assert.deepEqual(
    {
      calls: await db
        .selectFrom("ai_calls")
        .selectAll()
        .orderBy("id")
        .execute(),
      operations: await db
        .selectFrom("ai_operations")
        .selectAll()
        .orderBy("id")
        .execute(),
      assets: await db.selectFrom("assets").selectAll().orderBy("id").execute(),
    },
    before,
  );
  assert.equal(providerCalls, 0);
  if (retainedHash) assert.equal(sha256(readFileSync(retained!)), retainedHash);
  const report = {
    passed: true,
    scope:
      "Verify saved receipt and stored image bytes in a new process after reopening the synthetic database; no application startup or new generation",
    originalProviderPosts: traces.length,
    providerCallsThisRun: providerCalls,
    responseHeadersMs: traces[0].responseHeadersMs,
    requestId: traces[0].requestId,
    image: {
      path: path.join(existing, "generated-ui.png"),
      width: metadata.width,
      height: metadata.height,
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
    savedReceiptSameAsset: true,
    callsOperationsAndAssetsUnchanged: true,
    storedBytesAfterProcessRestart: true,
    applicationStartupTested: false,
    rawCandidateRetained: true,
    providerUsage: JSON.parse(call.usage),
    originalUncertainDatabaseUnchanged: retainedHash ?? "not-present",
    originalUncertainResultReconciled: false,
    credentialRequired: false,
    productionConfigurationChanged: false,
  };
  writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      providerCallsThisRun: providerCalls,
      originalProviderPosts: traces.length,
      responseHeadersMs: traces[0].responseHeadersMs,
      image: report.image,
    }),
  );
} finally {
  await db.destroy();
}
