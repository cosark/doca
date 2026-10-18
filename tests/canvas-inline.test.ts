import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasModel } from "@smartdoca/canvas/model";
import { canvasInlineElements } from "@core/modules/documents/canvas-inline.js";
import { documentReferenceIds } from "@core/modules/documents/references.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import {
  b64,
  unb64,
  createDocuments,
} from "@core/modules/collaboration/documents.js";
import { openTestDatabase } from "./database.js";

const atom = (type: string, data: Record<string, string>) => ({
  type: "inline",
  inline: { id: randomUUID(), type, label: "QA", data },
  children: [{ text: "" }],
});
const text = (children: unknown[]) => ({
  tag: "Text",
  text: "\uFFFC\uFFFC",
  data: { richText: { version: 1, value: [{ type: "paragraph", children }] } },
});
it("reads only native canvas atoms and preserves unknown extension payloads", () => {
  const documentId = randomUUID(),
    userId = randomUUID();
  const native = text([
    atom("custom:user-mention", { userId }),
    atom("custom:document-reference", { documentId }),
    atom("other", { opaque: "keep" }),
  ]);
  const elements = canvasInlineElements({ scene: { children: [native] } });
  expect(elements.map((e) => e.type)).toEqual([
    "custom:user-mention",
    "custom:document-reference",
  ]);
  expect(documentReferenceIds(elements)).toEqual(new Set([documentId]));
  expect(() =>
    canvasInlineElements({
      scene: {
        children: [text([atom("custom:user-mention", { userId: "bad" })])],
      },
    }),
  ).toThrow("行内引用无效");
});
it("commits mentions/references once with durable ACK, rejects invalid users atomically and restores original identities", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const replicas: CanvasModel[] = [];
  try {
    const actor = {
      ...(await createUser(
        db,
        {
          login: "canvasinline",
          displayName: "Canvas QA",
          password: "isolated-canvas-inline-2026",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
    const content = createContent(db),
      source = await content.create(actor, {
        kind: "document",
        format: "canvas",
        title: "Inline source",
      });
    const target = await content.create(actor, {
      kind: "document",
      format: "rich_text",
      title: "Target",
    });
    const mentioned = await createUser(
      db,
      {
        login: "canvasmentioned",
        displayName: "Mentioned QA",
        password: "isolated-canvas-mention-2026",
      },
      { actor },
    );
    await content.permissions(actor, source.id, {
      version: source.version,
      accessMode: "custom",
      visibility: "invited",
      grants: [{ userId: mentioned.id, role: "editor" }],
    });
    const docs = createDocuments(db),
      protocol = {
        codec: "aidcanvas-yjs",
        schemaVersion: 1,
        protocolVersion: 1,
      };
    const initial = await docs.exchange(actor, source.id, protocol);
    for (let i = 0; i < 2; i++)
      replicas.push(
        CanvasModel.restore({
          codec: "aidcanvas-yjs",
          schemaVersion: 1,
          epochId: initial.epochId!,
          update: unb64(initial.update),
        }),
      );
    const [a, b] = replicas as [CanvasModel, CanvasModel],
      local: any[] = [],
      remote: any[] = [];
    a.onLocalUpdate((u) => local.push(u));
    b.onLocalUpdate((u) => remote.push(u));
    const nodeId = a.add(
      text([
        atom("custom:user-mention", { userId: mentioned.id }),
        atom("custom:document-reference", { documentId: target.id }),
      ]),
    );
    const message = {
      ...protocol,
      epochId: initial.epochId,
      messageId: randomUUID(),
      update: b64(local[0].update),
    };
    const first = await docs.exchange(actor, source.id, message),
      duplicate = await docs.exchange(actor, source.id, message);
    expect(first.seq).toBe(1);
    expect(duplicate.seq).toBe(1);
    expect(
      await db
        .selectFrom("notifications")
        .selectAll()
        .where("resource_id", "=", source.id)
        .where("type", "=", "document.mentioned")
        .execute(),
    ).toMatchObject([{ user_id: mentioned.id }]);
    b.applyUpdate(local[0]);
    b.applyUpdate(local[0]);
    expect(remote).toEqual([]);
    expect(b.getValue()).toEqual(a.getValue());
    expect(
      await db
        .selectFrom("document_references")
        .selectAll()
        .where("source_id", "=", source.id)
        .execute(),
    ).toMatchObject([{ target_id: target.id }]);
    const before = await db
      .selectFrom("document_states")
      .selectAll()
      .where("resource_id", "=", source.id)
      .executeTakeFirstOrThrow();
    a.add(text([atom("custom:user-mention", { userId: randomUUID() })]));
    await expect(
      docs.exchange(actor, source.id, {
        ...protocol,
        epochId: initial.epochId,
        messageId: randomUUID(),
        update: b64(local.at(-1).update),
      }),
    ).rejects.toThrow();
    expect(
      await db
        .selectFrom("document_states")
        .selectAll()
        .where("resource_id", "=", source.id)
        .executeTakeFirstOrThrow(),
    ).toEqual(before);
    const restored = CanvasModel.restore({
      codec: "aidcanvas-yjs",
      schemaVersion: 1,
      epochId: initial.epochId!,
      update: unb64(first.update),
    });
    replicas.push(restored);
    expect(restored.getValue()).toEqual(b.getValue());
    b.setReadOnly(true);
    expect(() => b.remove([nodeId])).toThrow("READONLY");
  } finally {
    replicas.forEach((m) => m.dispose());
    await db.destroy();
  }
});
