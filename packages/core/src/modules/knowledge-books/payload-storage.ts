import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import type { DB, Schema } from "@db/index.js";
import { databaseRuntimeScope } from "@db/runtime-scope.js";
import { databaseDriver, transact } from "@db/transactions.js";
import type { HistoryFileStore } from "../history/archive.js";
import {
  bookSourceBindingSchema,
  claimOutputSchema,
  pageOutputSchema,
  acceptanceOutputSchema,
  type BookArtifact,
  type Evidence,
} from "./protocol.js";
import {
  encodeBookPayload,
  decodeBookPayload,
  decodePayloadObject,
  payloadHash,
  payloadObjectChildren,
  type PayloadKind,
} from "./payload-codec.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const markerSchema = z
  .object({
    type: z.literal("knowledge_book_payload_ref"),
    version: z.literal(1),
    bookId: z.string().uuid(),
    ownerKind: z.enum(["node", "run", "release"]),
    ownerId: z.string().uuid(),
    nodeId: z.string().max(100),
    rootSha256: hash,
    rawSha256: hash,
    rawSize: z.number().int().positive(),
  })
  .strict();
export type PayloadOwner = {
  bookId: string;
  ownerKind: "node" | "run" | "release";
  ownerId: string;
  nodeId: string;
};
type ObjectRow = Schema["knowledge_book_payload_objects"];
const objectSchema = z
  .object({
    book_id: z.string().uuid(),
    kind: z.enum(["data", "index", "root"]),
    sha256: hash,
    store_id: z.string().min(1).max(64),
    object_key: z
      .string()
      .regex(
        /^host\/knowledge-books\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.gz$/,
      ),
    stored_sha256: hash,
    size: z.coerce
      .number()
      .int()
      .positive()
      .max(32 * 1024 ** 2),
    raw_size: z.coerce
      .number()
      .int()
      .positive()
      .max(1024 ** 2),
    state: z.enum(["ready", "garbage"]),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();
const operationSchema = z
  .object({
    version: z.literal(1),
    objects: z.array(objectSchema),
    edges: z.array(
      z
        .object({
          book_id: z.string().uuid(),
          parent_kind: z.enum(["data", "index", "root"]),
          parent_sha256: hash,
          child_kind: z.enum(["data", "index", "root"]),
          child_sha256: hash,
        })
        .strict(),
    ),
  })
  .strict();
function operationDefinition(raw: string, bookId: string) {
  const definition = operationSchema.parse(JSON.parse(raw));
  for (const object of definition.objects)
    if (
      object.book_id !== bookId ||
      !object.object_key.startsWith(`host/knowledge-books/${bookId}/`) ||
      !object.object_key.endsWith(`/${object.stored_sha256}.gz`)
    )
      throw new Error("Payload operation object namespace mismatch");
  for (const edge of definition.edges)
    if (edge.book_id !== bookId)
      throw new Error("Payload operation edge namespace mismatch");
  return definition;
}
export type AccessEvidence = Pick<
  Evidence,
  "sourceId" | "sourceVersion" | "reference" | "contentRef"
>;
const evidenceReferenceSchema = z.union([
  ...bookSourceBindingSchema.options
    .filter((o) => !["manual", "content"].includes(o.shape.kind.value))
    .map((o) => (o as z.ZodObject<any>).omit({ id: true })),
  z.object({ kind: z.literal("manual") }).strict(),
  z
    .object({ kind: z.literal("content"), sourceId: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("feedback"),
      feedbackId: z.string().uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
]);
const evidenceSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceRevision: z.number().int().positive(),
    sourceVersion: z.string().min(1),
    title: z.string(),
    text: z.string(),
    contentHash: hash,
    reference: evidenceReferenceSchema,
    blockId: z.string().min(1),
    contentRef: z
      .object({
        sourceId: z.string(),
        resourceId: z.string(),
        blockId: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();
const accessSchema = z
  .object({
    version: z.literal(1),
    evidence: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          sourceVersion: z.string(),
          reference: evidenceReferenceSchema,
          contentRef: z
            .object({
              sourceId: z.string(),
              resourceId: z.string(),
              blockId: z.string(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();
const summarySchema = z
  .object({
    version: z.literal(1),
    pages: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          path: z.array(z.string()),
          paragraphCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    checks: z.array(
      z.object({ criterionId: z.string(), passed: z.boolean() }).strict(),
    ),
    claimCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    provenanceNodeCount: z.number().int().nonnegative(),
    inventory: z.array(
      z
        .object({
          id: z.string(),
          sourceId: z.string(),
          sourceRevision: z.number().int(),
          sourceVersion: z.string(),
          contentHash: z.string(),
          reference: z.record(z.string(), z.unknown()),
          contentRef: z
            .object({
              sourceId: z.string(),
              resourceId: z.string(),
              blockId: z.string(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type PayloadSummary = z.infer<typeof summarySchema>;
export function payloadMetadata(
  raw: string,
  ownerKind: PayloadOwner["ownerKind"],
) {
  const value = JSON.parse(raw) as BookArtifact;
  if (
    !value ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.pages) ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.checks) ||
    (ownerKind !== "node" &&
      (value.version !== 1 ||
        !Array.isArray(value.provenance?.nodes) ||
        !Array.isArray(value.provenance?.edges)))
  )
    throw new Error("Unknown knowledge book payload format");
  const fields =
    ownerKind === "node"
      ? ["evidence", "claims", "pages", "checks"]
      : ["version", "evidence", "claims", "pages", "checks", "provenance"];
  if (Object.keys(value).some((k) => !fields.includes(k)))
    throw new Error("Unknown knowledge book payload fields");
  for (const evidence of value.evidence) evidenceSchema.parse(evidence);
  for (const claim of value.claims)
    claimOutputSchema.parse({ claims: [claim] });
  for (const page of value.pages) pageOutputSchema.parse({ pages: [page] });
  for (const check of value.checks)
    acceptanceOutputSchema.parse({ checks: [check] });
  if (ownerKind !== "node")
    z.object({
      nodes: z.array(
        z
          .object({
            id: z.string(),
            kind: z.enum([
              "source",
              "evidence",
              "claim",
              "decision",
              "paragraph",
              "page",
              "release",
              "execution",
            ]),
            label: z.string(),
            detail: z.record(z.string(), z.unknown()),
          })
          .strict(),
      ),
      edges: z.array(
        z
          .object({
            source: z.string(),
            target: z.string(),
            relation: z.enum([
              "used",
              "supported",
              "adopted",
              "composed",
              "generated",
            ]),
          })
          .strict(),
      ),
    })
      .strict()
      .parse(value.provenance);
  // All citations must carry real permission references; absent manifests never imply public access.
  const unique = new Map<string, AccessEvidence>();
  for (const e of value.evidence) {
    const ref = {
      sourceId: e.sourceId,
      sourceVersion: e.sourceVersion,
      reference: e.reference,
      ...(e.contentRef ? { contentRef: e.contentRef } : {}),
    };
    unique.set(JSON.stringify(ref), ref);
  }
  const access = accessSchema.parse({
    version: 1,
    evidence: [...unique.values()],
  });
  const summary = summarySchema.parse({
    version: 1,
    pages: value.pages.map((p) => ({
      id: p.id,
      title: p.title,
      path: p.path,
      paragraphCount: p.paragraphs.length,
    })),
    checks: value.checks.map((c) => ({
      criterionId: c.criterionId,
      passed: c.passed,
    })),
    claimCount: value.claims.length,
    evidenceCount: value.evidence.length,
    provenanceNodeCount: value.provenance?.nodes.length ?? 0,
    inventory: value.evidence.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      sourceRevision: e.sourceRevision,
      sourceVersion: e.sourceVersion,
      contentHash: e.contentHash,
      reference: e.reference,
      ...(e.contentRef ? { contentRef: e.contentRef } : {}),
    })),
  });
  return {
    access_manifest: JSON.stringify(access),
    summary: JSON.stringify(summary),
  };
}
export function bindBookPayloadStore(db: DB, store: HistoryFileStore) {
  const scope = databaseRuntimeScope(db);
  scope.set("book-payload-store", store);
  scope.set("book-payload-cache", new Map<string, Buffer>());
  return () => {
    if (scope.get("book-payload-store") === store) {
      scope.delete("book-payload-store");
      scope.delete("book-payload-cache");
    }
  };
}
function storeFor(db: DB) {
  const s = databaseRuntimeScope(db).get("book-payload-store") as
    HistoryFileStore | undefined;
  if (!s) throw new Error("Knowledge book private object store is unavailable");
  return s;
}
/** Same per-book lock protects installation and garbage claims, including permanently removed books. */
export async function lockBookPayload(db: DB, bookId: string) {
  if (databaseDriver(db) === "postgres")
    await sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ':book-payload:' || ${bookId},0))`.execute(
      db,
    );
  else await sql`update schema_baseline set created_at=created_at`.execute(db);
}
function ownerQuery(db: DB, o: PayloadOwner) {
  return db
    .selectFrom("knowledge_book_payload_references")
    .selectAll()
    .where("book_id", "=", o.bookId)
    .where("owner_kind", "=", o.ownerKind)
    .where("owner_id", "=", o.ownerId)
    .where("node_id", "=", o.nodeId);
}
export async function bookPayloadReference(
  db: DB,
  raw: string,
  expected?: PayloadOwner,
) {
  const m = markerSchema.parse(JSON.parse(raw));
  if (
    expected &&
    (m.bookId !== expected.bookId ||
      m.ownerKind !== expected.ownerKind ||
      m.ownerId !== expected.ownerId ||
      m.nodeId !== expected.nodeId)
  )
    throw new Error("Payload owner mismatch");
  if ((m.ownerKind === "node") !== !!m.nodeId)
    throw new Error("Invalid payload node owner");
  const row = await ownerQuery(db, m).executeTakeFirstOrThrow();
  if (
    row.root_kind !== "root" ||
    row.root_sha256 !== m.rootSha256 ||
    row.raw_sha256 !== m.rawSha256 ||
    Number(row.raw_size) !== m.rawSize
  )
    throw new Error("Payload reference mismatch");
  const evidence = accessSchema.parse(JSON.parse(row.access_manifest))
    .evidence as AccessEvidence[];
  const summary = summarySchema.parse(JSON.parse(row.summary));
  return { marker: m, row, evidence, summary };
}
async function readPayloadObject(
  db: DB,
  bookId: string,
  kind: PayloadKind,
  sha256: string,
) {
  const store = storeFor(db);
  const row = objectSchema.parse(
    await db
      .selectFrom("knowledge_book_payload_objects")
      .selectAll()
      .where("book_id", "=", bookId)
      .where("kind", "=", kind)
      .where("sha256", "=", sha256)
      .where("state", "=", "ready")
      .executeTakeFirstOrThrow(),
  );
  if (
    !row.object_key.startsWith(`host/knowledge-books/${bookId}/`) ||
    !row.object_key.endsWith(`/${row.stored_sha256}.gz`)
  )
    throw new Error("Payload object namespace mismatch");
  const cache = databaseRuntimeScope(db).get("book-payload-cache") as
    Map<string, Buffer> | undefined;
  const cacheKey = JSON.stringify([
    bookId,
    row.store_id,
    row.object_key,
    row.size,
    row.stored_sha256,
  ]);
  const bytes =
    cache?.get(cacheKey) ??
    Buffer.from(
      await store.read(
        row.store_id,
        row.object_key,
        row.size,
        row.stored_sha256,
      ),
    );
  if (bytes.length !== row.size)
    throw new Error("Payload stored size mismatch");
  const data = decodePayloadObject(
    bytes,
    row.raw_size,
    row.sha256,
    row.stored_sha256,
  );
  if (cache) {
    cache.delete(cacheKey);
    cache.set(cacheKey, Buffer.from(bytes));
    let size = [...cache.values()].reduce((n, b) => n + b.length, 0);
    while (size > 32 * 1024 ** 2 && cache.size) {
      const oldest = cache.keys().next().value!;
      size -= cache.get(oldest)!.length;
      cache.delete(oldest);
    }
  }
  const children = payloadObjectChildren(kind, data);
  const edges = await db
    .selectFrom("knowledge_book_payload_edges")
    .select(["child_kind", "child_sha256"])
    .where("book_id", "=", bookId)
    .where("parent_kind", "=", kind)
    .where("parent_sha256", "=", sha256)
    .execute();
  const actual = edges.map((e) => `${e.child_kind}:${e.child_sha256}`).sort();
  const expected = [
    ...new Set(children.map((c) => `${c.kind}:${c.sha256}`)),
  ].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      "Payload dependency edges do not match the immutable manifest",
    );
  return { data, children };
}
export async function readBookPayloadRaw(
  db: DB,
  raw: string,
  expected?: PayloadOwner,
) {
  const { marker: m } = await bookPayloadReference(db, raw, expected);
  const loaded = new Map<string, Buffer>();
  return decodeBookPayload(
    m.rootSha256,
    m.rawSha256,
    m.rawSize,
    async (kind, sha256) => {
      const key = `${kind}:${sha256}`;
      if (loaded.has(key)) return loaded.get(key)!;
      const { data } = await readPayloadObject(db, m.bookId, kind, sha256);
      loaded.set(key, data);
      return data;
    },
  );
}
export async function readBookPayload<T = BookArtifact>(
  db: DB,
  raw: string,
  expected?: PayloadOwner,
): Promise<T> {
  const text = await readBookPayloadRaw(db, raw, expected);
  const ref = await bookPayloadReference(db, raw, expected),
    metadata = payloadMetadata(text, ref.marker.ownerKind);
  if (
    metadata.access_manifest !== ref.row.access_manifest ||
    metadata.summary !== ref.row.summary
  )
    throw new Error("Payload metadata does not match reconstructed content");
  return JSON.parse(text);
}
export type PreparedPayload = {
  operationId: string;
  lease: string;
  owner: PayloadOwner;
  marker: string;
  metadata: ReturnType<typeof payloadMetadata>;
};
export async function prepareBookPayload(
  db: DB,
  owner: PayloadOwner,
  raw: string,
): Promise<PreparedPayload> {
  if (db.isTransaction)
    throw new Error("Payload uploads must happen outside SQL transactions");
  const metadata = payloadMetadata(raw, owner.ownerKind),
    encoded = encodeBookPayload(raw),
    store = storeFor(db),
    operationId = randomUUID(),
    lease = randomUUID(),
    now = new Date().toISOString();
  const existing = await db
    .selectFrom("knowledge_book_payload_objects")
    .selectAll()
    .where("book_id", "=", owner.bookId)
    .where("state", "=", "ready")
    .execute();
  const byHash = new Map(existing.map((o) => [`${o.kind}:${o.sha256}`, o]));
  const objects = encoded.objects.map(
    (o) =>
      byHash.get(`${o.kind}:${o.sha256}`) ?? {
        book_id: owner.bookId,
        kind: o.kind,
        sha256: o.sha256,
        store_id: store.currentId,
        object_key: `host/knowledge-books/${owner.bookId}/${operationId}/${o.storedSha256}.gz`,
        stored_sha256: o.storedSha256,
        size: o.bytes.length,
        raw_size: o.rawSize,
        state: "ready" as const,
        created_at: now,
        updated_at: now,
      },
  );
  const edges = encoded.objects.flatMap((o) =>
    o.children.map((c) => ({
      book_id: owner.bookId,
      parent_kind: o.kind,
      parent_sha256: o.sha256,
      child_kind: c.kind,
      child_sha256: c.sha256,
    })),
  );
  const definition = JSON.stringify(
    operationSchema.parse({ version: 1, objects, edges }),
  );
  await transact(db, async (tx) => {
    await lockBookPayload(tx, owner.bookId);
    await tx
      .selectFrom("knowledge_books")
      .select("id")
      .where("id", "=", owner.bookId)
      .executeTakeFirstOrThrow();
    // Refuse to reserve objects already claimed by GC; recomputation can retry after deletion.
    for (const o of objects)
      if (byHash.has(`${o.kind}:${o.sha256}`)) {
        const live = await tx
          .selectFrom("knowledge_book_payload_objects")
          .select("state")
          .where("book_id", "=", o.book_id)
          .where("kind", "=", o.kind)
          .where("sha256", "=", o.sha256)
          .executeTakeFirst();
        if (live?.state !== "ready")
          throw new Error("Payload object was claimed by cleanup; retry");
      }
    await tx
      .insertInto("knowledge_book_payload_operations")
      .values({
        id: operationId,
        book_id: owner.bookId,
        owner_kind: owner.ownerKind,
        owner_id: owner.ownerId,
        node_id: owner.nodeId,
        expected_sha256: encoded.rawSha256,
        definition,
        lease_id: lease,
        lease_until: new Date(Date.now() + 300_000).toISOString(),
        state: "uploading",
        created_at: now,
        updated_at: now,
      })
      .execute();
  });
  const renew = setInterval(() => {
    void db
      .updateTable("knowledge_book_payload_operations")
      .set({ lease_until: new Date(Date.now() + 300_000).toISOString() })
      .where("id", "=", operationId)
      .where("lease_id", "=", lease)
      .where("state", "=", "uploading")
      .execute()
      .catch(() => {});
  }, 30_000);
  renew.unref();
  try {
    for (const row of objects) {
      const encodedObject = encoded.objects.find(
        (o) => o.kind === row.kind && o.sha256 === row.sha256,
      )!;
      if (!byHash.has(`${row.kind}:${row.sha256}`)) {
        const saved = await store.putImmutable(
          row.object_key,
          encodedObject.bytes,
          "application/gzip",
        );
        if (
          saved.storeId !== row.store_id ||
          saved.key !== row.object_key ||
          saved.size !== row.size ||
          saved.sha256 !== row.stored_sha256
        )
          throw new Error("Payload upload mismatch");
      }
      const check = await store.read(
        row.store_id,
        row.object_key,
        Number(row.size),
        row.stored_sha256,
      );
      if (check.length !== Number(row.size))
        throw new Error("Payload readback size mismatch");
      decodePayloadObject(
        check,
        Number(row.raw_size),
        row.sha256,
        row.stored_sha256,
      );
    }
    const restored = await decodeBookPayload(
      encoded.rootSha256,
      encoded.rawSha256,
      encoded.rawSize,
      async (kind, sha256) => {
        const o = encoded.objects.find(
          (o) => o.kind === kind && o.sha256 === sha256,
        )!;
        return decodePayloadObject(
          o.bytes,
          o.rawSize,
          o.sha256,
          o.storedSha256,
        );
      },
    );
    if (restored !== raw) throw new Error("Payload byte exact readback failed");
    const live = await db
      .selectFrom("knowledge_book_payload_operations")
      .selectAll()
      .where("id", "=", operationId)
      .executeTakeFirstOrThrow();
    if (
      live.state !== "uploading" ||
      Date.parse(live.lease_until) <= Date.now()
    )
      throw new Error("Payload upload lease expired");
    return {
      operationId,
      lease,
      owner,
      metadata,
      marker: JSON.stringify({
        type: "knowledge_book_payload_ref",
        version: 1,
        ...owner,
        rootSha256: encoded.rootSha256,
        rawSha256: encoded.rawSha256,
        rawSize: encoded.rawSize,
      }),
    };
  } catch (e) {
    await abandonBookPayload(db, operationId);
    throw e;
  } finally {
    clearInterval(renew);
  }
}
export async function abandonBookPayload(db: DB, id: string) {
  await db
    .updateTable("knowledge_book_payload_operations")
    .set({ state: "garbage", updated_at: new Date().toISOString() })
    .where("id", "=", id)
    .where("state", "!=", "committed")
    .execute();
}
/** Call in the transaction that also writes the owner fact, after checking its current worker lease. */
export async function installBookPayload(
  db: DB,
  p: PreparedPayload,
  owner: PayloadOwner = p.owner,
) {
  if (!db.isTransaction)
    throw new Error("Payload installation requires owner transaction");
  await lockBookPayload(db, owner.bookId);
  if (owner.bookId !== p.owner.bookId)
    throw new Error("Cross-book payload installation");
  const op = await db
    .selectFrom("knowledge_book_payload_operations")
    .selectAll()
    .where("id", "=", p.operationId)
    .executeTakeFirstOrThrow();
  if (
    !["uploading", "committed"].includes(op.state) ||
    op.lease_id !== p.lease ||
    (op.state === "uploading" && Date.parse(op.lease_until) <= Date.now())
  )
    throw new Error("Payload installation lease expired");
  await db
    .selectFrom("knowledge_books")
    .select("id")
    .where("id", "=", owner.bookId)
    .executeTakeFirstOrThrow();
  const checkedMarker = markerSchema.parse(JSON.parse(p.marker));
  if (
    op.book_id !== owner.bookId ||
    op.expected_sha256 !== checkedMarker.rawSha256
  )
    throw new Error("Payload operation reference mismatch");
  const def = operationDefinition(op.definition, op.book_id);
  for (const o of def.objects) {
    await db
      .insertInto("knowledge_book_payload_objects")
      .values(o)
      .onConflict((c) => c.columns(["book_id", "kind", "sha256"]).doNothing())
      .execute();
    const live = await db
      .selectFrom("knowledge_book_payload_objects")
      .select("state")
      .where("book_id", "=", o.book_id)
      .where("kind", "=", o.kind)
      .where("sha256", "=", o.sha256)
      .executeTakeFirstOrThrow();
    if (live.state !== "ready") throw new Error("Payload cleanup owns object");
  }
  for (const edge of def.edges)
    await db
      .insertInto("knowledge_book_payload_edges")
      .values(edge)
      .onConflict((c) =>
        c
          .columns([
            "book_id",
            "parent_kind",
            "parent_sha256",
            "child_kind",
            "child_sha256",
          ])
          .doNothing(),
      )
      .execute();
  const marker = markerSchema.parse(JSON.parse(p.marker));
  const now = new Date().toISOString();
  const ref = {
    book_id: owner.bookId,
    owner_kind: owner.ownerKind,
    owner_id: owner.ownerId,
    node_id: owner.nodeId,
    root_kind: "root" as const,
    root_sha256: marker.rootSha256,
    raw_sha256: marker.rawSha256,
    raw_size: marker.rawSize,
    ...p.metadata,
    created_at: now,
    updated_at: now,
  };
  await db
    .insertInto("knowledge_book_payload_references")
    .values(ref)
    .onConflict((c) =>
      c
        .columns(["book_id", "owner_kind", "owner_id", "node_id"])
        .doUpdateSet({ ...ref }),
    )
    .execute();
  const unused: ObjectRow[] = [];
  for (const object of def.objects) {
    const canonical = await db
      .selectFrom("knowledge_book_payload_objects")
      .select(["store_id", "object_key"])
      .where("book_id", "=", object.book_id)
      .where("kind", "=", object.kind)
      .where("sha256", "=", object.sha256)
      .executeTakeFirstOrThrow();
    if (
      canonical.store_id !== object.store_id ||
      canonical.object_key !== object.object_key
    )
      unused.push(object);
  }
  // Installed dependencies are durable in objects/edges. Retain only losing physical uploads in the completed journal.
  await db
    .updateTable("knowledge_book_payload_operations")
    .set({
      state: "committed",
      definition: JSON.stringify({ version: 1, objects: unused, edges: [] }),
      updated_at: now,
    })
    .where("id", "=", p.operationId)
    .execute();
  return JSON.stringify({ ...marker, ...owner });
}
export async function copyBookPayloadReference(
  db: DB,
  raw: string,
  owner: PayloadOwner,
) {
  const { marker, row } = await bookPayloadReference(db, raw);
  if (marker.bookId !== owner.bookId)
    throw new Error("Cannot share payload across books");
  await lockBookPayload(db, owner.bookId);
  await db
    .insertInto("knowledge_book_payload_references")
    .values({
      ...row,
      owner_kind: owner.ownerKind,
      owner_id: owner.ownerId,
      node_id: owner.nodeId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .execute();
  return JSON.stringify({ ...marker, ...owner });
}
/** Durable journals also retain losing concurrent uploads and objects uploaded after a purge. */
export async function cleanupBookPayloads(db: DB, now = Date.now()) {
  const store = storeFor(db),
    ids = await db
      .selectFrom("knowledge_book_payload_objects")
      .select("book_id")
      .union(
        db.selectFrom("knowledge_book_payload_operations").select("book_id"),
      )
      .execute();
  let removed = 0;
  for (const { book_id: bookId } of ids) {
    const rootSnapshot = await db
      .selectFrom("knowledge_book_payload_references")
      .select("root_sha256")
      .where("book_id", "=", bookId)
      .execute();
    const rootSignature = (roots: Array<{ root_sha256: string }>) =>
      JSON.stringify([...new Set(roots.map((r) => r.root_sha256))].sort());
    const checked = new Set<string>();
    async function verifyManifest(
      kind: PayloadKind,
      sha256: string,
      depth = 0,
    ): Promise<void> {
      if (depth > 16)
        throw new Error("Payload cleanup dependency depth exceeds limit");
      const key = `${kind}:${sha256}`;
      if (checked.has(key)) return;
      checked.add(key);
      const { children } = await readPayloadObject(db, bookId, kind, sha256);
      for (const child of children)
        if (child.kind === "index")
          await verifyManifest(child.kind, child.sha256, depth + 1);
    }
    // Check only manifests, never download body chunks to decide reachability. Corruption prevents all deletion in this book.
    for (const root of rootSnapshot)
      await verifyManifest("root", root.root_sha256);
    const garbage = await transact(db, async (tx) => {
      await lockBookPayload(tx, bookId);
      await tx
        .updateTable("knowledge_book_payload_operations")
        .set({ state: "garbage" })
        .where("book_id", "=", bookId)
        .where("state", "=", "uploading")
        .where("lease_until", "<=", new Date(now).toISOString())
        .execute();
      const ops = await tx
        .selectFrom("knowledge_book_payload_operations")
        .selectAll()
        .where("book_id", "=", bookId)
        .execute();
      const objects = await tx
        .selectFrom("knowledge_book_payload_objects")
        .selectAll()
        .where("book_id", "=", bookId)
        .execute();
      const roots = await tx
        .selectFrom("knowledge_book_payload_references")
        .select("root_sha256")
        .where("book_id", "=", bookId)
        .execute();
      if (rootSignature(roots) !== rootSignature(rootSnapshot)) return [];
      const edges = await tx
        .selectFrom("knowledge_book_payload_edges")
        .selectAll()
        .where("book_id", "=", bookId)
        .execute();
      const protectedLogical = new Set(
          roots.map((r) => "root:" + r.root_sha256),
        ),
        protectedPhysical = new Set<string>();
      for (const op of ops.filter((o) => o.state === "uploading"))
        for (const o of operationDefinition(op.definition, op.book_id)
          .objects) {
          protectedLogical.add(`${o.kind}:${o.sha256}`);
          protectedPhysical.add(`${o.store_id}:${o.object_key}`);
        }
      for (let changed = true; changed;) {
        changed = false;
        for (const e of edges)
          if (
            protectedLogical.has(`${e.parent_kind}:${e.parent_sha256}`) &&
            !protectedLogical.has(`${e.child_kind}:${e.child_sha256}`)
          ) {
            protectedLogical.add(`${e.child_kind}:${e.child_sha256}`);
            changed = true;
          }
      }
      const garbage = new Map<
        string,
        { store_id: string; object_key: string }
      >();
      for (const o of objects)
        if (protectedLogical.has(`${o.kind}:${o.sha256}`))
          protectedPhysical.add(`${o.store_id}:${o.object_key}`);
        else {
          await tx
            .updateTable("knowledge_book_payload_objects")
            .set({ state: "garbage" })
            .where("book_id", "=", bookId)
            .where("kind", "=", o.kind)
            .where("sha256", "=", o.sha256)
            .execute();
          garbage.set(`${o.store_id}:${o.object_key}`, o);
        }
      for (const op of ops.filter((o) => o.state !== "uploading"))
        for (const o of operationDefinition(op.definition, op.book_id).objects)
          if (!protectedPhysical.has(`${o.store_id}:${o.object_key}`))
            garbage.set(`${o.store_id}:${o.object_key}`, o);
      return [...garbage.values()];
    });
    for (const o of garbage) {
      try {
        await store.remove(o.store_id, o.object_key);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await transact(db, async (tx) => {
        await lockBookPayload(tx, bookId);
        await tx
          .deleteFrom("knowledge_book_payload_objects")
          .where("book_id", "=", bookId)
          .where("store_id", "=", o.store_id)
          .where("object_key", "=", o.object_key)
          .where("state", "=", "garbage")
          .execute();
      });
      removed++;
    }
    // Keep journal keys for idempotent rechecking: a killed process may finish an external upload later.
    await db
      .updateTable("knowledge_book_payload_operations")
      .set({ state: "deleted" })
      .where("book_id", "=", bookId)
      .where("state", "=", "garbage")
      .execute();
  }
  return removed;
}
