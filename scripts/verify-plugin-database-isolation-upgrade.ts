import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { zipSync, strToU8 } from "fflate";
import { openDatabase, type DatabaseConfig } from "@db/connection.js";
import { currentSchemaTables } from "@db/introspection.js";
import { PluginManager } from "@server/plugins/manager.js";
import { bindPluginStorage } from "@server/services/plugin-storage.js";
import { configurePluginDatabases } from "@server/services/plugin-databases.js";
import { createHostFileStore } from "@server/services/host-file-store.js";
import { storageRuntime } from "@server/adapters/storage.js";

// Every database and directory in this acceptance run is newly created here.
// DOCA_TEST_POSTGRES is a dedicated test server, never a deployment database.
const exec = promisify(execFile),
  driver = process.argv[2] ?? "sqlite",
  image = process.argv[3] ?? "smartdoca/doca:0.1.25";
if (!["sqlite", "postgres"].includes(driver))
  throw new Error("Expected sqlite or postgres");
if (driver === "postgres" && !process.env.DOCA_TEST_POSTGRES)
  throw new Error(
    "Set DOCA_TEST_POSTGRES to an isolated PostgreSQL test server",
  );
const root = await mkdtemp(join(tmpdir(), "doca-plugin-upgrade-")),
  id = "example.upgrade",
  key = randomBytes(32).toString("hex"),
  manifest = {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    displayName: "Upgrade fixture",
    sdkRange: "^0.1.11",
  },
  schema = {
    version: 1 as const,
    tables: {
      notes: {
        columns: {
          id: { type: "text" as const, nullable: false },
          text: { type: "text" as const, nullable: false },
        },
        primaryKey: ["id"],
        unique: [],
      },
    },
  },
  bundle = zipSync(
    {
      "package.json": strToU8(
        JSON.stringify({
          name: "example-upgrade",
          version: "1.0.0",
          type: "module",
          doca: {
            storage: "host",
            dataVersion: "1",
            manifest: "./manifest.json",
            server: "./server.js",
          },
        }),
      ),
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "server.js": strToU8(
        `export default () => ({manifest:${JSON.stringify(manifest)},async uninstall(){}})`,
      ),
    },
    { mtime: new Date("2020-01-01T00:00:00Z") },
  );
let admin: Pool | undefined,
  coreName: string | undefined,
  businessName: string | undefined,
  oldBusinessName: string | undefined,
  role: string | undefined,
  main: DatabaseConfig;
