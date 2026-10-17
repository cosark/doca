import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createExlsxCollaborationSession,
  restoreExlsxDocument,
} from "@smartdoca/sheet/yjs";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { openTestDatabase } from "./database.js";
import type { DB } from "@db/index.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import {
  editAIDocument,
  readAIDocument,
} from "@core/workflows/ai-documents.js";
import {
  provisionSurface,
  restoreSurface,
} from "@core/modules/documents/codecs/surfaces.js";

let db: DB, owner: Actor;
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  owner = {
    ...(await createUser(
      db,
      {
        login: "sheetstyle",
        displayName: "Style QA",
        password: "isolated-style-2026",
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
});
afterEach(() => db.destroy());

async function fixture() {
  const resource = await createContent(db).create(owner, {
    kind: "document",
    format: "spreadsheet",
    title: "Isolated style test",
  });
  await db.transaction().execute((tx) =>
    provisionSurface(tx, resource, {
      styles: {},
      sheetOrder: ["s"],
      sheets: {
        s: {
          id: "s",
          name: "Sheet1",
          rowCount: 20,
          columnCount: 10,
          cellData: {
            0: {
              0: { v: "保留文字", s: { bl: 1, bgColor: "#old-invalid" } },
              1: { f: "=1+2", v: 3, s: { n: { pattern: "0.00" } } },
            },
          },
        },
      },
    }),
  );
  const before = await readAIDocument(db, { actor: owner }, resource.id);
  return { resource, before };
}

it("preserves text, formulas, other styles and stored invalid fields through ACK, replay and checkpoint restore", async () => {
  const { resource, before } = await fixture();
  const loaded = await restoreSurface(db, resource.id, "spreadsheet");
  const doc = await restoreExlsxDocument({
    baseline: loaded.baseline!,
    update: loaded.update,
    checkpointSeq: loaded.state.checkpoint_seq,
  });
  const peer = await createExlsxCollaborationSession({
    doc,
    baseline: loaded.baseline!,
    sessionId: "style-peer",
  });
  const echoes: unknown[] = [];
  peer.onLocalTransaction((event) => echoes.push(event));
  await peer.connect({
    workbookId: resource.id,
    initialSnapshot: loaded.baseline!.snapshot,
    getSnapshot: () => loaded.baseline!.snapshot,
    onLocalMutation: () => () => {},
    applyRemoteMutation: async () => {},
  } as any);
  try {
    const operations = [
      {
        type: "cells",
        sheetId: "Sheet1",
        cells: [
          { row: 0, column: 0, s: { bg: { rgb: "#FFCC00" } } },
          {
            row: 0,
            column: 1,
            s: { bg: { rgb: "#FFCC00" }, cl: { rgb: "#333333" } },
          },
        ],
      },
    ];
    const operationId = randomUUID();
    const receipt = await editAIDocument(
      db,
      { actor: owner },
      resource.id,
      { seq: before.seq, epochId: before.epochId! },
      operations,
      operationId,
    );
    expect(receipt.saved).toBe(true);
    expect(
      await editAIDocument(
        db,
        { actor: owner },
        resource.id,
        { seq: before.seq, epochId: before.epochId! },
        operations,
        operationId,
      ),
    ).toEqual(receipt);
    const after = await readAIDocument(db, { actor: owner }, resource.id);
    const cells = (after.value as any).sheets.s.cellData[0];
    expect(cells[0]).toMatchObject({
      v: "保留文字",
      s: { bl: 1, bg: { rgb: "#FFCC00" }, bgColor: "#old-invalid" },
    });
    expect(cells[1]).toMatchObject({
      f: "=1+2",
      v: 3,
      s: {
        n: { pattern: "0.00" },
        bg: { rgb: "#FFCC00" },
        cl: { rgb: "#333333" },
      },
    });
    const durable = await restoreSurface(db, resource.id, "spreadsheet");
    await peer.applyUpdate({
      codec: "exlsx-cell-registers",
      schemaVersion: 6,
      epochId: receipt.epochId,
      update: durable.update,
    } as any);
    await peer.applyUpdate({
      codec: "exlsx-cell-registers",
      schemaVersion: 6,
      epochId: receipt.epochId,
      update: durable.update,
    } as any);
    expect(await projectExlsxWorkbook(peer.checkpoint(receipt.seq))).toEqual(
      after.value,
    );
    expect(echoes).toEqual([]);
    expect(durable.baseline).toEqual(loaded.baseline);
    const restored = await restoreExlsxDocument({
      baseline: durable.baseline!,
      update: Y.encodeStateAsUpdate(doc),
      checkpointSeq: receipt.seq,
    });
    restored.destroy();
    await editAIDocument(
      db,
      { actor: owner },
      resource.id,
      { seq: after.seq, epochId: after.epochId! },
      [{ type: "cells", sheetId: "s", cells: { A1: { s: { bg: null } } } }],
      randomUUID(),
    );
    const cleared = await readAIDocument(db, { actor: owner }, resource.id);
    expect((cleared.value as any).sheets.s.cellData[0][0]).toMatchObject({
      v: "保留文字",
      s: { bl: 1, bgColor: "#old-invalid" },
    });
    expect(
      (cleared.value as any).sheets.s.cellData[0][0].s.bg ?? null,
    ).toBeNull();
  } finally {
    peer.dispose();
    doc.destroy();
  }
});

it.each(["cells", "mutation"])(
  "rejects an entire %s batch without changing data, history or receipts",
  async (type) => {
    const { resource, before } = await fixture();
    const state = await restoreSurface(db, resource.id, "spreadsheet");
    const versions = await db
      .selectFrom("document_versions")
      .selectAll()
      .where("resource_id", "=", resource.id)
      .execute();
    const operationId = randomUUID();
    const bad =
      type === "cells"
        ? { type, sheetId: "s", cells: { A1: { s: { bgColor: "#FFCC00" } } } }
        : {
            type,
            id: "sheet.mutation.set-range-values",
            params: {
              unitId: resource.id,
              subUnitId: "s",
              cellValue: { 0: { 0: { backgroundColor: "#FFCC00" } } },
            },
          };
    await expect(
      editAIDocument(
        db,
        { actor: owner },
        resource.id,
        { seq: before.seq, epochId: before.epochId! },
        [
          { type: "cells", sheetId: "s", cells: { A2: "must not be written" } },
          bad,
        ],
        operationId,
      ),
    ).rejects.toThrow(/本批次未保存/);
    expect(
      (await readAIDocument(db, { actor: owner }, resource.id)).value,
    ).toEqual(before.value);
    expect(await restoreSurface(db, resource.id, "spreadsheet")).toEqual(state);
    expect(
      await db
        .selectFrom("document_versions")
        .selectAll()
        .where("resource_id", "=", resource.id)
        .execute(),
    ).toEqual(versions);
    expect(
      await db
        .selectFrom("ai_operations")
        .selectAll()
        .where("id", "=", operationId)
        .execute(),
    ).toEqual([]);
  },
);
