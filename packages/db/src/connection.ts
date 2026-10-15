import Sqlite from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { createSchema } from "./create-schema.js";
import type { Schema } from "./schema.js";
import { registerDriver } from "./transactions.js";
import { databaseRuntimeScope } from "./runtime-scope.js";

export type DatabaseConfig =
  | { driver: "sqlite"; path: string }
  | { driver: "postgres"; url: string; schema?: string; poolMax?: number };
export function databaseConfig(db: object): DatabaseConfig {
  const config = databaseRuntimeScope(db).get("database.config") as
    DatabaseConfig | undefined;
  if (!config)
    throw new Error("Database connection configuration is unavailable");
  return config;
}
export function onDatabaseClose(db: object, close: () => Promise<void>) {
  const scope = databaseRuntimeScope(db);
  let callbacks = scope.get("database.close") as
    Set<() => Promise<void>> | undefined;
  if (!callbacks) scope.set("database.close", (callbacks = new Set()));
  callbacks.add(close);
}
export async function openDatabase(config: DatabaseConfig) {
  let dialect;
  if (config.driver === "sqlite") {
    if (config.path !== ":memory:")
      mkdirSync(dirname(resolve(config.path)), { recursive: true });
    const sqlite = new Sqlite(config.path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("synchronous = FULL");
    dialect = new SqliteDialect({ database: sqlite });
  } else
    dialect = new PostgresDialect({
      pool: new Pool({
        connectionString: config.url,
        max: config.poolMax ?? 10,
      }),
    });
  const db = new Kysely<Schema>({ dialect });
  registerDriver(db, config.driver);
  databaseRuntimeScope(db).set("database.config", Object.freeze({ ...config }));
  const destroy = db.destroy.bind(db);
  let closing: Promise<void> | undefined;
  db.destroy = () =>
    (closing ??= (async () => {
      try {
        const callbacks = databaseRuntimeScope(db).get("database.close") as
          Set<() => Promise<void>> | undefined;
        const results = await Promise.allSettled(
          [...(callbacks ?? [])].map((close) => close()),
        );
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      } finally {
        await destroy();
      }
    })());
  try {
    await createSchema(db);
  } catch (error) {
    await db.destroy();
    throw error;
  }
  return db;
}