const owned: string[] = [];
const oldSource = `
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { openDatabase } from '@db/index.js';
import { currentSchemaTables } from '@db/introspection.js';
import { createUser } from '@core/modules/identity/passwords.js';
import { createContent } from '@core/workflows/resources.js';
import { createServerFilesCapability } from '@server/plugins/files-capability-adapter.js';
import { PluginManager } from '@server/plugins/manager.js';
import { bindPluginStorage } from '@server/services/plugin-storage.js';
import { pluginDatabases } from '@server/services/plugin-databases.js';
import { createCredentialCipher } from '@server/services/credential-cipher.js';
import { createHostFileStore } from '@server/services/host-file-store.js';
import { storageRuntime } from '@server/adapters/storage.js';
const db=await openDatabase(process.env.DOCA_DATABASE==='postgres'?{driver:'postgres',url:process.env.DOCA_DATABASE_URL}:{driver:'sqlite',path:'/fixture/core.db'});
const encryption=createCredentialCipher(process.env.DOCA_CREDENTIAL_MASTER_KEY);
const runtime=storageRuntime(), files=createHostFileStore(runtime), manager=new PluginManager('/fixture/plugins',[],db,undefined,files);
try {
 if(process.env.DOCA_FIXTURE_ACTION==='create') {
  const user=await createUser(db,{login:'upgrade-fixture',displayName:'Retained user',password:'synthetic-upgrade-password'},{bootstrap:true});
  await createContent(db).create(user,{kind:'document',format:'markdown',title:'Retained core document',markdown:'# Retained core document\\nSynthetic retained text'});
  await createServerFilesCapability(db,runtime).folders.create({principalId:user.id},{name:'Retained user folder',parentId:null});
  await manager.install(new Uint8Array(await readFile('/fixture/plugin.zip')),'local');
  const storage=await bindPluginStorage(db,files,'${id}','1',encryption);
  await storage.database.defineSchema(${JSON.stringify(schema)});
  await storage.database.insert('notes',[{id:'old',text:'discarded business data'}]);
  const business=await pluginDatabases(db).open('${id}',true);
  if(!(await currentSchemaTables(business)).some(t=>t.name==='notes')) throw Error('Released host did not create an independent business table');
  await storage.credentials.create({value:'discarded synthetic credential'});
  await storage.objects.put({data:new TextEncoder().encode('discarded synthetic object'),mime:'text/plain'});
  await writeFile('/fixture/old-namespace.json',JSON.stringify(await db.selectFrom('plugin_storage_namespaces').selectAll().execute()));
  const snapshot={};
  for(const name of ['users','resources','document_states','grants','settings','file_folders']) snapshot[name]=await db.selectFrom(name).selectAll().execute();
  await writeFile('/fixture/core-snapshot.json',JSON.stringify(snapshot));
  console.log('Released 0.1.25 created retained core data and independent plugin business rows');
 } else if(process.env.DOCA_FIXTURE_ACTION==='verify') {
  const snapshot=JSON.parse(await readFile('/fixture/core-snapshot.json','utf8'));
  for(const [name,rows] of Object.entries(snapshot)) assert.deepEqual(await db.selectFrom(name).selectAll().execute(),rows);
  assert.deepEqual(await db.selectFrom('plugin_storage_namespaces').selectAll().execute(),JSON.parse(await readFile('/fixture/old-namespace.json','utf8')));
  console.log('Rejected startup preserved the released core rows and old installation declaration');
 } else {
  await manager.change('${id}','remove');
  const business=await pluginDatabases(db).open('${id}',false);
  if((await currentSchemaTables(business)).length) throw Error('Old normal uninstall left business tables');
  for(const name of ['plugin_credentials','plugin_private_objects','plugin_object_garbage'])
    if((await db.selectFrom(name).selectAll().execute()).length) throw Error('Old normal uninstall left private data: '+name);
  console.log('Released 0.1.25 normal uninstall removed private business tables, credentials and objects');
 }
} finally {await db.destroy();encryption.dispose()}
`;
try {
  await writeFile(join(root, "old-fixture.ts"), oldSource);
  await writeFile(join(root, "plugin.zip"), bundle);
  const env: Record<string, string> = {
    DOCA_DATABASE: driver,
    DOCA_CREDENTIAL_MASTER_KEY: key,
    DOCA_FILE_STORE_ID: "local",
    DOCA_FILE_STORES_JSON: JSON.stringify({
      version: 1,
      stores: { local: { provider: "local", root: "/fixture/objects" } },
    }),
  };
  if (driver === "postgres") {
    const url = new URL(process.env.DOCA_TEST_POSTGRES!);
    admin = new Pool({ connectionString: url.href, max: 1 });
    coreName = "doca_upgrade_" + randomUUID().replaceAll("-", "");
    businessName = "doca_upgrade_" + randomUUID().replaceAll("-", "");
    oldBusinessName = "doca_upgrade_" + randomUUID().replaceAll("-", "");
    role = businessName + "_role";
    await admin.query(`create database ${coreName}`);
    owned.push(coreName);
    await admin.query(`create role ${role} login password '${key}'`);
    await admin.query(`create database ${businessName} owner ${role}`);
    owned.push(businessName);
    await admin.query(`create database ${oldBusinessName} owner ${role}`);
    owned.push(oldBusinessName);
    url.pathname = "/" + coreName;
    main = { driver: "postgres", url: url.href };
    const containerUrl = new URL(url);
    if (["127.0.0.1", "localhost"].includes(containerUrl.hostname))
      containerUrl.hostname = "host.docker.internal";
    env.DOCA_DATABASE_URL = containerUrl.href;
    const oldUrl = new URL(containerUrl);
    oldUrl.pathname = "/" + oldBusinessName;
    oldUrl.username = role;
    oldUrl.password = key;
    env.DOCA_PLUGIN_DATABASES_JSON = JSON.stringify({
      version: 1,
      databases: { [id]: { url: oldUrl.href, poolMax: 2 } },
    });
  } else main = { driver: "sqlite", path: join(root, "core.db") };
  await writeFile(
    join(root, "old.env"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  const old = async (action: "create" | "verify" | "uninstall") => {
    const result = await exec(
      "docker",
      [
        "run",
        "--rm",
        "--user",
        "0",
        "--env-file",
        join(root, "old.env"),
        "-e",
        `DOCA_FIXTURE_ACTION=${action}`,
        "-v",
        `${resolve(root)}:/fixture`,
        "-v",
        `${resolve(root, "old-fixture.ts")}:/app/plugin-isolation-old-fixture.ts:ro`,
        image,
        "node",
        "--import",
        "tsx",
        "plugin-isolation-old-fixture.ts",
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    process.stdout.write(result.stdout);
  };
  await old("create");
  await assert.rejects(openDatabase(main), /schema changes require review/);
  console.log(
    "Working tree rejected residual 0.1.25 installations without changing their declarations or core data",
  );
  await old("verify");
  await old("uninstall");
  const db = await openDatabase(main);
  try {
    const expected = JSON.parse(
      await readFile(join(root, "core-snapshot.json"), "utf8"),
    );
    for (const [name, rows] of Object.entries(expected))
      assert.deepEqual(
        await db
          .selectFrom(name as any)
          .selectAll()
          .execute(),
        rows,
      );
    assert(
      !(await currentSchemaTables(db)).some((t) =>
        /^plugin_[a-f0-9]{56}$/.test(t.name),
      ),
    );
    if (main.driver === "postgres") {
      const url = new URL(main.url);
      url.pathname = "/" + businessName;
      url.username = role!;
      url.password = key;
      configurePluginDatabases(db, {
        driver: "postgres",
        url: url.href,
        poolMax: 2,
      });
    } else
      configurePluginDatabases(db, {
        driver: "sqlite",
        path: join(root, "shared-plugins.db"),
      });
    const runtime = storageRuntime({
        DOCA_FILE_STORE_ID: "local",
        DOCA_FILE_STORES_JSON: JSON.stringify({
          version: 1,
          stores: { local: { provider: "local", root: join(root, "objects") } },
        }),
      }),
      files = createHostFileStore(runtime),
      manager = new PluginManager(
        join(root, "plugins"),
        [],
        db,
        undefined,
        files,
      );
    await manager.install(bundle, "local");
    const storage = await bindPluginStorage(db, files, id, "1");
    await storage.database.defineSchema(schema);
    assert.deepEqual(await storage.database.select("notes"), []);
    await storage.database.insert("notes", [
      { id: "new", text: "new shared business data" },
    ]);
    assert.equal((await storage.database.select("notes")).length, 1);
    assert(
      !(await currentSchemaTables(db)).some(
        (t) => t.name === "notes" || /^plugin_[a-f0-9]{56}$/.test(t.name),
      ),
    );
    console.log(
      `${driver}: released-image uninstall → upgrade → reinstall passed; core data retained, business store starts empty`,
    );
  } finally {
    await db.destroy();
  }
} finally {
  if (admin) {
    try {
      for (const name of owned.reverse())
        await admin.query(`drop database ${name} with (force)`);
      if (role) await admin.query(`drop role ${role}`);
    } finally {
      await admin.end();
    }
  }
  await rm(root, { recursive: true, force: true });
}
