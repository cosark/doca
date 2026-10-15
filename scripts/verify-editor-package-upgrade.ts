// Creates every database/directory here; never connects to a deployment database.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { openDatabase, type DatabaseConfig } from "@db/connection.js";
import {
  restoreDocument,
  createDocuments,
} from "@core/modules/collaboration/documents.js";
import { restoreSurface } from "@core/modules/documents/codecs/surfaces.js";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { createContent } from "@core/workflows/resources.js";

const exec = promisify(execFile),
  driver = process.argv[2] ?? "sqlite",
  image = process.argv[3] ?? "smartdoca/doca:0.1.26";
assert(["sqlite", "postgres"].includes(driver));
if (driver === "postgres" && !process.env.DOCA_TEST_POSTGRES)
  throw Error("Set DOCA_TEST_POSTGRES to an isolated test server");
const root = await mkdtemp(join(tmpdir(), "doca-editor-upgrade-"));
const key = randomBytes(32).toString("hex");
const oldSource = String.raw`
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '@db/connection.js';
import { createUser } from '@core/modules/identity/passwords.js';
import { createContent } from '@core/workflows/resources.js';
import { createDocuments, restoreDocument, b64 } from '@core/modules/collaboration/documents.js';
import { restoreSurface } from '@core/modules/documents/codecs/surfaces.js';
import { createExlsxCollaborationSession, restoreExlsxDocument } from '@smartdoca/sheet/yjs';
import { projectExlsxWorkbook } from '@smartdoca/sheet/model';
const db=await openDatabase(process.env.DOCA_DATABASE==='postgres'?{driver:'postgres',url:process.env.DOCA_DATABASE_URL}:{driver:'sqlite',path:'/fixture/core.db'});
try {
 const owner={...await createUser(db,{login:'released-editor-fixture',displayName:'Retained owner',password:'isolated-upgrade-password'},{bootstrap:true}),admin:1};
 const content=createContent(db),docs=createDocuments(db);
 const rich=await content.create(owner,{kind:'document',format:'rich_text',title:'Retained released rich text'});
 const protocol={codec:'slate-kit',schemaVersion:3,protocolVersion:1};
 const initial=await docs.exchange(owner,rich.id,protocol),runtime=await restoreDocument(db,rich.id);
 try {
  const update=runtime.runtime.execute({type:'insertBlock',block:{id:'retained-old-diagram',type:'flowchart',children:[{text:''}],nodes:[{id:'a',label:'保留原始流程图',x:40,y:40,shape:'process',width:140,height:60}],edges:[],previewVersion:8,previewSvg:'<svg xmlns="http://www.w3.org/2000/svg" width="140" height="60"><text y="20">old preview</text></svg>'}});
  await docs.exchange(owner,rich.id,{...protocol,epochId:initial.epochId,messageId:randomUUID(),update:b64(update)});
 } finally {runtime.destroy()}
 const sheet=await content.create(owner,{kind:'document',format:'spreadsheet',title:'Retained released workbook'});
 const sheetProtocol={codec:'exlsx-cell-registers',schemaVersion:6,protocolVersion:1};
 const opened=await docs.exchange(owner,sheet.id,sheetProtocol),loaded=await restoreSurface(db,sheet.id,'spreadsheet');
 const doc=await restoreExlsxDocument({baseline:loaded.baseline,update:loaded.update,checkpointSeq:loaded.state.checkpoint_seq});
 const session=await createExlsxCollaborationSession({doc,baseline:loaded.baseline,sessionId:'released-editor-fixture'}),events=[];
 let added;
 try {
  session.onLocalTransaction(event=>events.push(event));
  await session.connect({workbookId:sheet.id,initialSnapshot:loaded.baseline.snapshot,getSnapshot:()=>loaded.baseline.snapshot,onLocalMutation:()=>()=>{},applyRemoteMutation:async()=>{}});
  added=await session.editWorksheet({action:'add',name:'旧版追加表'});
  for(const event of events) await docs.exchange(owner,sheet.id,{...sheetProtocol,epochId:opened.epochId,messageId:randomUUID(),update:b64(event.update)});
 } finally {session.dispose();doc.destroy()}
 const richSaved=await restoreDocument(db,rich.id),sheetSaved=await restoreSurface(db,sheet.id,'spreadsheet');
 let richValue;try {richValue=richSaved.runtime.getValue()} finally {richSaved.destroy()}
 const oldSheet=await projectExlsxWorkbook({baseline:sheetSaved.baseline,update:sheetSaved.update,checkpointSeq:sheetSaved.state.checkpoint_seq});
 if(oldSheet.sheets[added].defaultRowHeight!==18||oldSheet.sheets[added].defaultColumnWidth!==72) throw Error('Expected the actual released 18/72 worksheet defaults');
 const tables={};
 for(const name of ['users','resources','grants','settings','schema_baseline','document_states','editor_epochs','document_updates','editor_receipts','document_versions']) tables[name]=await db.selectFrom(name).selectAll().execute();
 await writeFile('/fixture/snapshot.json',JSON.stringify({owner,richId:rich.id,sheetId:sheet.id,addedSheetId:added,richValue,baseline:sheetSaved.baseline,update:b64(sheetSaved.update),tables}));
 console.log('Released 0.1.26 created a native diagram, an 18/72 baseline worksheet and an appended worksheet');
} finally {await db.destroy()}
`;
let admin: Pool | undefined, name: string | undefined, main: DatabaseConfig;
try {
  await writeFile(join(root, "old-fixture.ts"), oldSource);
  const env: Record<string, string> = {
    DOCA_DATABASE: driver,
    DOCA_CREDENTIAL_MASTER_KEY: key,
  };
  if (driver === "postgres") {
    const url = new URL(process.env.DOCA_TEST_POSTGRES!);
    admin = new Pool({ connectionString: url.href, max: 1 });
    name = "doca_editor_upgrade_" + randomUUID().replaceAll("-", "");
    await admin.query(`create database ${name}`);
    url.pathname = "/" + name;
    main = { driver: "postgres", url: url.href };
    const containerUrl = new URL(url);
    if (["127.0.0.1", "localhost"].includes(containerUrl.hostname))
      containerUrl.hostname = "host.docker.internal";
    env.DOCA_DATABASE_URL = containerUrl.href;
  } else main = { driver: "sqlite", path: join(root, "core.db") };
  await writeFile(
    join(root, "old.env"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  const old = await exec(
    "docker",
    [
      "run",
      "--rm",
      "--user",
      "0",
      ...(process.platform === "linux"
        ? ["--add-host", "host.docker.internal:host-gateway"]
        : []),
      "--env-file",
      join(root, "old.env"),
      "-v",
      `${resolve(root)}:/fixture`,
      "-v",
      `${resolve(root, "old-fixture.ts")}:/app/editor-upgrade-old-fixture.ts:ro`,
      image,
      "node",
      "--import",
      "tsx",
      "editor-upgrade-old-fixture.ts",
    ],
    { timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  process.stdout.write(old.stdout);
  const expected = JSON.parse(
    await readFile(join(root, "snapshot.json"), "utf8"),
  );
  const db = await openDatabase(main);
  try {
    const assertRows = async () => {
      for (const [table, rows] of Object.entries(expected.tables)) {
        const actual = await db
          .selectFrom(table as any)
          .selectAll()
          .execute();
        const sorted = (value: any[]) =>
          value.map((row) => JSON.stringify(row)).sort();
        assert.deepEqual(sorted(actual), sorted(rows as any[]), table);
      }
    };
    await assertRows();
    const rich = await restoreDocument(db, expected.richId);
    try {
      assert.deepEqual(rich.runtime.getValue(), expected.richValue);
    } finally {
      rich.destroy();
    }
    const sheet = await restoreSurface(db, expected.sheetId, "spreadsheet");
    assert.deepEqual(sheet.baseline, expected.baseline);
    assert.equal(Buffer.from(sheet.update).toString("base64"), expected.update);
    const value = await projectExlsxWorkbook({
      baseline: sheet.baseline!,
      update: sheet.update,
      checkpointSeq: sheet.state.checkpoint_seq,
    });
    const baselineSheet = sheet.baseline!.snapshot.sheetOrder[0]!;
    assert.equal(value.sheets[baselineSheet]!.defaultRowHeight, 18);
    assert.equal(value.sheets[baselineSheet]!.defaultColumnWidth, 72);
    assert.equal(value.sheets[expected.addedSheetId]!.defaultRowHeight, 19.8);
    assert.equal(value.sheets[expected.addedSheetId]!.defaultColumnWidth, 79.2);
    await assertRows();
    const owner = expected.owner;
    const fresh = await createContent(db).create(owner, {
      kind: "document",
      format: "spreadsheet",
      title: "New native defaults",
    });
    await createDocuments(db).exchange(owner, fresh.id, {
      codec: "exlsx-cell-registers",
      schemaVersion: 6,
      protocolVersion: 1,
    });
    const created = await restoreSurface(db, fresh.id, "spreadsheet");
    const first = created.baseline!.snapshot.sheetOrder[0]!;
    assert.equal(
      created.baseline!.snapshot.sheets[first]!.defaultRowHeight,
      19.8,
    );
    assert.equal(
      created.baseline!.snapshot.sheets[first]!.defaultColumnWidth,
      79.2,
    );
    console.log(
      `${driver}: released 0.1.26 → current passed; core rows, original baseline/Yjs bytes and old diagram retained; appended display and new documents use 19.8/79.2`,
    );
  } finally {
    await db.destroy();
  }
} finally {
  if (admin) {
    try {
      if (name) await admin.query(`drop database ${name} with (force)`);
    } finally {
      await admin.end();
    }
  }
  await rm(root, { recursive: true, force: true });
}
