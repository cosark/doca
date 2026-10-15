import { expect, it, afterEach } from "vitest";
import { mkdtemp, rm, unlink, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, databaseConfig } from "@db/connection.js";
import { openTestDatabase } from "./database.js";
import { Pool } from "pg";
import Sqlite from "better-sqlite3";
import { sql } from "kysely";
import type { DB } from "@db/index.js";
import {
  bindPluginStorage,
  installPluginStorage,
} from "@server/services/plugin-storage.js";
import {
  pluginDatabaseConfig,
  configurePluginDatabases,
  pluginDatabases,
  pluginDatabaseNamespace,
  pluginDatabaseTables,
  PluginDatabases,
} from "@server/services/plugin-databases.js";
import { createHostFileStore } from "@server/services/host-file-store.js";
import { storageRuntime } from "@server/adapters/storage.js";
const dirs: string[] = [],
  dbs: DB[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0).reverse()) await db.destroy();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "rejects core-database targets and roles with core-table privileges",
  async () => {
    const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
    dbs.push(db);
    const host = pluginDatabases(db);
    await host.open("example.restricted", false);
    if (host.config.driver !== "postgres")
      throw new Error("Expected PostgreSQL fixture");
    const entry = host.config;
    const main = databaseConfig(db);
    if (main.driver !== "postgres")
      throw new Error("Expected PostgreSQL fixture");
    const coreTarget = new URL(entry.url!);
    coreTarget.pathname = new URL(main.url).pathname;
    const wrong = new PluginDatabases(db, {
      driver: "postgres",
      url: coreTarget.href,
      poolMax: 1,
    });
    await expect(wrong.open("example.restricted", false)).rejects.toThrow(
      "separate from the core",
    );
    await wrong.close();
    const role = decodeURIComponent(new URL(entry.url!).username);
    if (!/^doca_test_plugin_[a-f0-9]+_role$/.test(role))
      throw new Error("Expected a fixture-owned role");
    const control = new Pool({ connectionString: main.url, max: 1 });
    const unsafe = new PluginDatabases(db, host.config);
    try {
      await control.query(`grant select on users to ${role}`);
      await expect(unsafe.open("example.restricted", false)).rejects.toThrow(
        "must not have access to core tables",
      );
    } finally {
      await unsafe.close();
      await control.query(`revoke select on users from ${role}`);
      await control.end();
    }
  },
);
const schema = {
  version: 1 as const,
  tables: {
    notes: {
      columns: { id: { type: "text" as const, nullable: false } },
      primaryKey: ["id"],
      unique: [],
    },
  },
};
it("configures one shared store, rejects obsolete settings and redacts invalid URLs", () => {
  const main = {
    driver: "postgres" as const,
    url: "postgres://core:secret@localhost/core",
  };
  expect(pluginDatabaseConfig(main, {})).toEqual({
    driver: "postgres",
    url: null,
    poolMax: 4,
  });
  expect(
    pluginDatabaseConfig(main, {
      DOCA_PLUGIN_DATABASE_URL: "postgres://plugins:secret@localhost/business",
      DOCA_PLUGIN_DATABASE_POOL_MAX: "2",
    }),
  ).toEqual({
    driver: "postgres",
    url: "postgres://plugins:secret@localhost/business",
    poolMax: 2,
  });
  const secret = "secret-that-must-not-be-logged";
  for (const name of [
    "DOCA_PLUGIN_DATABASES_JSON",
    "DOCA_PLUGIN_DATABASE_DIR",
  ]) {
    expect(() => pluginDatabaseConfig(main, { [name]: secret })).toThrow(
      "Per-plugin database configuration is obsolete",
    );
  }
  for (const value of [
    secret,
    "postgres://role:secret@localhost/business?options=-csearch_path=other",
    "https://role:secret@localhost/business",
    "",
  ]) {
    try {
      pluginDatabaseConfig(main, { DOCA_PLUGIN_DATABASE_URL: value });
      throw Error("Expected rejection");
    } catch (error) {
      expect(String(error)).toBe(
        "Error: DOCA_PLUGIN_DATABASE_URL must be a PostgreSQL URL for the shared plugin database",
      );
    }
  }
  for (const limit of ["", "0", "21", "1.5", "NaN"])
    expect(() =>
      pluginDatabaseConfig(main, { DOCA_PLUGIN_DATABASE_POOL_MAX: limit }),
    ).toThrow("integer from 1 to 20");
  expect(
    pluginDatabaseConfig({ driver: "sqlite", path: "/tmp/core.db" }, {}),
  ).toEqual({ driver: "sqlite", path: "/tmp/core.db.plugins.db" });
});
it("refuses lost SQLite business databases instead of silently recreating them", async () => {
  const root = await mkdtemp(join(tmpdir(), "doca-plugin-databases-"));
  dirs.push(root);
  const path = join(root, "core.db"),
    businessPath = join(root, "plugins.db");
  const db = await openDatabase({ driver: "sqlite", path });
  dbs.push(db);
  configurePluginDatabases(db, { driver: "sqlite", path: businessPath });
  const files = createHostFileStore({ ...storageRuntime(), root });
  await db
    .transaction()
    .execute((tx) => installPluginStorage(tx, "example.loss", "1"));
  const storage = await bindPluginStorage(db, files, "example.loss", "1");
  await storage.database.defineSchema(schema);
  await unlink(businessPath);
  await expect(storage.database.select("notes")).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(storage.database.defineSchema(schema)).rejects.toMatchObject({
    code: "unavailable",
  });
  await db.destroy();
  const restarted = await openDatabase({ driver: "sqlite", path });
  dbs.push(restarted);
  configurePluginDatabases(restarted, {
    driver: "sqlite",
    path: businessPath,
  });
  const next = await bindPluginStorage(restarted, files, "example.loss", "1");
  await expect(next.database.defineSchema(schema)).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(next.database.select("notes")).rejects.toMatchObject({
    code: "unavailable",
  });
  // A newly installed plugin must not recreate a lost shared store before the
  // original plugin happens to open it after restart.
  await restarted
    .transaction()
    .execute((tx) => installPluginStorage(tx, "example.new", "1"));
  const newcomer = await bindPluginStorage(
    restarted,
    files,
    "example.new",
    "1",
  );
  await expect(newcomer.database.defineSchema(schema)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(
    await restarted
      .selectFrom("plugin_storage_namespaces")
      .select("generation")
      .where("plugin_id", "=", "example.loss")
      .executeTakeFirstOrThrow(),
  ).toEqual({ generation: 1 });
});
it("refuses a plugin database symlink to the core before opening or modifying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "doca-plugin-databases-"));
  dirs.push(root);
  const path = join(root, "core.db");
  const db = await openDatabase({ driver: "sqlite", path });
  dbs.push(db);
  const businessPath = join(root, "plugins.db");
  configurePluginDatabases(db, { driver: "sqlite", path: businessPath });
  await symlink(path, businessPath);
  await expect(
    pluginDatabases(db).open("example.alias", false),
  ).rejects.toThrow("separate from the core");
});

