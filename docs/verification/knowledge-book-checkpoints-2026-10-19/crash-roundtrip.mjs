import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
if (!process.env.DOCA_CHECKPOINT_CRASH_ROOT)
  throw new Error(
    "Set a fresh isolated DOCA_CHECKPOINT_CRASH_ROOT for save; reuse it for resume",
  );
const root = path.resolve(process.env.DOCA_CHECKPOINT_CRASH_ROOT);
const { openDatabase } = await import("../../../packages/db/src/connection.ts");
const { createUser } =
  await import("../../../packages/core/src/modules/identity/passwords.ts");
const { createKnowledgeBook, saveBookConfiguration, queueBookRun } =
  await import("../../../packages/core/src/modules/knowledge-books/management.ts");
const { executeBookCommand } =
  await import("../../../packages/core/src/modules/knowledge-books/commands.ts");
const { defaultBookConfiguration } =
  await import("../../../packages/core/src/modules/knowledge-books/protocol.ts");
const { readBookSource } =
  await import("../../../packages/core/src/modules/knowledge-books/sources.ts");
const { validateBookModelAccess } =
  await import("../../../packages/core/src/modules/knowledge-books/model-access.ts");
const { createBookBatchCheckpoints } =
  await import("../../../packages/core/src/modules/knowledge-books/batch-checkpoints.ts");
const { bindBookPayloadStore, cleanupBookPayloads } =
  await import("../../../packages/core/src/modules/knowledge-books/payload-storage.ts");
const { createHostFileStore } =
  await import("../../../apps/server/src/services/host-file-store.ts");
const { storageRuntime } =
  await import("../../../apps/server/src/adapters/storage.ts");
await mkdir(root, { recursive: true, mode: 0o700 });
process.env.DOCA_FILE_STORE_ID = "checkpoint-cold-qa";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: {
    "checkpoint-cold-qa": {
      provider: "local",
      root: path.join(root, "objects"),
    },
  },
});
const db = await openDatabase({
  driver: "sqlite",
  path: path.join(root, "cold.db"),
});
bindBookPayloadStore(db, createHostFileStore(storageRuntime()));
const mode = process.env.DOCA_CHECKPOINT_CRASH_MODE;
let state;
if (mode === "save") {
  const actor = {
    ...(await createUser(
      db,
      {
        login: "cold-checkpoint-qa",
        displayName: "QA",
        password: randomUUID(),
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
  const bookId = (await createKnowledgeBook(db, actor, "Cold checkpoint QA"))
    .id;
  const configuration = defaultBookConfiguration();
  configuration.goal = "Verify cold process restore";
  await saveBookConfiguration(db, actor, bookId, 1, configuration);
  await executeBookCommand(db, actor, bookId, {
    operation: "source.save",
    expectedRevision: 0,
    title: "Cold source",
    status: "active",
    configuration: {
      version: 1,
      items: [
        {
          id: "manual",
          kind: "manual",
          markdown: "Synthetic retained source.",
        },
      ],
    },
  });
  const runId = (await queueBookRun(db, actor, bookId)).id;
  state = { bookId, runId, userId: actor.id, lease: randomUUID() };
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "running", lease_id: state.lease })
    .where("id", "=", runId)
    .execute();
  await db
    .insertInto("knowledge_book_node_runs")
    .values({
      run_id: runId,
      node_id: "extract",
      type: "extract",
      status: "running",
      input_refs: "[]",
      output: "",
      error: "",
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .execute();
  await writeFile(path.join(root, "state.json"), JSON.stringify(state), {
    mode: 0o600,
  });
} else {
  state = JSON.parse(await readFile(path.join(root, "state.json"), "utf8"));
  state.lease = randomUUID();
  await db
    .updateTable("knowledge_book_runs")
    .set({ lease_id: state.lease })
    .where("id", "=", state.runId)
    .execute();
}
const source = await db
  .selectFrom("knowledge_book_sources")
  .selectAll()
  .where("book_id", "=", state.bookId)
  .executeTakeFirstOrThrow();
const evidence = (
  await readBookSource(db, source, {
    readFile() {
      throw new Error("unexpected file");
    },
    readWeb() {
      throw new Error("unexpected web");
    },
  })
).map((item) => ({ ...item, weight: 1 }));
const store = createBookBatchCheckpoints({
  db,
  bookId: state.bookId,
  runId: state.runId,
  nodeId: "extract",
  stage: "extract",
  scope: "cold-test-frozen-scope",
  guard: async (connection) => {
    const run = await connection
      .selectFrom("knowledge_book_runs")
      .selectAll()
      .where("id", "=", state.runId)
      .executeTakeFirstOrThrow();
    assert.equal(run.status, "running");
    assert.equal(run.lease_id, state.lease);
    await validateBookModelAccess(
      connection,
      state.userId,
      state.runId,
      evidence,
    );
  },
});
const request = (batch) => ({
  phase: "extract",
  nodeInput: { source: "unchanged" },
  input: { batch },
  model: { model: "isolated-test", maxOutput: 8000 },
  runtimeVersion: "cold-test-v1",
  evidence,
  validate: (value) => {
    assert.equal(typeof value.value, "string");
    return value;
  },
});
if (mode === "save") {
  await store.run(request(1), async () => ({
    value: "Complete original batch",
  }));
  console.log(
    JSON.stringify({
      event: "checkpoint_saved_before_sigkill",
      rows: (
        await db
          .selectFrom("knowledge_book_batch_checkpoints")
          .select("id")
          .execute()
      ).length,
    }),
  );
  process.kill(process.pid, "SIGKILL");
} else {
  let oldCalls = 0,
    newCalls = 0;
  const first = await store.run(request(1), async () => {
    oldCalls++;
    throw new Error("Completed batch must not be executed again");
  });
  const second = await store.run(request(2), async () => {
    newCalls++;
    return { value: "Complete missing batch" };
  });
  assert.equal(first.value, "Complete original batch");
  assert.equal(second.value, "Complete missing batch");
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
  assert.equal(await cleanupBookPayloads(db, Date.now() + 3600000), 0);
  assert.equal(
    (
      await db
        .selectFrom("knowledge_book_batch_checkpoints")
        .select("id")
        .execute()
    ).length,
    2,
  );
  console.log(
    JSON.stringify({
      event: "cold_process_restore_pass",
      originalBatchCalls: oldCalls,
      missingBatchCalls: newCalls,
      durableCheckpointRows: 2,
      gcPreserved: true,
    }),
  );
  await db.destroy();
}
