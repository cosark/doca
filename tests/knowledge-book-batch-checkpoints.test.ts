import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "@db/index.js";
import { createSchema } from "@db/create-schema.js";
import { currentSchemaTables } from "@db/introspection.js";
import { sql } from "kysely";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import { executeBookCommand } from "@core/modules/knowledge-books/commands.js";
import {
  createKnowledgeBook,
  saveBookConfiguration,
  queueBookRun,
} from "@core/modules/knowledge-books/management.js";
import { defaultBookConfiguration } from "@core/modules/knowledge-books/protocol.js";
import {
  createBookBatchCheckpoints,
  bookBatchCheckpointsEnabled,
} from "@core/modules/knowledge-books/batch-checkpoints.js";
import {
  cleanupBookPayloads,
  bindBookPayloadStore,
} from "@core/modules/knowledge-books/payload-storage.js";
import { payloadHash } from "@core/modules/knowledge-books/payload-codec.js";
import { createContent } from "@core/workflows/resources.js";
import { inspectBookStorageConversion } from "../apps/server/src/services/knowledge-book-storage-maintenance.js";
import { openTestDatabase } from "./database.js";
import { testBookPayloadStore } from "./book-payload-store.js";

let db: DB, actor: Actor, bookId: string, runId: string, lease: string;
let authorized: boolean, objects: ReturnType<typeof testBookPayloadStore>;
const nodeId = "extract";
const resultSchema = z
  .object({ value: z.string(), passed: z.boolean() })
  .strict();
const request = (input: unknown = { batch: 1 }) => ({
  phase: "extract",
  nodeInput: { candidate: "original" },
  input,
  model: { model: "test-model", maxOutput: 8000 },
  runtimeVersion: "test-batches-v1",
  evidence: [],
  validate: (value: unknown) => resultSchema.parse(value),
});
function checkpointStore(id = runId) {
  return createBookBatchCheckpoints({
    db,
    bookId,
    runId: id,
    nodeId,
    stage: "extract",
    scope: { configuration: 1 },
    guard: async (connection) => {
      const row = await connection
        .selectFrom("knowledge_book_runs")
        .select(["status", "lease_id", "book_id"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      if (
        row.status !== "running" ||
        row.lease_id !== lease ||
        row.book_id !== bookId
      )
        throw new Error("Lease changed");
      if (!authorized) throw new Error("Source permission revoked");
    },
  });
}
async function addRun() {
  const id = (await queueBookRun(db, actor, bookId)).id;
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "running", lease_id: lease })
    .where("id", "=", id)
    .execute();
  await db
    .insertInto("knowledge_book_node_runs")
    .values({
      run_id: id,
      node_id: nodeId,
      type: "extract",
      status: "running",
      input_refs: "[]",
      output: "",
      error: "",
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .execute();
  return id;
}
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  objects = testBookPayloadStore(db);
  actor = {
    ...(await createUser(
      db,
      { login: "checkpoint-qa", displayName: "QA", password: randomUUID() },
      { bootstrap: true },
    )),
    admin: 1,
  };
  bookId = (await createKnowledgeBook(db, actor, "Retained book")).id;
  const configuration = defaultBookConfiguration();
  configuration.goal = "Checkpoint isolation";
  await saveBookConfiguration(db, actor, bookId, 1, configuration);
  await executeBookCommand(db, actor, bookId, {
    operation: "source.save",
    expectedRevision: 0,
    title: "Isolated source",
    status: "active",
    configuration: {
      version: 1,
      items: [{ id: "manual", kind: "manual", markdown: "Synthetic source" }],
    },
  });
  lease = randomUUID();
  authorized = true;
  runId = await addRun();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.destroy();
});

