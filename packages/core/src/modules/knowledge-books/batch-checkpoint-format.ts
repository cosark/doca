import { z } from "zod";
import type { Evidence } from "./protocol.js";

const inventoryItem = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceRevision: z.number().int().positive(),
    sourceVersion: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    blockId: z.string().min(1),
    weight: z.number().positive(),
    reference: z.unknown(),
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
export function bookBatchEvidenceInventory(
  evidence: (Evidence & { weight: number })[],
) {
  return evidence.map((item) => {
    return inventoryItem.parse({
      id: item.id,
      sourceId: item.sourceId,
      sourceRevision: item.sourceRevision,
      sourceVersion: item.sourceVersion,
      contentHash: item.contentHash,
      blockId: item.blockId,
      weight: item.weight,
      reference: item.reference,
      ...(item.contentRef ? { contentRef: item.contentRef } : {}),
    });
  });
}

/** Internal execution format, independent of published version-1 book artifacts. */
export const bookBatchEnvelopeSchema = z
  .object({
    version: z.literal(1),
    stage: z.enum(["extract", "synthesize", "organize", "acceptance"]),
    phase: z.string().min(1).max(80),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    batchKey: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceInventory: z.array(inventoryItem),
    result: z.unknown(),
  })
  .strict();
export type BookBatchEnvelope = z.infer<typeof bookBatchEnvelopeSchema>;
