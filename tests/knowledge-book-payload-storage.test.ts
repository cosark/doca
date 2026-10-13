import { executeBookCommand } from "@core/modules/knowledge-books/commands.js";
import { defaultBookConfiguration } from "@core/modules/knowledge-books/protocol.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { openTestDatabase } from "./database.js";
import { testBookPayloadStore } from "./book-payload-store.js";
import type { DB } from "@db/index.js";
import { transact } from "@db/transactions.js";
import { createSchema } from "@db/create-schema.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import {
  createKnowledgeBook,
  queueBookRun,
  saveBookConfiguration,
} from "@core/modules/knowledge-books/management.js";
import {
  encodeBookPayload,
  decodeBookPayload,
  decodePayloadObject,
  payloadHash,
} from "@core/modules/knowledge-books/payload-codec.js";
import {
  prepareBookPayload,
  installBookPayload,
  readBookPayloadRaw,
  cleanupBookPayloads,
  bindBookPayloadStore,
  bookPayloadReference,
} from "@core/modules/knowledge-books/payload-storage.js";
import {
  convertBookStorage,
  bookPayloadRecords,
} from "@server/services/knowledge-book-storage-maintenance.js";
import {
  BOOK_PAYLOAD_UPGRADE,
  BOOK_PAYLOAD_BASELINE,
  bookPayloadTables,
} from "@db/book-payload-schema.js";
import { HISTORY_SCHEMA_BASELINE } from "@db/history-schema.js";
import { readBookRunSummary } from "@core/modules/knowledge-books/reads.js";
let db: DB,
  actor: Actor,
  bookId: string,
  runId: string,
  dir: string,
  store: ReturnType<typeof testBookPayloadStore>;
