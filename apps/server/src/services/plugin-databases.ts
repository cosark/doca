import Sqlite from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect, sql } from "kysely";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, statSync, chmodSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  databaseConfig,
  onDatabaseClose,
  type DatabaseConfig,
} from "@db/connection.js";
import { databaseRuntimeScope } from "@db/runtime-scope.js";
import { registerDriver } from "@db/transactions.js";
import type { DB } from "@db/index.js";
import { createPluginStorageNamespace } from "./plugin-storage-namespaces.js";

export type PluginDatabaseConfig =
  | { driver: "sqlite"; directory: string | null }
  | {
      driver: "postgres";
      databases: Record<string, { url: string; poolMax: number }>;
    };

const postgresConfig = z
  .object({
    version: z.literal(1),
    databases: z.record(
      z.string(),
      z
        .object({
          url: z.string().min(1),
          poolMax: z.number().int().min(1).max(20),
        })
        .strict(),
    ),
  })
  .strict();

/** Host configuration only. There is no fallback to the core connection. */
export function pluginDatabaseConfig(
  main: DatabaseConfig,
  env: NodeJS.ProcessEnv = process.env,
): PluginDatabaseConfig {
  if (main.driver === "sqlite") {
    if (env.DOCA_PLUGIN_DATABASES_JSON !== undefined)
      throw new Error("DOCA_PLUGIN_DATABASES_JSON requires PostgreSQL");
    const directory = env.DOCA_PLUGIN_DATABASE_DIR;
    if (directory !== undefined && !directory.trim())
      throw new Error("DOCA_PLUGIN_DATABASE_DIR must not be empty");
    return {
      driver: "sqlite",
      directory: directory
        ? resolve(directory)
        : main.path === ":memory:"
          ? null
          : join(dirname(resolve(main.path)), basename(main.path) + ".plugins"),
    };
  }
  if (env.DOCA_PLUGIN_DATABASE_DIR !== undefined)
    throw new Error("DOCA_PLUGIN_DATABASE_DIR requires SQLite");
  if (env.DOCA_PLUGIN_DATABASES_JSON === undefined)
    return { driver: "postgres", databases: {} };
  try {
    const parsed = postgresConfig.parse(
      JSON.parse(env.DOCA_PLUGIN_DATABASES_JSON),
    );
    const targets = new Set<string>(),
      roles = new Set<string>();
    for (const [id, entry] of Object.entries(parsed.databases)) {
      createPluginStorageNamespace(id);
      const url = new URL(entry.url);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.username ||
        !url.pathname.slice(1) ||
        url.searchParams.has("options") ||
        url.hash
      )
        throw new Error("Invalid plugin database URL");
      const target = `${url.hostname}:${url.port || "5432"}${url.pathname}`;
      if (targets.has(target))
        throw new Error("Plugins must use distinct databases");
      targets.add(target);
      const role = `${url.hostname}:${url.port || "5432"}/${decodeURIComponent(url.username)}`;
      if (roles.has(role)) throw new Error("Plugins must use distinct roles");
      roles.add(role);
    }
    for (const entry of Object.values(parsed.databases)) Object.freeze(entry);
    return { driver: "postgres", databases: Object.freeze(parsed.databases) };
  } catch {
    throw new Error(
      "DOCA_PLUGIN_DATABASES_JSON must declare version 1 and distinct PostgreSQL databases and roles with url and poolMax",
    );
  }
}

/** Tests and embedders may supply host configuration before opening any plugin pool. */
export function configurePluginDatabases(db: DB, config: PluginDatabaseConfig) {
  const scope = databaseRuntimeScope(db);
  if (scope.has("plugin.databases"))
    throw new Error("Plugin databases are already configured");
  scope.set("plugin.database.config", config);
}

export function pluginDatabasePath(directory: string, id: string) {
  createPluginStorageNamespace(id);
  return join(directory, createHash("sha256").update(id).digest("hex") + ".db");
}

export class PluginDatabases {
  private pools = new Map<string, Promise<Kysely<any>>>();
  private identities = new Map<
    string,
    {
      database: string;
      address: string | null;
      port: number | null;
      role: string;
    }
  >();
  private closed = false;
  constructor(
    private readonly core: DB,
    readonly config: PluginDatabaseConfig,
  ) {}

  async open(
    id: string,
    mustExist: boolean,
    coreConnection: Kysely<any> = this.core,
  ): Promise<Kysely<any>> {
    createPluginStorageNamespace(id);
    if (this.closed) throw new Error("Plugin databases are closed");
    const previous = this.pools.get(id);
    if (
      this.config.driver === "sqlite" &&
      this.config.directory &&
      (mustExist || previous) &&
      !existsSync(pluginDatabasePath(this.config.directory, id))
    )
      throw new Error(
        "Plugin database file is missing; it will not be recreated",
      );
    if (previous) return previous;
    const pending = this.connect(id, mustExist, coreConnection).catch(
      (error) => {
        this.pools.delete(id);
        throw error;
      },
    );
    this.pools.set(id, pending);
    return pending;
  }

