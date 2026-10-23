import { randomUUID } from "node:crypto";
import { encodeStateAsUpdate, encodeStateVector } from "@smartdoca/slate/yjs";
import * as Y from "yjs";
import type { Transaction } from "kysely";
import type { Schema } from "@db/index.js";
import type { Actor } from "../identity/passwords.js";
import { authorize } from "../access/queries.js";
import { requireCapability } from "../access/operation-policy.js";
import {
  b64,
  createDocuments,
  restoreDocument,
} from "../collaboration/documents.js";
import { editorEpoch, type EditorInput } from "../collaboration/protocol.js";
import { MARKDOWN_CODEC, restoreMarkdown } from "./codecs/markdown.js";
import { fail } from "../../shared/errors.js";

/** Build one native append increment. Keep these original bytes for every retry. */
export async function preparePlainTextAppend(
  db: Transaction<Schema>,
  actor: Actor,
  resourceId: string,
  text: string,
  messageId: string,
): Promise<EditorInput> {
  const { resource } = await authorize(db, actor, resourceId, 3);
  await requireCapability(db, actor.id, "documents.import");
  if (
    resource.kind !== "document" ||
    !["rich_text", "markdown"].includes(resource.format)
  )
    fail(400, "clipper_target_unsupported");
  if (!text.trim() || Buffer.byteLength(text) > 64 * 1024)
    fail(400, "quick_note_invalid_text");
  const protocol = {
    codec: resource.format === "markdown" ? MARKDOWN_CODEC.codec : "slate-kit",
    schemaVersion:
      resource.format === "markdown" ? MARKDOWN_CODEC.schemaVersion : 3,
    protocolVersion: 1,
  };
  // Initialize through the same native handshake used by the document editor.
  await createDocuments(db).exchange(actor, resourceId, protocol);
  if (resource.format === "markdown") {
    const loaded = await restoreMarkdown(db, resourceId);
    try {
      if (!loaded.epochId) fail(409, "clipper_target_uninitialized");
      const vector = Y.encodeStateVector(loaded.doc);
      const value = loaded.doc.getText(MARKDOWN_CODEC.textRoot);
      value.insert(value.length, (value.length ? "\n\n" : "") + text);
      return {
        ...protocol,
        epochId: loaded.epochId,
        messageId,
        update: b64(Y.encodeStateAsUpdate(loaded.doc, vector)),
      };
    } finally {
      loaded.destroy();
    }
  }
  const loaded = await restoreDocument(db, resourceId);
  try {
    if (!loaded.state) fail(409, "clipper_target_uninitialized");
    const vector = encodeStateVector(loaded.doc);
    const last = loaded.runtime.getValue().at(-1);
    let afterId = last && "id" in last ? last.id : undefined;
    for (const line of text.split(/\r\n|\r|\n/)) {
      const block = {
        id: randomUUID(),
        type: "paragraph" as const,
        children: [{ text: line }],
      };
      loaded.runtime.execute({ type: "insertBlock", afterId, block });
      afterId = block.id;
    }
    const epoch = await editorEpoch(db, resourceId);
    return {
      ...protocol,
      epochId: epoch.epoch_id,
      messageId,
      update: b64(encodeStateAsUpdate(loaded.doc, vector)),
    };
  } finally {
    loaded.destroy();
  }
}
