import { testBookPayloadStore } from "./book-payload-store.js";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  databaseConfig,
  openDatabase,
  type DatabaseConfig,
} from "@db/connection.js";
import {
  configurePluginDatabases,
  pluginDatabases,
  pluginDatabaseConfig,
} from "@server/services/plugin-databases.js";

/** Inspect the fixture's own columns without resolving other fixtures' relations. */
export async function testTableColumns(
  db: Awaited<ReturnType<typeof openDatabase>>,
): Promise<{ name: string; columns: { name: string }[] }[]> {
  if (databaseConfig(db).driver === "sqlite")
    return db.introspection.getTables();
  // Kysely's global PostgreSQL introspector calls pg_get_serial_sequence on
  // every visible schema. Parallel fixtures can drop those unrelated schemas
  // during that query. These assertions only need this fixture's names.
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = current_schema()
    order by table_name, ordinal_position
  `.execute(db);
  const tables = new Map<
    string,
    { name: string; columns: { name: string }[] }
  >();
  for (const row of rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [] };
      tables.set(row.table_name, table);
    }
    table.columns.push({ name: row.column_name });
  }
  return [...tables.values()];
}

/** One dedicated shared plugin database and restricted role per fixture. */
function testPluginDatabases(
  db: Awaited<ReturnType<typeof openDatabase>>,
  testUrl: string,
) {
  const config = {
    driver: "postgres" as const,
    url: null as string | null,
    poolMax: 2,
  };
  configurePluginDatabases(db, config);
  const host = pluginDatabases(db),
    open = host.open.bind(host);
  const admin = new Pool({ connectionString: testUrl, max: 1 });
  const name = "doca_test_plugin_" + randomUUID().replaceAll("-", ""),
    role = name + "_role";
  let provision: Promise<void> | undefined,
    roleCreated = false;
  host.open = async (id, mustExist, coreConnection) => {
    provision ??= (async () => {
      const password = randomUUID().replaceAll("-", "");
      await admin.query(`create role ${role} login password '${password}'`);
      roleCreated = true;
      await admin.query(`create database ${name} owner ${role}`);
      const url = new URL(testUrl);
      url.pathname = "/" + name;
      url.username = role;
      url.password = password;
      url.searchParams.delete("options");
      config.url = url.href;
    })();
    await provision;
    return open(id, mustExist, coreConnection);
  };
  const destroy = db.destroy.bind(db);
  let closing: Promise<void> | undefined;
  db.destroy = () =>
    (closing ??= (async () => {
      try {
        await destroy();
      } finally {
        try {
          await provision?.catch(() => {});
          await admin.query(`drop database if exists ${name} with (force)`);
          if (roleCreated) await admin.query(`drop role ${role}`);
        } finally {
          await admin.end();
        }
      }
    })());
}
/** Each PostgreSQL fixture owns an isolated schema; never run tests in user data. */
export async function openTestDatabase(config: DatabaseConfig) {
  const testUrl = process.env.DOCA_TEST_POSTGRES;
  if (!testUrl || config.driver !== "sqlite" || config.path !== ":memory:") {
    const db = await openDatabase(config);
    testBookPayloadStore(db);
    // Never inherit a deployment's shared plugin database path or credentials.
    configurePluginDatabases(db, pluginDatabaseConfig(config, {}));
    return db;
  }
  const schema = "doca_test_" + randomUUID().replaceAll("-", "");
  const control = new Pool({ connectionString: testUrl, max: 1 });
  // Serialize fixture DDL so another fixture cannot drop a catalog object while
  // a new schema is being created.
  await control.query("select pg_advisory_lock(741093215)");
  await control.query(`create schema ${schema}`);
  const url = new URL(testUrl);
  url.searchParams.set("options", "-csearch_path=" + schema);
  try {
    const db = await openDatabase({
      driver: "postgres",
      url: url.href,
      schema,
    });
    testBookPayloadStore(db);
    await control.query("select pg_advisory_unlock(741093215)");
    testPluginDatabases(db, testUrl);
    const destroy = db.destroy.bind(db);
    let closing: Promise<void> | undefined;
    db.destroy = () =>
      (closing ??= (async () => {
        try {
          await destroy();
          await control.query("select pg_advisory_lock(741093215)");
          await control.query(`drop schema if exists ${schema} cascade`);
        } finally {
          await control.end();
        }
      })());
    return db;
  } catch (error) {
    await control.query(`drop schema if exists ${schema} cascade`);
    await control.end();
    throw error;
  }
}
