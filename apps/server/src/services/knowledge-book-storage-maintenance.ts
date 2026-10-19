import { currentSchemaTables } from "@db/introspection.js";
import { readFile, writeFile } from "node:fs/promises";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { DB } from "@db/index.js";
import { databaseDriver, transact } from "@db/transactions.js";
import { createCurrentStructure, schemaEvolution } from "@db/create-schema.js";
import { HISTORY_SCHEMA_BASELINE } from "@db/history-schema.js";
import {
  BOOK_PAYLOAD_BASELINE,
  BOOK_PAYLOAD_UPGRADE,
  BOOK_PAYLOAD_ROLLBACK,
  bookPayloadTables,
} from "@db/book-payload-schema.js";
import {
  inspectSchema,
  reconcileSchema,
  recordSchemaStructure,
  SchemaReviewRequired,
} from "@db/schema-reconciliation.js";
import {
  payloadMetadata,
  prepareBookPayload,
  installBookPayload,
  readBookPayloadRaw,
  bookPayloadReference,
  type PayloadOwner,
} from "@core/modules/knowledge-books/payload-storage.js";
import { payloadHash } from "@core/modules/knowledge-books/payload-codec.js";
const identity = (o: PayloadOwner) =>
  JSON.stringify([o.bookId, o.ownerKind, o.ownerId, o.nodeId]);
