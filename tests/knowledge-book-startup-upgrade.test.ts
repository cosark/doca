import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { DB } from "@db/index.js";
import { createSchema, CURRENT_SCHEMA_BASELINE } from "@db/create-schema.js";
import { currentSchemaTables } from "@db/introspection.js";
import { databaseDriver, registerDriver, transact } from "@db/transactions.js";
import { inheritDatabaseRuntimeScope } from "@db/runtime-scope.js";
import { HISTORY_SCHEMA_BASELINE } from "@db/history-schema.js";
import {
  bookPayloadTables,
  BOOK_PAYLOAD_UPGRADE,
  BOOK_PAYLOAD_ROLLBACK,
} from "@db/book-payload-schema.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import { executeBookCommand } from "@core/modules/knowledge-books/commands.js";
import { defaultBookConfiguration } from "@core/modules/knowledge-books/protocol.js";
import {
  createKnowledgeBook,
  saveBookConfiguration,
  queueBookRun,
} from "@core/modules/knowledge-books/management.js";
import {
  prepareBookPayload,
  installBookPayload,
  readBookPayloadRaw,
} from "@core/modules/knowledge-books/payload-storage.js";
import { openTestDatabase } from "./database.js";

let db: DB, actor: Actor, bookId: string, runId: string;
const raw = JSON.stringify({ evidence: [], claims: [], pages: [], checks: [] });

beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  actor = {
    ...(await createUser(
      db,
      {
        login: "startup-book",
        displayName: "Synthetic",
        password: randomUUID(),
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
  bookId = (await createKnowledgeBook(db, actor, "Retained definition")).id;
  const configuration = defaultBookConfiguration();
  configuration.goal = "Synthetic startup upgrade";
  await saveBookConfiguration(db, actor, bookId, 1, configuration);
  await executeBookCommand(db, actor, bookId, {
    operation: "source.save",
    expectedRevision: 0,
    title: "Retained source",
    status: "active",
    configuration: {
      version: 1,
      items: [{ id: "manual", kind: "manual", markdown: "Retained source" }],
    },
  });
  runId = (await queueBookRun(db, actor, bookId)).id;
});
afterEach(async () => {
  await db.destroy();
});

async function inlineFixture() {
  const now = new Date().toISOString(),
    releaseId = randomUUID();
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "published", artifact: raw })
    .where("id", "=", runId)
    .execute();
  await db
    .insertInto("knowledge_book_node_runs")
    .values({
      run_id: runId,
      node_id: "organize",
      type: "organize",
      status: "completed",
      input_refs: "[]",
      output: raw,
      error: "",
      started_at: now,
      completed_at: now,
    })
    .execute();
  await db
    .insertInto("knowledge_book_releases")
    .values({
      id: releaseId,
      book_id: bookId,
      run_id: runId,
      revision: 1,
      artifact: raw,
      created_at: now,
    })
    .execute();
  await db
    .updateTable("knowledge_books")
    .set({ published_release_id: releaseId })
    .where("id", "=", bookId)
    .execute();
  await db
    .insertInto("knowledge_book_human_tasks")
    .values({
      id: randomUUID(),
      book_id: bookId,
      run_id: runId,
      node_id: "publish",
      kind: "publication",
      title: "Old decision",
      status: "pending",
      revision: 1,
      input_hash: "old-input",
      resolution: "",
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto("knowledge_book_feedback")
    .values({
      id: randomUUID(),
      book_id: bookId,
      author_id: actor.id,
      revision: 1,
      detail: '{"note":"Retained feedback"}',
      status: "active",
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto("notifications")
    .values({
      id: randomUUID(),
      user_id: actor.id,
      actor_id: null,
      resource_id: bookId,
      type: "knowledge_book.publication",
      read_at: null,
      created_at: now,
      dedupe_key: "retained-notification",
    })
    .execute();
  const original = await db
    .selectFrom("knowledge_book_runs")
    .selectAll()
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  for (const status of [
    "failed",
    "awaiting_input",
    "queued",
    "running",
  ] as const)
    await db
      .insertInto("knowledge_book_runs")
      .values({ ...original, id: randomUUID(), status, trigger_key: null })
      .execute();
  for (const table of [...bookPayloadTables].reverse())
    await sql.raw(`drop table ${table}`).execute(db);
  const baseline = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .executeTakeFirstOrThrow();
  const footprint = JSON.parse(baseline.structure_json!);
  for (const table of bookPayloadTables) delete footprint[table];
  await db
    .updateTable("schema_baseline")
    .set({
      id: HISTORY_SCHEMA_BASELINE,
      structure_json: JSON.stringify(footprint),
    })
    .execute();
}
async function snapshot() {
  const rows: Record<string, unknown[]> = {};
  for (const table of await currentSchemaTables(db)) {
    const data = (
      await sql<
        Record<string, unknown>
      >`select * from ${sql.table(table.name)}`.execute(db)
    ).rows;
    rows[table.name] = data.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return rows;
}
async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>) {
  expect(await snapshot()).toEqual(before);
}

it("automatically aligns the old schema while preserving every SQL row and setting", async () => {
  await inlineFixture();
  const before = await snapshot();
  await createSchema(db);
  for (const table of bookPayloadTables)
    expect(
      (await sql`select * from ${sql.table(table)}`.execute(db)).rows,
    ).toEqual([]);
  const after = await snapshot();
  for (const [table, rows] of Object.entries(before)) {
    if (table === "schema_baseline") continue;
    expect(after[table]).toEqual(rows);
  }
  expect(
    (
      await db
        .selectFrom("schema_baseline")
        .select("id")
        .executeTakeFirstOrThrow()
    ).id,
  ).toBe(CURRENT_SCHEMA_BASELINE);
  await expect(
    readBookPayloadRaw(db, raw, {
      bookId,
      ownerKind: "node",
      ownerId: runId,
      nodeId: "organize",
    }),
  ).rejects.toThrow();
  // A new native payload remains readable after subsequent/concurrent startup.
  const nextRun = randomUUID();
  const owner = {
    bookId,
    ownerKind: "node" as const,
    ownerId: nextRun,
    nodeId: "new",
  };
  const prepared = await prepareBookPayload(db, owner, raw);
  await transact(db, async (tx) => {
    await installBookPayload(tx, prepared);
  });
  const installed = await snapshot();
  await Promise.all([createSchema(db), createSchema(db)]);
  await expectUnchanged(installed);
  expect(await readBookPayloadRaw(db, prepared.marker, owner)).toBe(raw);
});

it("serializes two startup upgrades without changing old or new records", async () => {
  await inlineFixture();
  const before = await snapshot();
  await Promise.all([createSchema(db), createSchema(db)]);
  const after = await snapshot();
  for (const [table, rows] of Object.entries(before))
    if (table !== "schema_baseline") expect(after[table]).toEqual(rows);
  await createSchema(db);
  await expectUnchanged(after);
});

it("rejects a review-required structure before applying any additions", async () => {
  await inlineFixture();
  await db.schema
    .createTable("unowned_legacy_business_data")
    .addColumn("value", "text")
    .execute();
  await sql`insert into unowned_legacy_business_data values ('retained')`.execute(
    db,
  );
  const before = await snapshot();
  await expect(createSchema(db)).rejects.toThrow(
    "unowned_legacy_business_data",
  );
  await expectUnchanged(before);
});

it("rolls back table additions if final generation recording fails", async () => {
  await inlineFixture();
  let attempted = false;
  const failing = db.withPlugin({
    transformQuery({ node }) {
      const text = JSON.stringify(node);
      if (
        node.kind === "UpdateQueryNode" &&
        text.includes('"name":"schema_baseline"') &&
        text.includes('"name":"id"')
      ) {
        attempted = true;
        throw new Error("synthetic generation failure");
      }
      return node;
    },
    async transformResult({ result }) {
      return result;
    },
  });
  registerDriver(failing, databaseDriver(db));
  inheritDatabaseRuntimeScope(db, failing);
  const before = await snapshot();
  await expect(createSchema(failing)).rejects.toThrow(
    "synthetic generation failure",
  );
  expect(attempted).toBe(true);
  await expectUnchanged(before);
});

it("preserves current-generation objects, outputs and generated records exactly", async () => {
  const owner = {
    bookId,
    ownerKind: "node" as const,
    ownerId: runId,
    nodeId: "native",
  };
  const prepared = await prepareBookPayload(db, owner, raw);
  await transact(db, async (tx) => {
    await installBookPayload(tx, prepared);
  });
  const before = await snapshot();
  await createSchema(db);
  await expectUnchanged(before);
  expect(await readBookPayloadRaw(db, prepared.marker, owner)).toBe(raw);
});

it.each([BOOK_PAYLOAD_UPGRADE, BOOK_PAYLOAD_ROLLBACK, "unknown-generation"])(
  "preserves all rows and structure when rejecting generation %s",
  async (generation) => {
    await inlineFixture();
    await db.updateTable("schema_baseline").set({ id: generation }).execute();
    const before = await snapshot();
    await expect(createSchema(db)).rejects.toThrow(/Interrupted|not supported/);
    await expectUnchanged(before);
  },
);

it("rejects lost installed fields without changing generated records", async () => {
  await inlineFixture();
  await db.schema
    .alterTable("file_folder_share_links")
    .dropColumn("max_members")
    .execute();
  const before = await snapshot();
  await expect(createSchema(db)).rejects.toThrow(
    "previously installed structure is missing",
  );
  await expectUnchanged(before);
});

it("preserves existing storage tables when aligning the previous generation", async () => {
  const owner = {
    bookId,
    ownerKind: "node" as const,
    ownerId: runId,
    nodeId: "native",
  };
  const prepared = await prepareBookPayload(db, owner, raw);
  await transact(db, async (tx) => {
    await installBookPayload(tx, prepared);
  });
  await db
    .updateTable("schema_baseline")
    .set({ id: HISTORY_SCHEMA_BASELINE })
    .execute();
  const before = await snapshot();
  await createSchema(db);
  const after = await snapshot();
  for (const [table, rows] of Object.entries(before))
    if (table !== "schema_baseline") expect(after[table]).toEqual(rows);
  expect(await readBookPayloadRaw(db, prepared.marker, owner)).toBe(raw);
});
