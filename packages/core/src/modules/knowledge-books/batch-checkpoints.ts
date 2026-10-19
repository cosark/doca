import type { DB } from "@db/index.js";
import { transact, databaseDriver } from "@db/transactions.js";
import { randomUUID } from "node:crypto";
import { bookHash } from "./management.js";
import { bookFail as fail } from "./errors.js";
import type { Evidence } from "./protocol.js";
import {
  bookBatchEnvelopeSchema,
  bookBatchEvidenceInventory,
} from "./batch-checkpoint-format.js";
import {
  prepareBookPayload,
  installBookBatchPayload,
  abandonBookPayload,
  readBookPayload,
  lockBookPayload,
} from "./payload-storage.js";

type Stage = "extract" | "synthesize" | "organize" | "acceptance";
export interface BookBatchCheckpoints {
  run<T>(
    request: {
      phase: string;
      nodeInput: unknown;
      input: unknown;
      model: unknown;
      runtimeVersion: string;
      evidence: (Evidence & { weight: number })[];
      validate: (value: unknown) => T | Promise<T>;
    },
    produce: () => Promise<T>,
  ): Promise<T>;
}
export function bookBatchCheckpointsEnabled() {
  const value = process.env.DOCA_BOOK_BATCH_CHECKPOINTS;
  if (value !== undefined && !["on", "off"].includes(value))
    throw new Error("DOCA_BOOK_BATCH_CHECKPOINTS must be on or off");
  return value !== "off";
}

/** A store belongs to one frozen run/node, never a cross-run result cache. */
export function createBookBatchCheckpoints(options: {
  db: DB;
  bookId: string;
  runId: string;
  nodeId: string;
  stage: Stage;
  scope: unknown;
  guard: (db: DB) => Promise<void>;
}): BookBatchCheckpoints {
  const { db, bookId, runId, nodeId, stage, guard } = options;
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    async run<T>(
      request: Parameters<BookBatchCheckpoints["run"]>[0],
      produce: () => Promise<T>,
    ): Promise<T> {
      const scopeHash = bookHash([options.scope, request.nodeInput]);
      const planHash = bookHash([
        scopeHash,
        request.model,
        request.runtimeVersion,
      ]);
      const inputHash = bookHash(request.input);
      const evidenceInventory = bookBatchEvidenceInventory(request.evidence);
      const batchKey = bookHash([request.phase, inputHash]);
      const key = `${planHash}:${batchKey}`;
      const existing = inFlight.get(key);
      if (existing) return existing as Promise<T>;
      const work = (async () => {
        await guard(db);
        const query = (connection: DB) =>
          connection
            .selectFrom("knowledge_book_batch_checkpoints")
            .selectAll()
            .where("book_id", "=", bookId)
            .where("run_id", "=", runId)
            .where("node_id", "=", nodeId)
            .where("plan_hash", "=", planHash)
            .where("batch_key", "=", batchKey);
        const assertPlan = async (connection: DB) => {
          const changedPlan = await connection
            .selectFrom("knowledge_book_batch_checkpoints")
            .select("id")
            .where("run_id", "=", runId)
            .where("node_id", "=", nodeId)
            .where("scope_hash", "=", scopeHash)
            .where("plan_hash", "!=", planHash)
            .executeTakeFirst();
          if (changedPlan)
            fail(
              409,
              "Checkpoint model or algorithm changed; start a new pipeline. Existing checkpoints were retained.",
            );
        };
        await assertPlan(db);
        const read = async (
          row: Awaited<
            ReturnType<ReturnType<typeof query>["executeTakeFirstOrThrow"]>
          >,
        ) => {
          if (
            row.stage !== stage ||
            row.phase !== request.phase ||
            row.input_hash !== inputHash ||
            row.scope_hash !== scopeHash
          )
            fail(409, "Batch checkpoint scope does not match its request");
          const envelope = bookBatchEnvelopeSchema.parse(
            await readBookPayload(db, row.result_ref, {
              bookId,
              ownerKind: "batch",
              ownerId: row.id,
              nodeId,
            }),
          );
          if (
            envelope.stage !== stage ||
            envelope.phase !== request.phase ||
            envelope.planHash !== planHash ||
            envelope.scopeHash !== scopeHash ||
            envelope.inputHash !== inputHash ||
            envelope.batchKey !== batchKey ||
            bookHash(envelope.evidenceInventory) !== bookHash(evidenceInventory)
          )
            fail(
              409,
              "Batch checkpoint content does not match its recorded scope",
            );
          const result = await request.validate(envelope.result);
          await guard(db);
          return result as T;
        };
        const saved = await query(db).executeTakeFirst();
        if (saved) return read(saved);
        const result = (await request.validate(await produce())) as T;
        await guard(db);
        const envelope = bookBatchEnvelopeSchema.parse({
          version: 1,
          stage,
          phase: request.phase,
          scopeHash,
          planHash,
          inputHash,
          batchKey,
          evidenceInventory,
          result,
        });
        const prepared = await prepareBookPayload(
          db,
          { bookId, ownerKind: "batch", ownerId: randomUUID(), nodeId },
          JSON.stringify(envelope),
        );
        let installed = false;
        try {
          const row = await transact(db, async (tx) => {
            await lockBookPayload(tx, bookId);
            if (databaseDriver(tx) === "postgres")
              await tx
                .selectFrom("knowledge_book_runs")
                .select("id")
                .where("id", "=", runId)
                .forUpdate()
                .executeTakeFirstOrThrow();
            await guard(tx);
            await assertPlan(tx);
            const winner = await query(tx).executeTakeFirst();
            if (winner) return winner;
            await installBookBatchPayload(tx, prepared, {
              run_id: runId,
              stage,
              phase: request.phase,
              scope_hash: scopeHash,
              plan_hash: planHash,
              batch_key: batchKey,
              input_hash: inputHash,
            });
            return undefined;
          });
          installed = !row;
          if (row) return await read(row);
          await guard(db);
          return result;
        } finally {
          if (!installed) await abandonBookPayload(db, prepared.operationId);
        }
      })();
      inFlight.set(key, work);
      try {
        return await work;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
