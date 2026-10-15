import { testBookPayloadStore } from "./book-payload-store.js";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { openDatabase, type DatabaseConfig } from "@db/connection.js";
import {
  configurePluginDatabases,
  pluginDatabases,
  pluginDatabaseConfig,
} from "@server/services/plugin-databases.js";

/** Dedicated databases and restricted roles for plugin fixtures, never user databases. */
function testPluginDatabases(
  db: Awaited<ReturnType<typeof openDatabase>>,
  testUrl: string,
) {
  const config = {
    driver: "postgres" as const,
    databases: {} as Record<string, { url: string; poolMax: number }>,
  };
  configurePluginDatabases(db, config);
  const host = pluginDatabases(db),
    open = host.open.bind(host);
  const provisions = new Map<string, Promise<void>>();
  const owned: { name: string; role: string }[] = [];
  const admin = new Pool({ connectionString: testUrl, max: 1 });
  host.open = async (id, mustExist, coreConnection) => {
    let pending = provisions.get(id);
    if (!pending) {
      pending = (async () => {
        const name = "doca_test_plugin_" + randomUUID().replaceAll("-", ""),
          role = name + "_role",
          password = randomUUID().replaceAll("-", "");
        await admin.query(`create role ${role} login password '${password}'`);
        owned.push({ name, role });
        await admin.query(`create database ${name} owner ${role}`);
        const url = new URL(testUrl);
        url.pathname = "/" + name;
        url.username = role;
        url.password = password;
        url.searchParams.delete("options");
        config.databases[id] = { url: url.href, poolMax: 2 };
      })();
      provisions.set(id, pending);
    }
    await pending;
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
          await Promise.allSettled([...provisions.values()]);
          for (const { name, role } of owned) {
            await admin.query(`drop database if exists ${name} with (force)`);
            await admin.query(`drop role ${role}`);
          }
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
    // Never inherit a deployment's plugin database directory or credentials.
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