  async existing(id: string, coreConnection: Kysely<any>) {
    const previous = this.pools.get(id);
    if (previous) return this.open(id, true, coreConnection);
    if (
      this.config.driver === "sqlite" &&
      (!this.config.directory ||
        !existsSync(pluginDatabasePath(this.config.directory, id)))
    )
      return undefined;
    if (this.config.driver === "postgres" && !this.config.databases[id])
      return undefined;
    return this.open(id, true, coreConnection);
  }

  private async connect(
    id: string,
    mustExist: boolean,
    coreConnection: Kysely<any>,
  ) {
    let db: Kysely<any>;
    if (this.config.driver === "sqlite") {
      const path = this.config.directory
        ? pluginDatabasePath(this.config.directory, id)
        : ":memory:";
      if (this.config.directory)
        mkdirSync(this.config.directory, { recursive: true, mode: 0o700 });
      const main = databaseConfig(this.core);
      if (
        main.driver !== "sqlite" ||
        (path !== ":memory:" && resolve(path) === resolve(main.path))
      )
        throw new Error(
          "Plugin database must be separate from the core database",
        );
      if (
        path !== ":memory:" &&
        main.path !== ":memory:" &&
        existsSync(path) &&
        existsSync(main.path)
      ) {
        const target = statSync(path),
          core = statSync(main.path);
        if (target.dev === core.dev && target.ino === core.ino)
          throw new Error(
            "Plugin database must be separate from the core database",
          );
      }
      const sqlite = new Sqlite(path, {
        fileMustExist: mustExist && path !== ":memory:",
      });
      try {
        if (path !== ":memory:") chmodSync(path, 0o600);
        sqlite.pragma("journal_mode = WAL");
        sqlite.pragma("foreign_keys = ON");
        sqlite.pragma("busy_timeout = 5000");
        sqlite.pragma("synchronous = FULL");
        db = new Kysely<any>({
          dialect: new SqliteDialect({ database: sqlite }),
        });
      } catch (error) {
        sqlite.close();
        throw error;
      }
      registerDriver(db as DB, "sqlite");
    } else {
      const config = this.config.databases[id];
      if (!config)
        throw new Error(
          `Configure an independent PostgreSQL database for plugin ${id}`,
        );
      const pool = new Pool({
        connectionString: config.url,
        max: config.poolMax,
        options: "-csearch_path=public",
        connectionTimeoutMillis: 5000,
      });
      pool.on("error", () => {
        if (!this.closed)
          process.emitWarning(`Plugin database connection lost: ${id}`);
      });
      db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
      registerDriver(db as DB, "postgres");
      try {
        const identity = (
          await sql<{
            database: string;
            address: string | null;
            port: number | null;
            role: string;
            elevated: boolean;
            member: boolean;
          }>`select current_database() as database,
          inet_server_addr()::text as address, inet_server_port() as port, current_user as role,
          (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls) as elevated,
          exists(select 1 from pg_auth_members where member = r.oid) as member
          from pg_roles r where rolname = current_user`.execute(db)
        ).rows[0]!;
        if (identity.elevated || identity.member)
          throw new Error(
            "Plugin database requires a restricted role without elevated privileges or role membership",
          );
        const main = databaseConfig(this.core);
        if (main.driver !== "postgres")
          throw new Error("Plugin and core database drivers differ");
        const core = (
          await sql<{
            database: string;
            address: string | null;
            port: number | null;
          }>`
          select current_database() as database, inet_server_addr()::text as address,
          inet_server_port() as port`.execute(coreConnection)
        ).rows[0]!;
        if (core.address === identity.address && core.port === identity.port) {
          if (core.database === identity.database)
            throw new Error(
              "Plugin database must be separate from the core database",
            );
          const access = await sql<{ allowed: boolean }>`select exists(
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = current_schema() and c.relkind in ('r', 'p', 'v')
            and has_table_privilege(${identity.role}, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          ) as allowed`.execute(coreConnection);
          if (access.rows[0]!.allowed)
            throw new Error(
              "Plugin database role must not have access to core tables",
            );
        }
        for (const [otherId, other] of this.identities) {
          if (
            otherId !== id &&
            other.address === identity.address &&
            other.port === identity.port &&
            (other.database === identity.database ||
              other.role === identity.role)
          )
            throw new Error(
              "Plugins must use distinct PostgreSQL databases and roles",
            );
        }
        this.identities.set(id, identity);
      } catch (error) {
        await db.destroy();
        throw error;
      }
    }
    return db;
  }

  async close() {
    this.closed = true;
    const pending = [...this.pools.values()];
    this.pools.clear();
    this.identities.clear();
    await Promise.all(
      pending.map(async (pool) => {
        const db = await pool.catch(() => undefined);
        await db?.destroy();
      }),
    );
  }
}

export function pluginDatabases(db: DB) {
  const scope = databaseRuntimeScope(db);
  let host = scope.get("plugin.databases") as PluginDatabases | undefined;
  if (!host) {
    const config = scope.get("plugin.database.config") as
      PluginDatabaseConfig | undefined;
    host = new PluginDatabases(
      db,
      config ?? pluginDatabaseConfig(databaseConfig(db)),
    );
    scope.set("plugin.databases", host);
    onDatabaseClose(db, () => host!.close());
  }
  return host;
}
