import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { openDatabase } from "@db/connection.js";
import {
  configurePluginDatabases,
  pluginDatabaseNamespace,
} from "@server/services/plugin-databases.js";
import {
  bindPluginStorage,
  installPluginStorage,
} from "@server/services/plugin-storage.js";
import { createHostFileStore } from "@server/services/host-file-store.js";
import { storageRuntime } from "@server/adapters/storage.js";

it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "uses the same administrator login for separate core and plugin databases across restarts",
  async () => {
    const testUrl = process.env.DOCA_TEST_POSTGRES!;
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    const name = "doca_admin_store_" + randomUUID().replaceAll("-", "");
    const coreUrl = new URL(testUrl);
    coreUrl.searchParams.set("options", "-csearch_path=" + name);
    const businessUrl = new URL(testUrl);
    businessUrl.pathname = "/" + name;
    businessUrl.searchParams.delete("options");
    const config = {
      driver: "postgres" as const,
      url: businessUrl.href,
      poolMax: 1,
    };
    const open = async () => {
      const db = await openDatabase({
        driver: "postgres",
        url: coreUrl.href,
        schema: name,
      });
      configurePluginDatabases(db, config);
      return db;
    };
    let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
    const id = "example.admin";
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
    try {
      await admin.query(`create schema ${name}`);
      await admin.query(`create database ${name}`);
      db = await open();
      await db.transaction().execute((tx) => installPluginStorage(tx, id, "1"));
      const files = createHostFileStore(storageRuntime());
      const first = await bindPluginStorage(db, files, id, "1");
      await first.database.defineSchema(schema);
      await first.database.insert("notes", [{ id: "admin-retained" }]);
      await db.destroy();
      db = await open();
      const restarted = await bindPluginStorage(db, files, id, "1");
      await restarted.database.defineSchema(schema);
      expect(await restarted.database.select("notes")).toEqual([
        { id: "admin-retained" },
      ]);
    } finally {
      try {
        await db?.destroy();
      } finally {
        try {
          await admin.query(`drop database if exists ${name} with (force)`);
          await admin.query(`drop schema if exists ${name} cascade`);
        } finally {
          await admin.end();
        }
      }
    }
  },
);

it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "diagnoses missing PostgreSQL grants and retries without changing stored data",
  async () => {
    const testUrl = process.env.DOCA_TEST_POSTGRES!;
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    const name = "doca_permissions_" + randomUUID().replaceAll("-", "");
    const coreName = name + "_core",
      role = name + "_role",
      coreRole = name + "_core_login";
    const password = randomUUID();
    const businessUrl = new URL(testUrl);
    businessUrl.pathname = "/" + name;
    businessUrl.searchParams.delete("options");
    const control = new Pool({ connectionString: businessUrl.href, max: 1 });
    const coreUrl = new URL(testUrl);
    coreUrl.pathname = "/" + coreName;
    coreUrl.searchParams.delete("options");
    coreUrl.username = coreRole;
    coreUrl.password = password;
    const target = new URL(businessUrl);
    target.username = role;
    target.password = password;
    const config = {
      driver: "postgres" as const,
      url: null as string | null,
      poolMax: 1,
    };
    let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
    try {
      await admin.query(`create role ${role} login password '${password}'`);
      await admin.query(`create role ${coreRole} login password '${password}'`);
      await admin.query(`create database ${coreName} owner ${coreRole}`);
      // An operator can grant schema creation without making the login the
      // business database owner. PostgreSQL 17/18 do not then grant public CREATE.
      await admin.query(`create database ${name}`);
      await admin.query(`grant connect, create on database ${name} to ${role}`);
      db = await openDatabase({ driver: "postgres", url: coreUrl.href });
      configurePluginDatabases(db, config);
      const id = "example.permissions";
      await db.transaction().execute((tx) => installPluginStorage(tx, id, "1"));
      const files = createHostFileStore(storageRuntime());
      const storage = await bindPluginStorage(db, files, id, "1");
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
      const before = await db
        .selectFrom("plugin_storage_namespaces")
        .selectAll()
        .execute();
      await expect(storage.database.defineSchema(schema)).rejects.toMatchObject(
        {
          code: "unavailable",
          message:
            "Configure DOCA_PLUGIN_DATABASE_URL once for all SQL plugins",
        },
      );
      config.url = target.href;
      for (const revokeUsage of [false, true]) {
        if (revokeUsage)
          await control.query("revoke usage on schema public from public");
        await expect(
          storage.database.defineSchema(schema),
        ).rejects.toMatchObject({
          code: "unavailable",
          message: expect.stringContaining(
            "requires USAGE and CREATE on schema public",
          ),
        });
        expect(
          await db
            .selectFrom("plugin_storage_namespaces")
            .selectAll()
            .execute(),
        ).toEqual(before);
        expect(
          (
            await control.query(
              "select tablename from pg_tables where schemaname='public'",
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await control.query(
              "select nspname from pg_namespace where nspname=$1",
              [pluginDatabaseNamespace(id)],
            )
          ).rows,
        ).toEqual([]);
      }
      await control.query(`grant usage, create on schema public to ${role}`);
      await admin.query(`revoke create on database ${name} from ${role}`);
      await expect(storage.database.defineSchema(schema)).rejects.toMatchObject(
        {
          code: "unavailable",
          message: expect.stringContaining(
            "requires CREATE on the plugin database",
          ),
        },
      );
      expect(
        await db.selectFrom("plugin_storage_namespaces").selectAll().execute(),
      ).toEqual(before);
      await admin.query(`grant create on database ${name} to ${role}`);
      await storage.database.defineSchema(schema);
      await storage.database.insert("notes", [{ id: "retained" }]);
      await db.destroy();
      // Existing markers do not need a new grant to create tables in public.
      await control.query(`revoke create on schema public from ${role}`);
      db = await openDatabase({ driver: "postgres", url: coreUrl.href });
      configurePluginDatabases(db, config);
      const restarted = await bindPluginStorage(db, files, id, "1");
      await restarted.database.defineSchema(schema);
      expect(await restarted.database.select("notes")).toEqual([
        { id: "retained" },
      ]);
    } finally {
      await db?.destroy();
      await control.end();
      try {
        await admin.query(`drop database if exists ${name} with (force)`);
        await admin.query(`drop database if exists ${coreName} with (force)`);
        await admin.query(`drop role if exists ${role}`);
        await admin.query(`drop role if exists ${coreRole}`);
      } finally {
        await admin.end();
      }
    }
  },
);