export async function bookPayloadRecords(db: DB) {
  const records: Array<{
    owner: PayloadOwner & { ownerKind: "node" | "run" | "release" };
    raw: string;
  }> = [];
  for (const r of await db
    .selectFrom("knowledge_book_node_runs as n")
    .innerJoin("knowledge_book_runs as r", "r.id", "n.run_id")
    .select(["r.book_id", "n.run_id", "n.node_id", "n.output"])
    .where("n.output", "!=", "")
    .orderBy("r.book_id")
    .orderBy("n.run_id")
    .orderBy("n.node_id")
    .execute())
    records.push({
      owner: {
        bookId: r.book_id,
        ownerKind: "node",
        ownerId: r.run_id,
        nodeId: r.node_id,
      },
      raw: r.output,
    });
  for (const r of await db
    .selectFrom("knowledge_book_runs")
    .select(["book_id", "id", "artifact"])
    .where("artifact", "is not", null)
    .orderBy("book_id")
    .orderBy("id")
    .execute()) {
    if (r.artifact === "")
      throw new Error("Empty run artifact is an unknown format");
    records.push({
      owner: { bookId: r.book_id, ownerKind: "run", ownerId: r.id, nodeId: "" },
      raw: r.artifact!,
    });
  }
  for (const r of await db
    .selectFrom("knowledge_book_releases")
    .select(["book_id", "id", "artifact"])
    .orderBy("book_id")
    .orderBy("id")
    .execute())
    records.push({
      owner: {
        bookId: r.book_id,
        ownerKind: "release",
        ownerId: r.id,
        nodeId: "",
      },
      raw: r.artifact,
    });
  return records;
}
async function baseline(db: DB) {
  const rows = await db.selectFrom("schema_baseline").selectAll().execute();
  if (rows.length !== 1) throw new Error("Unrecognized database generation");
  return rows[0]!;
}
async function schemaLock(db: DB) {
  if (databaseDriver(db) === "postgres")
    await sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ':doca-schema',0))`.execute(
      db,
    );
  else await sql`update schema_baseline set created_at=created_at`.execute(db);
}
async function noWorkers(db: DB) {
  if (
    await db
      .selectFrom("knowledge_book_runs")
      .select("id")
      .where("status", "=", "running")
      .executeTakeFirst()
  )
    throw new Error(
      "Running knowledge book tasks prevent offline conversion; stop workers and resolve their leases first",
    );
}
async function replace(
  db: DB,
  owner: PayloadOwner,
  expected: string,
  next: string,
) {
  const result =
    owner.ownerKind === "node"
      ? await db
          .updateTable("knowledge_book_node_runs")
          .set({ output: next })
          .where("run_id", "=", owner.ownerId)
          .where("node_id", "=", owner.nodeId)
          .where("output", "=", expected)
          .executeTakeFirst()
      : owner.ownerKind === "run"
        ? await db
            .updateTable("knowledge_book_runs")
            .set({ artifact: next })
            .where("book_id", "=", owner.bookId)
            .where("id", "=", owner.ownerId)
            .where("artifact", "=", expected)
            .executeTakeFirst()
        : await db
            .updateTable("knowledge_book_releases")
            .set({ artifact: next })
            .where("book_id", "=", owner.bookId)
            .where("id", "=", owner.ownerId)
            .where("artifact", "=", expected)
            .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1)
    throw new Error("Payload changed during offline conversion");
}
async function createInlineStructure(db: Kysely<any>) {
  await createCurrentStructure(db);
  for (const name of [...bookPayloadTables].reverse())
    await sql.raw(`drop table ${name}`).execute(db);
}
const entrySchema = z.object({
  owner: z.object({
    bookId: z.string().uuid(),
    ownerKind: z.enum(["node", "run", "release"]),
    ownerId: z.string().uuid(),
    nodeId: z.string(),
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
});
const manifestSchema = z
  .object({
    type: z.literal("knowledge_book_storage_conversion"),
    version: z.literal(1),
    action: z.enum(["upgrade", "rollback"]),
    from: z.string(),
    createdAt: z.string(),
    structure: z.string(),
    entries: z.array(entrySchema),
    objects: z.array(z.unknown()),
    operations: z.array(z.unknown()),
    references: z.array(z.unknown()),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
export async function inspectBookStorageConversion(
  db: DB,
  action: "upgrade" | "rollback",
) {
  const b = await baseline(db),
    progress =
      action === "upgrade" ? BOOK_PAYLOAD_UPGRADE : BOOK_PAYLOAD_ROLLBACK,
    from =
      action === "upgrade" ? HISTORY_SCHEMA_BASELINE : BOOK_PAYLOAD_BASELINE;
  if (![from, progress].includes(b.id))
    throw new Error(
      `Storage ${action} accepts only ${from} or its own interrupted conversion generation`,
    );
  await noWorkers(db);
  if (
    action === "rollback" &&
    (await currentSchemaTables(db)).some(
      (t) => t.name === "knowledge_book_batch_checkpoints",
    ) &&
    (await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .select("id")
      .executeTakeFirst())
  )
    throw new Error(
      "Batch checkpoints must be preserved; storage rollback requires a separately approved checkpoint recovery plan",
    );
  if (
    action === "upgrade" &&
    b.id === from &&
    (await currentSchemaTables(db)).some((t) =>
      bookPayloadTables.includes(t.name),
    )
  )
    throw new Error(
      "Book storage extension exists in the old generation; review partial conversion before writing",
    );
  const changes = await transact(db, async (tx) => {
    await schemaLock(tx);
    return inspectSchema(
      tx,
      createCurrentStructure,
      action === "upgrade" && b.id === from
        ? schemaEvolution
        : { newTables: [], newColumns: [] },
    );
  });
  if (changes.some((c) => c.kind === "review"))
    throw new SchemaReviewRequired(changes);
  const records = await bookPayloadRecords(db);
  let rawBytes = 0;
  const entries: Manifest["entries"] = [];
  for (const r of records) {
    const isRef = JSON.parse(r.raw)?.type === "knowledge_book_payload_ref";
    if (action === "upgrade" && b.id === from && isRef)
      throw new Error("New payload reference found in old generation");
    if (action === "rollback" && b.id === from && !isRef)
      throw new Error("Inline payload found in new generation");
    const raw = isRef ? await readBookPayloadRaw(db, r.raw, r.owner) : r.raw;
    payloadMetadata(raw, r.owner.ownerKind);
    if (isRef) {
      const ref = await bookPayloadReference(db, r.raw, r.owner),
        meta = payloadMetadata(raw, r.owner.ownerKind);
      if (
        meta.access_manifest !== ref.row.access_manifest ||
        meta.summary !== ref.row.summary
      )
        throw new Error("Payload metadata differs from the verified original");
    }
    rawBytes += Buffer.byteLength(raw);
    entries.push({
      owner: r.owner,
      sha256: payloadHash(raw),
      size: Buffer.byteLength(raw),
    });
  }
  return {
    generation: b.id,
    structure: b.structure_json!,
    changes,
    payloadCount: records.length,
    rawBytes,
    entries,
  };
}
/** Explicit offline maintenance only. Default preflight does not write SQL, files or objects. */
export async function convertBookStorage(
  db: DB,
  action: "upgrade" | "rollback",
  options: {
    apply?: boolean;
    manifestPath?: string;
    hostsStopped?: boolean;
  } = {},
) {
  const plan = await inspectBookStorageConversion(db, action);
  if (!options.apply) return plan;
  if (!options.hostsStopped)
    throw new Error(
      "Confirm every host is stopped with --hosts-stopped before applying",
    );
  if (!options.manifestPath)
    throw new Error(
      "Conversion requires --manifest <protected recovery-file-path>",
    );
  const progress =
    action === "upgrade" ? BOOK_PAYLOAD_UPGRADE : BOOK_PAYLOAD_ROLLBACK;
  let manifest: Manifest;
  if (plan.generation === progress) {
    manifest = manifestSchema.parse(
      JSON.parse(await readFile(options.manifestPath, "utf8")),
    );
    if (
      manifest.action !== action ||
      manifest.entries.length !== plan.entries.length
    )
      throw new Error(
        "Interrupted conversion manifest does not match this database",
      );
    const expected = new Map(
      manifest.entries.map((e) => [identity(e.owner), e]),
    );
    for (const e of plan.entries) {
      const old = expected.get(identity(e.owner));
      if (!old || old.sha256 !== e.sha256 || old.size !== e.size)
        throw new Error("Conversion input differs from its recovery manifest");
    }
  } else {
    manifest = {
      type: "knowledge_book_storage_conversion",
      version: 1,
      action,
      from: plan.generation,
      createdAt: new Date().toISOString(),
      structure: plan.structure!,
      entries: plan.entries,
      objects: [],
      operations: [],
      references: [],
    };
    if (action === "rollback") {
      manifest.objects = await db
        .selectFrom("knowledge_book_payload_objects")
        .selectAll()
        .execute();
      manifest.operations = await db
        .selectFrom("knowledge_book_payload_operations")
        .selectAll()
        .execute();
      manifest.references = await db
        .selectFrom("knowledge_book_payload_references")
        .selectAll()
        .execute();
    }
    await writeFile(options.manifestPath, JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    await transact(db, async (tx) => {
      await schemaLock(tx);
      await noWorkers(tx);
      if ((await baseline(tx)).id !== plan.generation)
        throw new Error("Generation changed during preflight");
      const current = await bookPayloadRecords(tx);
      if (current.length !== plan.entries.length)
        throw new Error("Payload inventory changed during preflight");
      const expected = new Map(plan.entries.map((e) => [identity(e.owner), e]));
      for (const r of current) {
        const e = expected.get(identity(r.owner));
        if (!e || (action === "upgrade" && payloadHash(r.raw) !== e.sha256))
          throw new Error("Payload changed during preflight");
      }
      await reconcileSchema(
        tx,
        createCurrentStructure,
        action === "upgrade"
          ? schemaEvolution
          : { newTables: [], newColumns: [] },
      );
      await tx.updateTable("schema_baseline").set({ id: progress }).execute();
    });
  }
  const expected = new Map(manifest.entries.map((e) => [identity(e.owner), e]));
  for (const r of await bookPayloadRecords(db)) {
    const isRef = JSON.parse(r.raw)?.type === "knowledge_book_payload_ref";
    if (action === "upgrade") {
      if (isRef) continue;
      const p = await prepareBookPayload(db, r.owner, r.raw);
      await transact(db, async (tx) => {
        await schemaLock(tx);
        if ((await baseline(tx)).id !== progress)
          throw new Error("Conversion gate changed");
        const marker = await installBookPayload(tx, p);
        await replace(tx, r.owner, r.raw, marker);
      });
      const restored = await readBookPayloadRaw(db, p.marker, r.owner),
        e = expected.get(identity(r.owner))!;
      if (
        payloadHash(restored) !== e.sha256 ||
        Buffer.byteLength(restored) !== e.size ||
        restored !== r.raw
      )
        throw new Error("Converted bytes differ from original");
    } else {
      if (!isRef) continue;
      const restored = await readBookPayloadRaw(db, r.raw, r.owner),
        e = expected.get(identity(r.owner))!;
      if (
        payloadHash(restored) !== e.sha256 ||
        Buffer.byteLength(restored) !== e.size
      )
        throw new Error("Rollback bytes differ from manifest");
      await transact(db, async (tx) => {
        await schemaLock(tx);
        if ((await baseline(tx)).id !== progress)
          throw new Error("Conversion gate changed");
        await replace(tx, r.owner, r.raw, restored);
      });
    }
  }
  // Full readback precedes the final structure/generation transaction; it never runs external I/O in a transaction.
  const final = await bookPayloadRecords(db);
  if (final.length !== expected.size)
    throw new Error("Final payload inventory changed");
  for (const r of final) {
    const isRef = JSON.parse(r.raw)?.type === "knowledge_book_payload_ref";
    if (isRef !== (action === "upgrade"))
      throw new Error("Incomplete storage conversion");
    const raw = isRef ? await readBookPayloadRaw(db, r.raw, r.owner) : r.raw,
      e = expected.get(identity(r.owner));
    if (
      !e ||
      payloadHash(raw) !== e.sha256 ||
      Buffer.byteLength(raw) !== e.size
    )
      throw new Error("Final conversion verification failed");
  }
  await transact(db, async (tx) => {
    await schemaLock(tx);
    await noWorkers(tx);
    if ((await baseline(tx)).id !== progress)
      throw new Error("Conversion generation changed");
    if (action === "rollback") {
      for (const name of [...bookPayloadTables].reverse())
        await sql.raw(`drop table ${name}`).execute(tx);
      const footprint = JSON.parse((await baseline(tx)).structure_json!);
      for (const name of bookPayloadTables) delete footprint[name];
      await tx
        .updateTable("schema_baseline")
        .set({ structure_json: JSON.stringify(footprint) })
        .execute();
      const changes = await inspectSchema(tx, createInlineStructure, {
        newTables: [],
        newColumns: [],
      });
      if (changes.length) throw new SchemaReviewRequired(changes);
      await recordSchemaStructure(tx, createInlineStructure);
    } else {
      const changes = await inspectSchema(tx, createCurrentStructure, {
        newTables: [],
        newColumns: [],
      });
      if (changes.length) throw new SchemaReviewRequired(changes);
      await recordSchemaStructure(tx, createCurrentStructure);
    }
    await tx
      .updateTable("schema_baseline")
      .set({
        id:
          action === "upgrade"
            ? BOOK_PAYLOAD_BASELINE
            : HISTORY_SCHEMA_BASELINE,
      })
      .execute();
  });
  return { ...plan, converted: final.length };
}