it("stores different plugins in one SQLite file and reopens it without changing their data", async () => {
  const root = await mkdtemp(join(tmpdir(), "doca-shared-plugins-"));
  dirs.push(root);
  const path = join(root, "core.db"),
    businessPath = join(root, "plugins.db");
  const core = await openDatabase({ driver: "sqlite", path });
  dbs.push(core);
  configurePluginDatabases(core, { driver: "sqlite", path: businessPath });
  const files = createHostFileStore({ ...storageRuntime(), root });
  for (const id of ["example.left", "example.right"]) {
    await core.transaction().execute((tx) => installPluginStorage(tx, id, "1"));
    const storage = await bindPluginStorage(core, files, id, "1");
    await storage.database.defineSchema(schema);
    await storage.database.insert("notes", [{ id }]);
  }
  await core.destroy();
  const raw = new Sqlite(businessPath, { readonly: true });
  try {
    const names = (
      raw
        .prepare(
          "select name from sqlite_schema where type='table' order by name",
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    expect(names).toEqual(
      [
        "_doca_shared_plugin_database",
        ...["example.left", "example.right"].flatMap((id) => [
          pluginDatabaseNamespace(id) + "___doca_plugin_store",
          pluginDatabaseNamespace(id) + "__notes",
        ]),
      ].sort(),
    );
  } finally {
    raw.close();
  }
  expect((await readdir(root)).filter((n) => n.endsWith(".db"))).toEqual([
    "core.db",
    "plugins.db",
  ]);
  const restarted = await openDatabase({ driver: "sqlite", path });
  dbs.push(restarted);
  configurePluginDatabases(restarted, { driver: "sqlite", path: businessPath });
  for (const id of ["example.left", "example.right"]) {
    const storage = await bindPluginStorage(restarted, files, id, "1");
    await storage.database.defineSchema(schema);
    expect(await storage.database.select("notes")).toEqual([{ id }]);
  }
});
it("rejects an unrelated SQLite database without changing its tables or rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "doca-shared-plugins-"));
  dirs.push(root);
  const path = join(root, "business.db"),
    raw = new Sqlite(path);
  raw.exec(
    "create table retained (id text primary key); insert into retained values ('keep')",
  );
  raw.close();
  const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
  dbs.push(db);
  configurePluginDatabases(db, { driver: "sqlite", path });
  await expect(pluginDatabases(db).open("example.a", false)).rejects.toThrow(
    "unknown tables",
  );
  const check = new Sqlite(path, { readonly: true });
  try {
    expect(check.prepare("select * from retained").all()).toEqual([
      { id: "keep" },
    ]);
    expect(
      check.prepare("select name from sqlite_schema where type='table'").all(),
    ).toEqual([{ name: "retained" }]);
  } finally {
    check.close();
  }
});
it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "shares one PostgreSQL connection across plugin schemas without leaking search_path",
  async () => {
    const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
    dbs.push(db);
    const host = pluginDatabases(db);
    host.config.driver === "postgres" && (host.config.poolMax = 1);
    const [left, right] = await Promise.all([
      host.open("example.left", false),
      host.open("example.right", false),
    ]);
    const query = async (handle: typeof left, id: string) =>
      handle.transaction().execute(async (tx) => {
        const { rows } = await sql<{
          pid: number;
          schema: string;
        }>`select pg_backend_pid() as pid,current_schema() as schema`.execute(
          tx,
        );
        expect(rows[0]!.schema).toBe(pluginDatabaseNamespace(id));
        return rows[0]!.pid;
      });
    const pids = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        query(i % 2 ? left : right, i % 2 ? "example.left" : "example.right"),
      ),
    );
    expect(new Set(pids).size).toBe(1);
    expect(await pluginDatabaseTables(left)).toEqual([]);
    // Cached handles must recheck the requirement after the initial creation.
    await host.open("example.left", true);
    await sql`drop schema ${sql.id(pluginDatabaseNamespace("example.left"))}`.execute(
      right,
    );
    await expect(left.transaction().execute(async () => {})).rejects.toThrow(
      "will not be recreated",
    );
    await expect(host.open("example.left", true)).rejects.toThrow(
      "will not be recreated",
    );
  },
);
