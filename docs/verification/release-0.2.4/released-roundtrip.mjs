import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const appRoot = process.env.DOCA_CHECKPOINT_APP_ROOT || "/app";
const qaRoot = process.env.DOCA_CHECKPOINT_FIXTURE_ROOT || "/qa";
const load = (relative) => import(path.join(appRoot, relative));
const { openDatabase } = await load("packages/db/src/connection.ts");
const { transact } = await load("packages/db/src/transactions.ts");
const {
  prepareBookPayload,
  installBookPayload,
  readBookPayloadRaw,
  bindBookPayloadStore,
} = await load("packages/core/src/modules/knowledge-books/payload-storage.ts");
const { storageRuntime } = await load("apps/server/src/adapters/storage.ts");
const { createHostFileStore } = await load(
  "apps/server/src/services/host-file-store.ts",
);
const config = process.env.DOCA_CHECKPOINT_DATABASE_URL
  ? { driver: "postgres", url: process.env.DOCA_CHECKPOINT_DATABASE_URL }
  : { driver: "sqlite", path: path.join(qaRoot, "released.db") };
process.env.DOCA_FILE_STORE_ID = "checkpoint-released-qa";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: {
    "checkpoint-released-qa": {
      provider: "local",
      root: path.join(qaRoot, "objects"),
    },
  },
});
const db = await openDatabase(config);
bindBookPayloadStore(db, createHostFileStore(storageRuntime()));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const tables = [
  "users",
  "resources",
  "knowledge_books",
  "knowledge_book_configurations",
  "knowledge_book_sources",
  "knowledge_book_source_versions",
  "knowledge_book_runs",
  "knowledge_book_node_runs",
  "knowledge_book_releases",
  "knowledge_book_payload_objects",
  "knowledge_book_payload_edges",
  "knowledge_book_payload_references",
  "knowledge_book_payload_operations",
];
async function snapshot() {
  const result = {};
  for (const table of tables) {
    const rows = await db.selectFrom(table).selectAll().execute();
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    result[table] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}
try {
  if (process.env.DOCA_CHECKPOINT_MODE === "seed") {
    assert.equal(
      (await db.introspection.getTables()).some(
        (t) => t.name === "knowledge_book_batch_checkpoints",
      ),
      false,
      "must use released code without checkpoint DDL",
    );
    const { createUser } = await load(
      "packages/core/src/modules/identity/passwords.ts",
    );
    const { createKnowledgeBook, saveBookConfiguration, queueBookRun } =
      await load("packages/core/src/modules/knowledge-books/management.ts");
    const { executeBookCommand } = await load(
      "packages/core/src/modules/knowledge-books/commands.ts",
    );
    const { defaultBookConfiguration } = await load(
      "packages/core/src/modules/knowledge-books/protocol.ts",
    );
    const actor = {
      ...(await createUser(
        db,
        {
          login: "released-checkpoint-qa",
          displayName: "Retained owner",
          password: "isolated-release-book-password",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
    const bookId = (
      await createKnowledgeBook(db, actor, "Released book — 保留原始数据")
    ).id;
    const configuration = defaultBookConfiguration();
    configuration.goal = "Retain the released source, node and publication";
    await saveBookConfiguration(db, actor, bookId, 1, configuration);
    await executeBookCommand(db, actor, bookId, {
      operation: "source.save",
      expectedRevision: 0,
      title: "Retained manual source",
      status: "active",
      configuration: {
        version: 1,
        items: [
          {
            id: "original",
            kind: "manual",
            markdown: "Original source retained.",
          },
        ],
      },
    });
    const runId = (await queueBookRun(db, actor, bookId)).id,
      releaseId = randomUUID(),
      now = new Date().toISOString();
    const { readBookSource } = await load(
      "packages/core/src/modules/knowledge-books/sources.ts",
    );
    const source = await db
      .selectFrom("knowledge_book_sources")
      .selectAll()
      .where("book_id", "=", bookId)
      .executeTakeFirstOrThrow();
    const evidence = await readBookSource(db, source, {
      readFile() {
        throw new Error("unexpected file");
      },
      readWeb() {
        throw new Error("unexpected web");
      },
    });
    const claims = [
      {
        id: "original-claim",
        statement: "Original source retained.",
        evidenceIds: [evidence[0].id],
        evidenceQuotes: [
          { evidenceId: evidence[0].id, quote: evidence[0].text },
        ],
        reason: "Exact retained source",
        confidence: 1,
      },
    ];
    const node = {
      evidence,
      claims,
      pages: [
        {
          id: "original-page",
          title: "Retained chapter",
          path: ["Original"],
          paragraphs: [
            {
              id: "original-paragraph",
              markdown: "## 原始章节\n\nRetained original body and formatting.",
              claimIds: ["original-claim"],
              reason: "Synthetic released-version fixture",
            },
          ],
        },
      ],
      checks: [
        {
          criterionId: "grounded",
          passed: true,
          reason: "Synthetic fixture verdict retained verbatim",
        },
      ],
    };
    const artifact = {
      version: 1,
      ...node,
      provenance: { nodes: [], edges: [] },
    };
    const preparedNode = await prepareBookPayload(
      db,
      { bookId, ownerKind: "node", ownerId: runId, nodeId: "synthesize" },
      JSON.stringify(node),
    );
    const preparedArtifact = await prepareBookPayload(
      db,
      { bookId, ownerKind: "run", ownerId: runId, nodeId: "" },
      JSON.stringify(artifact),
    );
    await transact(db, async (tx) => {
      const nodeMarker = await installBookPayload(tx, preparedNode);
      const runMarker = await installBookPayload(tx, preparedArtifact);
      const releaseMarker = await installBookPayload(tx, preparedArtifact, {
        bookId,
        ownerKind: "release",
        ownerId: releaseId,
        nodeId: "",
      });
      await tx
        .insertInto("knowledge_book_node_runs")
        .values({
          run_id: runId,
          node_id: "synthesize",
          type: "synthesize",
          status: "completed",
          input_refs: '["extract"]',
          output: nodeMarker,
          error: "",
          started_at: now,
          completed_at: now,
        })
        .execute();
      await tx
        .updateTable("knowledge_book_runs")
        .set({
          status: "published",
          artifact: runMarker,
          started_at: now,
          updated_at: now,
        })
        .where("id", "=", runId)
        .execute();
      await tx
        .insertInto("knowledge_book_releases")
        .values({
          id: releaseId,
          book_id: bookId,
          run_id: runId,
          revision: 1,
          artifact: releaseMarker,
          created_at: now,
        })
        .execute();
      await tx
        .updateTable("knowledge_books")
        .set({ published_release_id: releaseId })
        .where("id", "=", bookId)
        .execute();
    });
    const original = {
      bookId,
      runId,
      releaseId,
      tables: await snapshot(),
      baseline: (
        await db
          .selectFrom("schema_baseline")
          .select("id")
          .executeTakeFirstOrThrow()
      ).id,
      nodeRawSha: hash(JSON.stringify(node)),
      artifactRawSha: hash(JSON.stringify(artifact)),
    };
    await mkdir(qaRoot, { recursive: true });
    await writeFile(
      path.join(qaRoot, "original.json"),
      JSON.stringify(original, null, 2),
    );
    console.log(
      JSON.stringify({
        mode: "seed",
        driver: config.driver,
        bookId,
        hasCheckpointTable: false,
      }),
    );
  } else {
    const original = JSON.parse(
      await readFile(path.join(qaRoot, "original.json"), "utf8"),
    );
    assert.deepEqual(await snapshot(), original.tables);
    assert.equal(
      (
        await db
          .selectFrom("schema_baseline")
          .select("id")
          .executeTakeFirstOrThrow()
      ).id,
      original.baseline,
    );
    assert.deepEqual(
      await db
        .selectFrom("knowledge_book_batch_checkpoints")
        .selectAll()
        .execute(),
      [],
    );
    const node = await db
      .selectFrom("knowledge_book_node_runs")
      .select("output")
      .where("run_id", "=", original.runId)
      .executeTakeFirstOrThrow();
    const run = await db
      .selectFrom("knowledge_book_runs")
      .select("artifact")
      .where("id", "=", original.runId)
      .executeTakeFirstOrThrow();
    const release = await db
      .selectFrom("knowledge_book_releases")
      .select("artifact")
      .where("id", "=", original.releaseId)
      .executeTakeFirstOrThrow();
    assert.equal(
      hash(await readBookPayloadRaw(db, node.output)),
      original.nodeRawSha,
    );
    assert.equal(
      hash(await readBookPayloadRaw(db, run.artifact)),
      original.artifactRawSha,
    );
    assert.equal(
      hash(await readBookPayloadRaw(db, release.artifact)),
      original.artifactRawSha,
    );
    console.log(
      JSON.stringify({
        mode: "verify",
        driver: config.driver,
        tablesPreserved: Object.keys(original.tables).length,
        oldBodyByteExact: true,
        checkpointRows: 0,
        baselineUnchanged: true,
      }),
    );
  }
} finally {
  await db.destroy();
}
