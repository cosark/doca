import { expect, it, afterEach } from "vitest";
import { mkdtemp, rm, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, databaseConfig } from "@db/connection.js";
import { openTestDatabase } from "./database.js";
import { Pool } from "pg";
import type { DB } from "@db/index.js";
import {
  bindPluginStorage,
  installPluginStorage,
} from "@server/services/plugin-storage.js";
import {
  pluginDatabaseConfig,
  configurePluginDatabases,
  pluginDatabases,
  pluginDatabasePath,
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
    const entry = host.config.databases["example.restricted"]!;
    const main = databaseConfig(db);
    if (main.driver !== "postgres")
      throw new Error("Expected PostgreSQL fixture");
    const coreTarget = new URL(entry.url);
    coreTarget.pathname = new URL(main.url).pathname;
    const wrong = new PluginDatabases(db, {
      driver: "postgres",
      databases: { "example.restricted": { ...entry, url: coreTarget.href } },
    });
    await expect(wrong.open("example.restricted", false)).rejects.toThrow(
      "separate from the core",
    );
    await wrong.close();
    const role = decodeURIComponent(new URL(entry.url).username);
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
it("requires explicit PostgreSQL plugin targets and redacts invalid connection configuration", () => {
  const main = {
    driver: "postgres" as const,
    url: "postgres://core:secret@localhost/core",
  };
  expect(pluginDatabaseConfig(main, {})).toEqual({
    driver: "postgres",
    databases: {},
  });
  const secret = "secret-that-must-not-be-logged";
  expect(() =>
    pluginDatabaseConfig(main, { DOCA_PLUGIN_DATABASES_JSON: secret }),
  ).toThrow("DOCA_PLUGIN_DATABASES_JSON must declare");
  expect(() =>
    pluginDatabaseConfig(main, {
      DOCA_PLUGIN_DATABASES_JSON: JSON.stringify({
        version: 1,
        databases: {
          "example.a": {
            url: "postgres://role:secret@localhost/business",
            poolMax: 2,
          },
          "example.b": {
            url: "postgresql://role:secret@localhost:5432/business",
            poolMax: 2,
          },
        },
      }),
    }),
  ).toThrow("distinct PostgreSQL databases");
});
it("refuses lost SQLite business databases instead of silently recreating them", async () => {
  const root = await mkdtemp(join(tmpdir(), "doca-plugin-databases-"));
  dirs.push(root);
  const path = join(root, "core.db"),
    businessRoot = join(root, "business");
  const db = await openDatabase({ driver: "sqlite", path });
  dbs.push(db);
  configurePluginDatabases(db, { driver: "sqlite", directory: businessRoot });
  const files = createHostFileStore({ ...storageRuntime(), root });
  await db
    .transaction()
    .execute((tx) => installPluginStorage(tx, "example.loss", "1"));
  const storage = await bindPluginStorage(db, files, "example.loss", "1");
  await storage.database.defineSchema(schema);
  await unlink(pluginDatabasePath(businessRoot, "example.loss"));
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
    directory: businessRoot,
  });
  const next = await bindPluginStorage(restarted, files, "example.loss", "1");
  await expect(next.database.defineSchema(schema)).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(next.database.select("notes")).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(
    await restarted
      .selectFrom("plugin_storage_namespaces")
      .select("generation")
      .executeTakeFirstOrThrow(),
  ).toEqual({ generation: 1 });
});
it("refuses a plugin database symlink to the core before opening or modifying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "doca-plugin-databases-"));
  dirs.push(root);
  const path = join(root, "core.db");
  const db = await openDatabase({ driver: "sqlite", path });
  dbs.push(db);
  configurePluginDatabases(db, { driver: "sqlite", directory: root });
  await symlink(path, pluginDatabasePath(root, "example.alias"));
  await expect(
    pluginDatabases(db).open("example.alias", false),
  ).rejects.toThrow("separate from the core");
});
