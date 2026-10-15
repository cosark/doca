import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  createExlsxCollaborationSession,
  restoreExlsxDocument,
  type ExlsxBaseline,
} from "@smartdoca/sheet/yjs";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import { createDocuments } from "@core/modules/collaboration/documents.js";
import { restoreSurface } from "@core/modules/documents/codecs/surfaces.js";

// Generated with the actual unmodified npm rc.19 artifact, not the current SDK.
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/editor-upgrade/sheet-rc19.json", import.meta.url),
    "utf8",
  ),
) as {
  baseline: ExlsxBaseline;
  update: string;
  checkpointSeq: number;
  addedSheetId: string;
};

it("projects rc.19 appended sheets with approved dimensions without rewriting baseline, seeds or checkpoint", async () => {
  const recovery = {
    ...fixture,
    update: new Uint8Array(Buffer.from(fixture.update, "base64")),
  };
  const doc = await restoreExlsxDocument(recovery);
  const before = Y.encodeStateAsUpdate(doc);
  const seeds = doc.getMap("exlsx:sheet-seeds").toJSON();
  let writes = 0,
    local = 0;
  doc.on("update", () => writes++);
  const session = await createExlsxCollaborationSession({
    doc,
    baseline: fixture.baseline,
    sessionId: "upgrade-reader",
    readOnly: true,
  });
  session.onLocalTransaction(() => local++);
  try {
    const snapshot = await projectExlsxWorkbook(
      session.checkpoint(fixture.checkpointSeq),
    );
    expect(snapshot.sheets.base).toMatchObject({
      defaultRowHeight: 31,
      defaultColumnWidth: 119,
      cellData: { 0: { 0: { v: "保留已有数据" } } },
    });
    expect(snapshot.sheets[fixture.addedSheetId]).toMatchObject({
      defaultRowHeight: 19.8,
      defaultColumnWidth: 79.2,
    });
    expect(snapshot.sheets.unsized).not.toHaveProperty("defaultRowHeight");
    expect(snapshot.sheets.unsized).not.toHaveProperty("defaultColumnWidth");
    const anchor = session.captureCellAnchor!({
      sheetId: fixture.addedSheetId,
      startRow: 0,
      endRow: 0,
      startColumn: 0,
      endColumn: 0,
    })!;
    expect(session.resolveCellAnchor!(anchor)?.sheetId).toBe(
      fixture.addedSheetId,
    );
    await expect(session.editWorksheet!({ action: "add" })).rejects.toThrow();
    expect(session.checkpoint(fixture.checkpointSeq).baseline).toEqual(
      fixture.baseline,
    );
    expect(doc.getMap("exlsx:sheet-seeds").toJSON()).toEqual(seeds);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(writes).toBe(0);
    expect(local).toBe(0);
  } finally {
    session.dispose();
    doc.destroy();
  }
});

it("creates the host's first worksheet with the same compact dimensions as native appended worksheets", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  try {
    const owner = {
      ...(await createUser(
        db,
        {
          login: "sheetupgrade",
          displayName: "Sheet upgrade QA",
          password: "isolated-sheet-upgrade-2026",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
    const resource = await createContent(db).create(owner, {
      kind: "document",
      format: "spreadsheet",
      title: "Compact worksheet",
    });
    await createDocuments(db).exchange(owner, resource.id, {
      codec: "exlsx-cell-registers",
      schemaVersion: 6,
      protocolVersion: 1,
    });
    const loaded = await restoreSurface(db, resource.id, "spreadsheet");
    const first = loaded.baseline!.snapshot.sheetOrder[0]!;
    expect(loaded.baseline!.snapshot.sheets[first]).toMatchObject({
      defaultRowHeight: 19.8,
      defaultColumnWidth: 79.2,
    });
    expect(loaded.state.seq).toBe(0);
  } finally {
    await db.destroy();
  }
});