it("restores validated results across store instances without repeating the request", async () => {
  const produce = vi.fn(async () => ({ value: "complete", passed: true }));
  await checkpointStore().run(request(), produce);
  const row = await db
    .selectFrom("knowledge_book_batch_checkpoints")
    .selectAll()
    .executeTakeFirstOrThrow();
  expect(JSON.parse(row.result_ref)).toMatchObject({
    type: "knowledge_book_batch_checkpoint_ref",
    version: 1,
    ownerKind: "batch",
  });
  expect(row.result_ref).not.toContain("complete");
  expect(await checkpointStore().run(request(), produce)).toEqual({
    value: "complete",
    passed: true,
  });
  expect(produce).toHaveBeenCalledTimes(1);
  expect(
    await db
      .selectFrom("knowledge_book_payload_references")
      .selectAll()
      .execute(),
  ).toEqual([]);
});
it("retains a negative verdict rather than retrying it into a pass", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "Incorrect sum",
    passed: false,
  }));
  const retry = vi.fn(async () => ({
    value: "Incorrect override",
    passed: true,
  }));
  expect(await checkpointStore().run(request(), retry)).toEqual({
    value: "Incorrect sum",
    passed: false,
  });
  expect(retry).not.toHaveBeenCalled();
});
it("does not persist partial failures and can retry their missing batch", async () => {
  await expect(
    checkpointStore().run(request(), async () => {
      throw new Error("Incomplete stream");
    }),
  ).rejects.toThrow("Incomplete stream");
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toEqual([]);
  await checkpointStore().run(request(), async () => ({
    value: "complete",
    passed: true,
  }));
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
it("deduplicates concurrent identical requests in one leased worker", async () => {
  const store = checkpointStore(),
    produce = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { value: "once", passed: true };
    });
  const result = await Promise.all([
    store.run(request(), produce),
    store.run(request(), produce),
  ]);
  expect(result[0]).toEqual(result[1]);
  expect(produce).toHaveBeenCalledTimes(1);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
it("rejects changed model settings and algorithms without altering retained rows", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "old",
    passed: true,
  }));
  const before = await db
    .selectFrom("knowledge_book_batch_checkpoints")
    .selectAll()
    .execute();
  const produce = vi.fn(async () => ({ value: "new", passed: true }));
  await expect(
    checkpointStore().run(
      { ...request(), model: { model: "another", maxOutput: 8000 } },
      produce,
    ),
  ).rejects.toThrow("model or algorithm changed");
  await expect(
    checkpointStore().run(
      { ...request(), runtimeVersion: "test-batches-v2" },
      produce,
    ),
  ).rejects.toThrow("model or algorithm changed");
  expect(produce).not.toHaveBeenCalled();
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toEqual(before);
});
it.each(["cancelled", "permission"])(
  "does not install a complete uploaded result after %s while uploading",
  async (mode) => {
    bindBookPayloadStore(db, {
      currentId: "test-book-store",
      async putImmutable(key, bytes) {
        objects.objects.set(key, Uint8Array.from(bytes));
        if (mode === "cancelled")
          await db
            .updateTable("knowledge_book_runs")
            .set({ status: "cancelled" })
            .where("id", "=", runId)
            .execute();
        else authorized = false;
        return {
          storeId: "test-book-store",
          key,
          size: bytes.length,
          sha256: payloadHash(bytes),
        };
      },
      async read(_store, key) {
        const bytes = objects.objects.get(key);
        if (!bytes) throw new Error("Missing object");
        return bytes;
      },
      async remove(_store, key) {
        objects.objects.delete(key);
      },
    });
    await expect(
      checkpointStore().run(request(), async () => ({
        value: "must remain uninstalled",
        passed: true,
      })),
    ).rejects.toThrow(
      mode === "cancelled" ? "Lease changed" : "permission revoked",
    );
    expect(
      await db
        .selectFrom("knowledge_book_batch_checkpoints")
        .selectAll()
        .execute(),
    ).toEqual([]);
    const journal = await db
      .selectFrom("knowledge_book_payload_operations")
      .select("state")
      .execute();
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.every((row) => row.state === "garbage")).toBe(true);
    expect(await cleanupBookPayloads(db, Date.now() + 3600000)).toBeGreaterThan(
      0,
    );
  },
);
it("installs only one immutable result when two instances finish the same request", async () => {
  const results = await Promise.all([
    checkpointStore().run(request(), async () => ({
      value: "first",
      passed: true,
    })),
    checkpointStore().run(request(), async () => ({
      value: "second",
      passed: true,
    })),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
it("keeps repaired candidate scopes separate and never copies batches across runs", async () => {
  const produce = vi.fn(async () => ({ value: "valid", passed: true }));
  await checkpointStore().run(request(), produce);
  await checkpointStore().run(
    { ...request(), nodeInput: { candidate: "repaired" } },
    produce,
  );
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "failed" })
    .where("id", "=", runId)
    .execute();
  const next = await addRun();
  await checkpointStore(next).run(request(), produce);
  expect(produce).toHaveBeenCalledTimes(3);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toHaveLength(3);
});
it("rejects conflicting model plans even when two instances start before either saves", async () => {
  let arrive!: () => void;
  const bothProducing = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let arrived = 0;
  const produce = async () => {
    if (++arrived === 2) arrive();
    await bothProducing;
    return { value: "retained", passed: true };
  };
  const results = await Promise.allSettled([
    checkpointStore().run(request(), produce),
    checkpointStore().run(
      { ...request(), model: { model: "changed" } },
      produce,
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failure = results.find((r) => r.status === "rejected");
  expect(failure?.status === "rejected" && String(failure.reason)).toContain(
    "model or algorithm changed",
  );
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
it("refuses storage rollback with retained checkpoints before modifying data", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "retained",
    passed: true,
  }));
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "failed" })
    .where("id", "=", runId)
    .execute();
  const before = await db
    .selectFrom("knowledge_book_batch_checkpoints")
    .selectAll()
    .execute();
  const baseline = await db.selectFrom("schema_baseline").selectAll().execute();
  await expect(inspectBookStorageConversion(db, "rollback")).rejects.toThrow(
    "checkpoint recovery plan",
  );
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toEqual(before);
  expect(await db.selectFrom("schema_baseline").selectAll().execute()).toEqual(
    baseline,
  );
});
it("revalidates current source permission before reading a stored result", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "private",
    passed: true,
  }));
  const reads = objects.reads;
  authorized = false;
  const produce = vi.fn(async () => ({ value: "never", passed: true }));
  await expect(checkpointStore().run(request(), produce)).rejects.toThrow(
    "permission revoked",
  );
  expect(objects.reads).toBe(reads);
  expect(produce).not.toHaveBeenCalled();
});
it.each(["cancelled", "lease"])(
  "prevents checkpoint installation after %s during generation",
  async (mode) => {
    await expect(
      checkpointStore().run(request(), async () => {
        await db
          .updateTable("knowledge_book_runs")
          .set(
            mode === "cancelled"
              ? { status: "cancelled" }
              : { lease_id: randomUUID() },
          )
          .where("id", "=", runId)
          .execute();
        return { value: "must not install", passed: true };
      }),
    ).rejects.toThrow("Lease changed");
    expect(
      await db
        .selectFrom("knowledge_book_batch_checkpoints")
        .selectAll()
        .execute(),
    ).toEqual([]);
  },
);
it("refuses an unknown format without silently regenerating or changing the row", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "retained",
    passed: true,
  }));
  const row = await db
    .selectFrom("knowledge_book_batch_checkpoints")
    .selectAll()
    .executeTakeFirstOrThrow();
  await db
    .updateTable("knowledge_book_batch_checkpoints")
    .set({
      result_ref: JSON.stringify({ ...JSON.parse(row.result_ref), version: 2 }),
    })
    .where("id", "=", row.id)
    .execute();
  const produce = vi.fn(async () => ({ value: "never", passed: true }));
  await expect(checkpointStore().run(request(), produce)).rejects.toThrow();
  expect(produce).not.toHaveBeenCalled();
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
it("stops on missing objects and on invalid restored results", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "retained",
    passed: true,
  }));
  const produce = vi.fn(async () => ({ value: "never", passed: true }));
  await expect(
    checkpointStore().run(
      {
        ...request(),
        validate: () => {
          throw new Error("Invalid retained schema");
        },
      },
      produce,
    ),
  ).rejects.toThrow("Invalid retained schema");
  // A second distinct result has not been read into the immutable-byte cache.
  await checkpointStore().run(request({ batch: 2 }), async () => ({
    value: "uncached",
    passed: true,
  }));
  objects.objects.clear();
  await expect(
    checkpointStore().run(request({ batch: 2 }), produce),
  ).rejects.toThrow();
  expect(produce).not.toHaveBeenCalled();
});
it("pins batch objects during garbage collection and releases them only with permanent book deletion", async () => {
  await checkpointStore().run(request(), async () => ({
    value: "retained",
    passed: true,
  }));
  expect(await cleanupBookPayloads(db, Date.now() + 3600000)).toBe(0);
  expect(
    await checkpointStore().run(request(), async () => {
      throw new Error("must reuse");
    }),
  ).toMatchObject({ value: "retained" });
  const content = createContent(db);
  const resource = await db
    .selectFrom("resources")
    .select("version")
    .where("id", "=", bookId)
    .executeTakeFirstOrThrow();
  await content.trash(actor, bookId, resource.version);
  expect(await cleanupBookPayloads(db, Date.now() + 3600000)).toBe(0);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .select("id")
      .execute(),
  ).toHaveLength(1);
  const removed = await db
    .selectFrom("resources")
    .select("version")
    .where("id", "=", bookId)
    .executeTakeFirstOrThrow();
  await content.purgeDeleted(actor, bookId, removed.version);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toEqual([]);
  expect(await cleanupBookPayloads(db, Date.now() + 3600000)).toBeGreaterThan(
    0,
  );
});
it("validates the operational disable switch without deleting checkpoints", async () => {
  expect(bookBatchCheckpointsEnabled()).toBe(true);
  vi.stubEnv("DOCA_BOOK_BATCH_CHECKPOINTS", "off");
  expect(bookBatchCheckpointsEnabled()).toBe(false);
  vi.stubEnv("DOCA_BOOK_BATCH_CHECKPOINTS", "other");
  expect(() => bookBatchCheckpointsEnabled()).toThrow("on or off");
});
it("rejects a lost previously installed checkpoint table instead of recreating it", async () => {
  await db.schema.dropTable("knowledge_book_batch_checkpoints").execute();
  await expect(createSchema(db)).rejects.toThrow(
    /knowledge_book_batch_checkpoints/,
  );
});
it("adds an empty checkpoint table to the prior structure with retained business rows and concurrent startup", async () => {
  const before = await db.selectFrom("knowledge_books").selectAll().execute();
  const baseline = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .executeTakeFirstOrThrow();
  const footprint = JSON.parse(baseline.structure_json!);
  delete footprint.knowledge_book_batch_checkpoints;
  await db.schema.dropTable("knowledge_book_batch_checkpoints").execute();
  await db
    .updateTable("schema_baseline")
    .set({ structure_json: JSON.stringify(footprint) })
    .execute();
  await Promise.all([createSchema(db), createSchema(db)]);
  await createSchema(db);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .selectAll()
      .execute(),
  ).toEqual([]);
  expect(await db.selectFrom("knowledge_books").selectAll().execute()).toEqual(
    before,
  );
});
it("does not apply a checkpoint addition when another schema difference requires review", async () => {
  const baseline = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .executeTakeFirstOrThrow();
  const footprint = JSON.parse(baseline.structure_json!);
  delete footprint.knowledge_book_batch_checkpoints;
  await db.schema.dropTable("knowledge_book_batch_checkpoints").execute();
  await db
    .updateTable("schema_baseline")
    .set({ structure_json: JSON.stringify(footprint) })
    .execute();
  await sql`create table retained_unknown (id varchar(36) primary key)`.execute(
    db,
  );
  await sql`insert into retained_unknown values ('retained')`.execute(db);
  await expect(createSchema(db)).rejects.toThrow(/retained_unknown/);
  const tables = await currentSchemaTables(db);
  expect(
    tables.some((table) => table.name === "knowledge_book_batch_checkpoints"),
  ).toBe(false);
  expect((await sql`select * from retained_unknown`.execute(db)).rows).toEqual([
    { id: "retained" },
  ]);
});
