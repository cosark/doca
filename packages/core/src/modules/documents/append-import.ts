import { randomUUID } from "node:crypto";
import { encodeStateVector, encodeStateAsUpdate } from "@smartdoca/slate/yjs";
import {
  encodeStateVector as markdownVector,
  encodeStateAsUpdate as markdownUpdate,
} from "yjs";
import type { DB } from "@db/index.js";
import type { Schema } from "@db/index.js";
import type { Transaction } from "kysely";
import type { Actor } from "../identity/passwords.js";
import { authorize } from "../access/queries.js";
import { requireCapability } from "../access/operation-policy.js";
import {
  b64,
  createDocuments,
  restoreDocument,
} from "../collaboration/documents.js";
import { editorEpoch } from "../collaboration/protocol.js";
import { validateImport } from "./import.js";
import { restoreMarkdown, MARKDOWN_CODEC } from "./codecs/markdown.js";
import { fail } from "../../shared/errors.js";

/** Append imported, already rebound assets through the existing durable CRDT channel. Caller owns the transaction. */
export async function appendImportedContent(
  db: Transaction<Schema>,
  actor: Actor,
  id: string,
  value: unknown[],
  markdown: string,
  messageId: string,
) {
  const { resource } = await authorize(db, actor, id, 3);
  await requireCapability(db, actor.id, "documents.import");
  if (
    resource.kind !== "document" ||
    !["rich_text", "markdown"].includes(resource.format)
  )
    fail(400, "clipper_target_unsupported");
  await createDocuments(db).exchange(actor, id, {
    codec: resource.format === "markdown" ? MARKDOWN_CODEC.codec : "slate-kit",
    protocolVersion: 1,
    schemaVersion: resource.format === "markdown" ? 1 : 3,
  });
  if (resource.format === "markdown") {
    const loaded = await restoreMarkdown(db, id);
    try {
      if (!loaded.epochId) fail(409, "clipper_target_uninitialized");
      const vector = markdownVector(loaded.doc);
      const text = loaded.doc.getText(MARKDOWN_CODEC.textRoot);
      text.insert(text.length, "\n\n" + markdown);
      return await createDocuments(db).exchange(actor, id, {
        update: b64(markdownUpdate(loaded.doc, vector)),
        codec: MARKDOWN_CODEC.codec,
        schemaVersion: MARKDOWN_CODEC.schemaVersion,
        protocolVersion: 1,
        epochId: loaded.epochId,
        messageId,
      });
    } finally {
      loaded.destroy();
    }
  }
  const assets = await db
    .selectFrom("assets")
    .select("id")
    .where("resource_id", "=", id)
    .where("deleted_at", "is", null)
    .execute();
  validateImport(
    value,
    0,
    { nodes: 0 },
    new Set(assets.map((asset) => asset.id)),
  );
  const loaded = await restoreDocument(db, id);
  try {
    if (!loaded.state) fail(409, "clipper_target_uninitialized");
    const vector = encodeStateVector(loaded.doc);
    const last = loaded.runtime.getValue().at(-1);
    let afterId = last && "id" in last ? last.id : undefined;
    for (const node of value as any[]) {
      const block = { ...node, id: node.id ?? randomUUID() };
      loaded.runtime.execute({ type: "insertBlock", afterId, block });
      afterId = block.id;
    }
    const epoch = await editorEpoch(db, id);
    return await createDocuments(db).exchange(actor, id, {
      update: b64(encodeStateAsUpdate(loaded.doc, vector)),
      codec: "slate-kit",
      schemaVersion: 3,
      protocolVersion: 1,
      epochId: epoch.epoch_id,
      messageId,
    });
  } finally {
    loaded.destroy();
  }
}
