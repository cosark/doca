import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CanvasModel } from "@smartdoca/canvas/model";
import { encodeStateAsUpdate, Doc, applyUpdate } from "yjs";
it("opens the real released 0.4.3 checkpoint without changing its content or CRDT identities", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/editor-upgrade-2026-10-17/canvas-0.4.3.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const bytes = new Uint8Array(Buffer.from(fixture.update, "base64"));
  const model = CanvasModel.restore({
    codec: "aidcanvas-yjs",
    schemaVersion: 1,
    epochId: fixture.epochId,
    update: bytes,
  });
  const writes: unknown[] = [];
  model.onLocalUpdate((u) => writes.push(u));
  const doc = new Doc();
  try {
    applyUpdate(doc, bytes);
    expect(model.getValue()).toEqual(fixture.value);
    model.find("中文");
    model.captureAnchor(["old-text"]);
    model.setReadOnly(true);
    expect(model.checkpoint().update).toEqual(encodeStateAsUpdate(doc));
    expect(writes).toEqual([]);
  } finally {
    model.dispose();
    doc.destroy();
  }
});

it("rejects unbound inline attachments atomically without changing checkpoint or sequence", async () => {
  const { openTestDatabase } = await import("./database.js");
  const { createUser } = await import("@core/modules/identity/passwords.js");
  const { createContent } = await import("@core/workflows/resources.js");
  const { createDocuments, b64, unb64 } =
    await import("@core/modules/collaboration/documents.js");
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  let model: CanvasModel | undefined;
  try {
    const account = await createUser(
      db,
      {
        login: "canvasassetqa",
        displayName: "QA",
        password: "isolated-canvas-assets",
      },
      { bootstrap: true },
    );
    const owner = { ...account, admin: 1 };
    const resource = await createContent(db).create(owner, {
      title: "Canvas resources QA",
      kind: "document",
      format: "canvas",
    });
    const docs = createDocuments(db),
      protocol = {
        protocolVersion: 1,
        codec: "aidcanvas-yjs",
        schemaVersion: 1,
      };
    const sync = await docs.exchange(owner, resource.id, protocol);
    model = CanvasModel.restore({
      codec: "aidcanvas-yjs",
      schemaVersion: 1,
      epochId: sync.epochId!,
      update: unb64(sync.update),
    });
    const before = await db
      .selectFrom("document_states")
      .selectAll()
      .where("resource_id", "=", resource.id)
      .executeTakeFirstOrThrow();
    model.add({
      tag: "Text",
      text: "\uFFFC",
      data: {
        richText: {
          version: 1,
          value: [
            {
              type: "paragraph",
              resource: {
                id: "qa-resource",
                kind: "attachment",
                path: "00000000-0000-4000-8000-000000000001",
                name: "foreign.txt",
              },
              children: [{ text: "" }],
            },
          ],
        },
      },
    });
    await expect(
      docs.exchange(owner, resource.id, {
        ...protocol,
        epochId: sync.epochId,
        messageId: crypto.randomUUID(),
        update: b64(model.checkpoint().update),
      }),
    ).rejects.toThrow("资源不属于当前文档");
    expect(
      await db
        .selectFrom("document_states")
        .selectAll()
        .where("resource_id", "=", resource.id)
        .executeTakeFirstOrThrow(),
    ).toEqual(before);
  } finally {
    model?.dispose();
    await db.destroy();
  }
});