const payload = () =>
  JSON.stringify({
    evidence: [],
    claims: [],
    pages: [
      {
        id: "page",
        title: "Detail",
        path: [],
        paragraphs: [
          {
            id: "paragraph",
            markdown:
              "正文与流程图：\\n```mermaid\\ngraph LR; A-->B;\\n```\\n".repeat(
                150,
              ),
            claimIds: ["claim"],
            reason: "完整",
          },
        ],
      },
    ],
    checks: [],
  });
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  store = testBookPayloadStore(db);
  actor = {
    ...(await createUser(
      db,
      { login: "book-storage", displayName: "Test", password: randomUUID() },
      { bootstrap: true },
    )),
    admin: 1,
  };
  bookId = (await createKnowledgeBook(db, actor, "Storage")).id;
  const config = defaultBookConfiguration();
  config.goal = "Verify storage";
  await saveBookConfiguration(db, actor, bookId, 1, config);
  await executeBookCommand(db, actor, bookId, {
    operation: "source.save",
    expectedRevision: 0,
    title: "Manual",
    status: "active",
    configuration: {
      version: 1,
      items: [
        { id: "manual", kind: "manual", markdown: "Synthetic reference" },
      ],
    },
  });
  runId = (await queueBookRun(db, actor, bookId)).id;
  dir = await mkdtemp(join(tmpdir(), "doca-book-payload-"));
});
afterEach(async () => {
  await db.destroy();
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function node(id: string, raw = payload()) {
  const owner = {
    bookId,
    ownerKind: "node" as const,
    ownerId: runId,
    nodeId: id,
  };
  const p = await prepareBookPayload(db, owner, raw);
  await transact(db, async (tx) => {
    const output = await installBookPayload(tx, p);
    await tx
      .insertInto("knowledge_book_node_runs")
      .values({
        run_id: runId,
        node_id: id,
        type: "organize",
        status: "completed",
        input_refs: "[]",
        output,
        error: "",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .execute();
  });
  return p;
}
it("preserves exact escaped UTF-8 bytes and bounds physical objects for huge strings and manifests", async () => {
  const raw =
    ' { "a" : ' +
    JSON.stringify('汉字😀\\\"\n'.repeat(240_000)) +
    ', "b": ' +
    JSON.stringify("duplicate".repeat(1000)) +
    " }\n";
  const encoded = encodeBookPayload(raw);
  const result = await decodeBookPayload(
    encoded.rootSha256,
    encoded.rawSha256,
    encoded.rawSize,
    async (kind, hash) => {
      const o = encoded.objects.find(
        (o) => o.kind === kind && o.sha256 === hash,
      )!;
      expect(o.rawSize).toBeLessThanOrEqual(1024 ** 2);
      return decodePayloadObject(o.bytes, o.rawSize, o.sha256, o.storedSha256);
    },
  );
  expect(result).toBe(raw);
  expect(payloadHash(result)).toBe(payloadHash(raw));
});
it("shares nodes within one book, removes losing concurrent uploads, and preserves reachable objects", async () => {
  const raw = payload();
  const owners = ["a", "b"].map((nodeId) => ({
    bookId,
    ownerKind: "node" as const,
    ownerId: runId,
    nodeId,
  }));
  const [a, b] = await Promise.all(
    owners.map((o) => prepareBookPayload(db, o, raw)),
  );
  for (const p of [a!, b!])
    await transact(db, async (tx) => {
      await installBookPayload(tx, p);
    });
  expect(a!.marker.replace('"a"', '"b"')).toBe(b!.marker);
  const before = store.objects.size;
  const objects = await db
    .selectFrom("knowledge_book_payload_objects")
    .selectAll()
    .execute();
  expect(before).toBe(objects.length * 2);
  await cleanupBookPayloads(db);
  expect(store.objects.size).toBe(objects.length);
  expect(await readBookPayloadRaw(db, a!.marker)).toBe(raw);
  expect(await readBookPayloadRaw(db, b!.marker)).toBe(raw);
});
it("keeps identical cross-book content isolated and rejects a borrowed owner marker", async () => {
  const a = await node("a"),
    second = (await createKnowledgeBook(db, actor, "Other")).id;
  const b = await prepareBookPayload(
    db,
    { bookId: second, ownerKind: "node", ownerId: randomUUID(), nodeId: "a" },
    payload(),
  );
  await transact(db, (tx) => installBookPayload(tx, b));
  const objects = await db
    .selectFrom("knowledge_book_payload_objects")
    .selectAll()
    .execute();
  expect(new Set(objects.map((o) => o.book_id)).size).toBe(2);
  await expect(
    readBookPayloadRaw(db, a.marker, {
      bookId: second,
      ownerKind: "node",
      ownerId: runId,
      nodeId: "a",
    }),
  ).rejects.toThrow("owner mismatch");
});
it("uses SQL-only summaries and refuses unknown metadata or corrupt objects without altering references", async () => {
  const p = await node("organize"),
    before = store.reads;
  const summary = await readBookRunSummary(db, actor, bookId, runId);
  expect(summary.nodes[0]!.output.pages[0].paragraphCount).toBe(1);
  expect(store.reads).toBe(before);
  const obj = (
    await db
      .selectFrom("knowledge_book_payload_objects")
      .selectAll()
      .where("kind", "=", "data")
      .execute()
  )[0]!;
  store.objects.set(obj.object_key, new Uint8Array([1]));
  await expect(readBookPayloadRaw(db, p.marker)).rejects.toThrow();
  expect(
    await db
      .selectFrom("knowledge_book_payload_references")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
  await db
    .updateTable("knowledge_book_payload_references")
    .set({ access_manifest: '{"version":9,"evidence":[]}' })
    .execute();
  await expect(bookPayloadReference(db, p.marker)).rejects.toThrow();
});
it("protects live upload dependencies and cleans a late upload after permanent deletion", async () => {
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    }),
    objects = new Map<string, Uint8Array>();
  let first = true;
  bindBookPayloadStore(db, {
    currentId: "late",
    async putImmutable(key, bytes) {
      if (first) {
        first = false;
        await blocked;
      }
      objects.set(key, bytes);
      return {
        storeId: "late",
        key,
        size: bytes.length,
        sha256: payloadHash(bytes),
      };
    },
    async read(_s, key) {
      return objects.get(key)!;
    },
    async remove(_s, key) {
      objects.delete(key);
    },
  });
  const pending = prepareBookPayload(
    db,
    { bookId, ownerKind: "node", ownerId: runId, nodeId: "late" },
    payload(),
  );
  while (
    !(await db
      .selectFrom("knowledge_book_payload_operations")
      .select("id")
      .executeTakeFirst())
  )
    await new Promise((r) => setTimeout(r, 1));
  await cleanupBookPayloads(db);
  expect(objects.size).toBe(0);
  await db.deleteFrom("knowledge_books").where("id", "=", bookId).execute();
  await db
    .updateTable("knowledge_book_payload_operations")
    .set({ lease_until: "2000-01-01T00:00:00.000Z" })
    .execute();
  await cleanupBookPayloads(db);
  unblock();
  await expect(pending).rejects.toThrow("lease expired");
  expect(objects.size).toBeGreaterThan(0);
  await cleanupBookPayloads(db);
  expect(objects.size).toBe(0);
  expect(
    await db
      .selectFrom("knowledge_book_payload_operations")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});
async function inlineGeneration() {
  for (const name of [...bookPayloadTables].reverse())
    await sql.raw(`drop table ${name}`).execute(db);
  const row = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .executeTakeFirstOrThrow();
  const footprint = JSON.parse(row.structure_json!);
  for (const name of bookPayloadTables) delete footprint[name];
  await db
    .updateTable("schema_baseline")
    .set({
      id: HISTORY_SCHEMA_BASELINE,
      structure_json: JSON.stringify(footprint),
    })
    .execute();
}
async function inlineNode() {
  await db
    .insertInto("knowledge_book_node_runs")
    .values({
      run_id: runId,
      node_id: "organize",
      type: "organize",
      status: "completed",
      input_refs: "[]",
      output: payload(),
      error: "",
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .execute();
}
it("preflights without writes, upgrades exact bytes, survives restart, and rolls back newer writes too", async () => {
  await inlineNode();
  await inlineGeneration();
  const before = await bookPayloadRecords(db);
  await expect(createSchema(db)).rejects.toThrow("explicit offline");
  const plan = await convertBookStorage(db, "upgrade");
  expect(plan.payloadCount).toBe(1);
  expect(await bookPayloadRecords(db)).toEqual(before);
  expect(
    await db.selectFrom("schema_baseline").select("id").executeTakeFirst(),
  ).toEqual({ id: HISTORY_SCHEMA_BASELINE });
  await convertBookStorage(db, "upgrade", {
    apply: true,
    hostsStopped: true,
    manifestPath: join(dir, "upgrade.json"),
  });
  await createSchema(db);
  await createSchema(db);
  const records = await bookPayloadRecords(db);
  expect(await readBookPayloadRaw(db, records[0]!.raw)).toBe(before[0]!.raw);
  await node("later", payload().replace("Detail", "New"));
  const newer = (await bookPayloadRecords(db)).map(async (r) => ({
    ...r,
    raw: await readBookPayloadRaw(db, r.raw),
  }));
  const expected = await Promise.all(newer);
  await convertBookStorage(db, "rollback", {
    apply: true,
    hostsStopped: true,
    manifestPath: join(dir, "rollback.json"),
  });
  expect(await bookPayloadRecords(db)).toEqual(expected);
  expect(
    (await db.selectFrom("schema_baseline").select("id").executeTakeFirst())!
      .id,
  ).toBe(HISTORY_SCHEMA_BASELINE);
  expect(store.objects.size).toBeGreaterThan(0);
});
it("rejects malformed or running old data without partial DDL and resumes interrupted uploads from the same manifest", async () => {
  await inlineNode();
  await inlineGeneration();
  await db
    .updateTable("knowledge_book_node_runs")
    .set({ output: '{"version":42}' })
    .execute();
  await expect(
    convertBookStorage(db, "upgrade", {
      apply: true,
      hostsStopped: true,
      manifestPath: join(dir, "bad.json"),
    }),
  ).rejects.toThrow("Unknown");
  expect(
    (await db.selectFrom("schema_baseline").select("id").executeTakeFirst())!
      .id,
  ).toBe(HISTORY_SCHEMA_BASELINE);
  await db
    .updateTable("knowledge_book_node_runs")
    .set({ output: payload() })
    .execute();
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "running" })
    .execute();
  await expect(convertBookStorage(db, "upgrade")).rejects.toThrow("Running");
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "failed" })
    .execute();
  const unbind = bindBookPayloadStore(db, {
    currentId: "offline",
    async putImmutable() {
      throw new Error("network interrupt");
    },
    async read() {
      throw new Error("offline");
    },
    async remove() {},
  });
  const options = {
    apply: true,
    hostsStopped: true,
    manifestPath: join(dir, "resume.json"),
  };
  await expect(convertBookStorage(db, "upgrade", options)).rejects.toThrow(
    "network interrupt",
  );
  expect(
    (await db.selectFrom("schema_baseline").select("id").executeTakeFirst())!
      .id,
  ).toBe(BOOK_PAYLOAD_UPGRADE);
  await expect(createSchema(db)).rejects.toThrow("Interrupted");
  unbind();
  store = testBookPayloadStore(db);
  await convertBookStorage(db, "upgrade", options);
  expect(
    (await db.selectFrom("schema_baseline").select("id").executeTakeFirst())!
      .id,
  ).toBe(BOOK_PAYLOAD_BASELINE);
});

it("rechecks source permission on a cached body and prevents any object access after revocation", async () => {
  const { createContent } = await import("@core/workflows/resources.js");
  const { readBookRun } =
    await import("@core/modules/knowledge-books/reads.js");
  const content = createContent(db),
    document = await content.create(actor, {
      kind: "document",
      format: "markdown",
      title: "Private source",
      markdown: "Protected evidence",
    });
  const reader = {
    ...(await createUser(
      db,
      { login: "book-reader", displayName: "Reader", password: randomUUID() },
      { actor },
    )),
    admin: 0,
  };
  for (const id of [bookId, document.id]) {
    const row = await db
      .selectFrom("resources")
      .select("authz_revision")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    await content.member(actor, id, reader.id, {
      revision: row.authz_revision!,
      role: "editor",
      includeDescendants: true,
    });
  }
  const state = await db
    .selectFrom("document_states")
    .select("seq")
    .where("resource_id", "=", document.id)
    .executeTakeFirstOrThrow();
  const value = JSON.parse(payload());
  value.evidence = [
    {
      id: "evidence",
      sourceId: randomUUID(),
      sourceRevision: 1,
      sourceVersion: "1:" + state.seq,
      title: "Private",
      text: "Protected evidence",
      contentHash: payloadHash("Protected evidence"),
      reference: { kind: "document", resourceId: document.id },
      blockId: "paragraph",
    },
  ];
  await node("organize", JSON.stringify(value));
  await readBookRun(db, reader, bookId, runId);
  const cachedAt = store.reads;
  await readBookRun(db, reader, bookId, runId);
  expect(store.reads).toBe(cachedAt);
  const source = await db
    .selectFrom("resources")
    .select("authz_revision")
    .where("id", "=", document.id)
    .executeTakeFirstOrThrow();
  await content.member(actor, document.id, reader.id, {
    revision: source.authz_revision!,
    role: null,
    includeDescendants: true,
  });
  const hidden = await readBookRun(db, reader, bookId, runId);
  expect(hidden.restricted).toBe(true);
  expect(hidden.nodes[0]!.output).toBeNull();
  expect(store.reads).toBe(cachedAt);
});
it("keeps trash content, retries garbage deletion failures, and reclaims only after permanent purge", async () => {
  const { createContent } = await import("@core/workflows/resources.js");
  const content = createContent(db),
    p = await node("organize");
  const row = await db
    .selectFrom("resources")
    .select("version")
    .where("id", "=", bookId)
    .executeTakeFirstOrThrow();
  await content.trash(actor, bookId, row.version);
  await cleanupBookPayloads(db);
  expect(await readBookPayloadRaw(db, p.marker)).toBe(payload());
  const removed = await db
    .selectFrom("resources")
    .select("version")
    .where("id", "=", bookId)
    .executeTakeFirstOrThrow();
  await content.purgeDeleted(actor, bookId, removed.version);
  expect(
    await db
      .selectFrom("knowledge_book_payload_references")
      .selectAll()
      .execute(),
  ).toHaveLength(0);
  expect(store.objects.size).toBeGreaterThan(0);
  let failDeletion = true;
  bindBookPayloadStore(db, {
    currentId: "test-book-store",
    async putImmutable() {
      throw new Error("No uploads during purge");
    },
    async read(_id, key, size, hash) {
      const bytes = store.objects.get(key)!;
      if (bytes.length !== size || payloadHash(bytes) !== hash)
        throw new Error("Corrupt fixture");
      return bytes;
    },
    async remove(_id, key) {
      if (failDeletion) {
        failDeletion = false;
        throw new Error("Transient deletion failure");
      }
      store.objects.delete(key);
    },
  });
  await expect(cleanupBookPayloads(db)).rejects.toThrow(
    "Transient deletion failure",
  );
  expect(store.objects.size).toBeGreaterThan(0);
  await cleanupBookPayloads(db);
  expect(store.objects.size).toBe(0);
});

it("rejects missing manifest edges and prevents cleanup from deleting reachable children", async () => {
  const p = await node("organize");
  const count = store.objects.size;
  await db
    .deleteFrom("knowledge_book_payload_edges")
    .where("parent_kind", "=", "root")
    .execute();
  await expect(readBookPayloadRaw(db, p.marker)).rejects.toThrow(
    "dependency edges",
  );
  await expect(cleanupBookPayloads(db)).rejects.toThrow("dependency edges");
  expect(store.objects.size).toBe(count);
  expect(
    await db
      .selectFrom("knowledge_book_payload_references")
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});

it("serves complete existing detail responses and SQL-only summary endpoints", async () => {
  const { default: Fastify } = await import("fastify");
  const { registerKnowledgeBooks } =
    await import("@server/routes/knowledge-books.js");
  await node("organize");
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "failed" })
    .where("id", "=", runId)
    .execute();
  const api = Fastify();
  registerKnowledgeBooks(api, db, () => actor);
  try {
    const full = await api.inject({
      method: "GET",
      url: `/api/v1/knowledge-books/${bookId}/runs/${runId}`,
    });
    expect(full.statusCode, full.body).toBe(200);
    expect(full.json().nodes[0].output.pages[0].paragraphs[0].markdown).toBe(
      JSON.parse(payload()).pages[0].paragraphs[0].markdown,
    );
    const reads = store.reads;
    const summary = await api.inject({
      method: "GET",
      url: `/api/v1/knowledge-books/${bookId}/runs/${runId}/summary`,
    });
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json().nodes[0].output.pages[0]).toMatchObject({
      paragraphCount: 1,
    });
    expect(summary.json().nodes[0].output.pages[0]).not.toHaveProperty(
      "paragraphs",
    );
    const book = await api.inject({
      method: "GET",
      url: `/api/v1/knowledge-books/${bookId}/summary`,
    });
    expect(book.statusCode, book.body).toBe(200);
    expect(book.json().runs[0].id).toBe(runId);
    expect(store.reads).toBe(reads);
  } finally {
    await api.close();
  }
});
