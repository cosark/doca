import Sqlite from "better-sqlite3";
import {
  Kysely,
  PostgresDialect,
  SqliteDialect,
  sql,
  OperationNodeTransformer,
  TableNode,
  type KyselyPlugin,
  type Transaction,
} from "kysely";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, statSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  databaseConfig,
  onDatabaseClose,
  type DatabaseConfig,
} from "@db/connection.js";
import { currentSchemaTables } from "@db/introspection.js";
import { databaseRuntimeScope } from "@db/runtime-scope.js";
import { registerDriver, databaseDriver } from "@db/transactions.js";
import type { DB } from "@db/index.js";
import { createPluginStorageNamespace } from "./plugin-storage-namespaces.js";

export type PluginDatabaseConfig =
  | { driver: "sqlite"; path: string }
  | { driver: "postgres"; url: string | null; poolMax: number };

/** One host-managed business store, never a fallback to the core connection. */
export function pluginDatabaseConfig(
  main: DatabaseConfig,
  env: NodeJS.ProcessEnv = process.env,
): PluginDatabaseConfig {
  if (
    env.DOCA_PLUGIN_DATABASES_JSON !== undefined ||
    env.DOCA_PLUGIN_DATABASE_DIR !== undefined
  )
    throw new Error(
      "Per-plugin database configuration is obsolete; uninstall plugins using the previous host, then configure the shared plugin database and reinstall",
    );
  if (main.driver === "sqlite") {
    if (
      env.DOCA_PLUGIN_DATABASE_URL !== undefined ||
      env.DOCA_PLUGIN_DATABASE_POOL_MAX !== undefined
    )
      throw new Error(
        "PostgreSQL plugin database configuration requires PostgreSQL",
      );
    const path = env.DOCA_PLUGIN_DATABASE_PATH;
    if (path !== undefined && !path.trim())
      throw new Error("DOCA_PLUGIN_DATABASE_PATH must not be empty");
    return {
      driver: "sqlite",
      path: path
        ? resolve(path)
        : main.path === ":memory:"
          ? ":memory:"
          : resolve(main.path) + ".plugins.db",
    };
  }
  if (env.DOCA_PLUGIN_DATABASE_PATH !== undefined)
    throw new Error("DOCA_PLUGIN_DATABASE_PATH requires SQLite");
  const poolMax = Number(env.DOCA_PLUGIN_DATABASE_POOL_MAX ?? 4);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 20)
    throw new Error(
      "DOCA_PLUGIN_DATABASE_POOL_MAX must be an integer from 1 to 20",
    );
  if (env.DOCA_PLUGIN_DATABASE_URL === undefined)
    return { driver: "postgres", url: null, poolMax };
  try {
    const url = new URL(env.DOCA_PLUGIN_DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.username ||
      !url.pathname.slice(1) ||
      url.searchParams.has("options") ||
      url.hash
    )
      throw new Error("Invalid target");
    return { driver: "postgres", url: url.href, poolMax };
  } catch {
    throw new Error(
      "DOCA_PLUGIN_DATABASE_URL must be a PostgreSQL URL for the shared plugin database",
    );
  }
}

export function configurePluginDatabases(db: DB, config: PluginDatabaseConfig) {
  const scope = databaseRuntimeScope(db);
  if (scope.has("plugin.databases"))
    throw new Error("Plugin databases are already configured");
  scope.set("plugin.database.config", config);
}

export function pluginDatabaseNamespace(id: string) {
  createPluginStorageNamespace(id);
  return "plugin_" + createHash("sha256").update(id).digest("hex").slice(0, 56);
}
const rootMarker = "_doca_shared_plugin_database";
type Scope = {
  base: Kysely<any>;
  driver: "sqlite" | "postgres";
  name: string;
  prefix: string;
};
const scopes = new WeakMap<object, Scope>();
class PrefixTransformer extends OperationNodeTransformer {
  constructor(private readonly prefix: string) {
    super();
  }
  protected override transformTable(node: TableNode): TableNode {
    if (node.table.schema)
      throw new Error("Plugin tables cannot select a database schema");
    return TableNode.create(this.prefix + node.table.identifier.name);
  }
}
function scoped(db: Kysely<any>, id: string) {
  const name = pluginDatabaseNamespace(id),
    prefix = name + "__",
    driver = databaseDriver(db);
  const transform = new PrefixTransformer(prefix);
  const plugin: KyselyPlugin = {
    transformQuery: ({ node, queryId }) =>
      transform.transformNode(node, queryId),
    transformResult: async ({ result }) => result,
  };
  const result =
    driver === "postgres" ? db.withSchema(name) : db.withPlugin(plugin);
  registerDriver(result, driver);
  scopes.set(result, { base: db, driver, name, prefix });
  return result;
}
export function pluginPhysicalTable(db: Kysely<any>, name: string) {
  const scope = scopes.get(db);
  if (!scope) throw new Error("Plugin database scope is unavailable");
  return scope.driver === "sqlite" ? scope.prefix + name : name;
}
/** Scope metadata before validating/cleaning; other plugins' tables are never candidates. */
export async function pluginDatabaseTables(db: Kysely<any>) {
  const scope = scopes.get(db);
  if (!scope) throw new Error("Plugin database scope is unavailable");
  if (scope.driver === "sqlite")
    return (await currentSchemaTables(scope.base))
      .filter((t) => t.name.startsWith(scope.prefix))
      .map((t) => ({ ...t, name: t.name.slice(scope.prefix.length) }));
  if (scope.base.isTransaction) return currentSchemaTables(scope.base);
  return scope.base.transaction().execute(async (tx) => {
    registerDriver(tx, "postgres");
    await sql`select set_config('search_path', ${scope.name}, true)`.execute(
      tx,
    );
    return currentSchemaTables(tx);
  });
}

export class PluginDatabases {
  private root: Promise<Kysely<any>> | undefined;
  private handles = new Map<string, Kysely<any>>();
  private required = new Map<string, boolean>();
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
    const root = await this.shared(mustExist, coreConnection);
    if (this.config.driver === "postgres" && mustExist) {
      const exists = await sql<{
        present: boolean;
      }>`select exists(select 1 from pg_namespace where nspname = ${pluginDatabaseNamespace(id)}) as present`.execute(
        root,
      );
      if (!exists.rows[0]!.present)
        throw new Error(
          "Plugin database namespace is missing; it will not be recreated",
        );
    }
    this.required.set(id, mustExist);
    const previous = this.handles.get(id);
    if (previous) return previous;
    const handle = scoped(root, id);
    // All plugins share the root pool. Transaction-local search_path is reset by
    // PostgreSQL at commit/rollback; concurrent plugins never inherit another scope.
    handle.transaction = () => {
      const builder = root.transaction(),
        execute = builder.execute.bind(builder);
      builder.execute = (run) =>
        execute(async (tx) => {
          registerDriver(tx, this.config.driver);
          if (this.config.driver === "postgres") {
            const name = pluginDatabaseNamespace(id);
            const exists = await sql<{
              present: boolean;
            }>`select exists(select 1 from pg_namespace where nspname = ${name}) as present`.execute(
              tx,
            );
            if (!exists.rows[0]!.present) {
              if (this.required.get(id))
                throw new Error(
                  "Plugin database namespace is missing; it will not be recreated",
                );
              await tx.schema.createSchema(name).execute();
            }
            await sql`select set_config('search_path', ${name}, true)`.execute(
              tx,
            );
          }
          return run(scoped(tx, id) as Transaction<any>);
        });
      return builder;
    };
    this.handles.set(id, handle);
    return handle;
  }

  async existing(id: string, coreConnection: Kysely<any>) {
    if (
      this.config.driver === "sqlite" &&
      this.config.path !== ":memory:" &&
      !existsSync(this.config.path)
    )
      return undefined;
    if (
      this.config.driver === "sqlite" &&
      this.config.path === ":memory:" &&
      !this.root
    )
      return undefined;
    if (this.config.driver === "postgres" && !this.config.url) return undefined;
    const root = await this.shared(false, coreConnection);
    if (this.config.driver === "postgres") {
      const exists = await sql<{
        present: boolean;
      }>`select exists(select 1 from pg_namespace where nspname = ${pluginDatabaseNamespace(id)}) as present`.execute(
        root,
      );
      if (!exists.rows[0]!.present) return undefined;
    }
    return this.open(id, false, coreConnection);
  }

  private async shared(mustExist: boolean, coreConnection: Kysely<any>) {
    if (this.closed) throw new Error("Plugin databases are closed");
    if (
      this.config.driver === "sqlite" &&
      this.config.path !== ":memory:" &&
      !existsSync(this.config.path) &&
      (mustExist || this.root)
    )
      throw new Error(
        "Shared plugin database file is missing; it will not be recreated",
      );
    if (!this.root) {
      // Assign the promise before the first await, so different plugins share one pool.
      this.root = (async () => {
        const rows = await coreConnection
          .selectFrom("plugin_storage_namespaces")
          .select("definition")
          .execute();
        const recorded = rows.some((row) => {
          try {
            const d = JSON.parse(row.definition ?? "null");
            return d?.storageVersion === 3 && d.schema !== null;
          } catch {
            return false;
          }
        });
        return this.connect(mustExist || recorded, coreConnection);
      })().catch((error) => {
        this.root = undefined;
        throw error;
      });
    }
    return this.root;
  }

  private async connect(mustExist: boolean, coreConnection: Kysely<any>) {
    let db: Kysely<any>, sqlite: Sqlite.Database | undefined;
    if (this.config.driver === "sqlite") {
      const path = this.config.path,
        main = databaseConfig(this.core);
      if (
        main.driver !== "sqlite" ||
        (path !== ":memory:" && resolve(path) === resolve(main.path))
      )
        throw new Error(
          "Shared plugin database must be separate from the core database",
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
            "Shared plugin database must be separate from the core database",
          );
      }
      if (path !== ":memory:")
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      sqlite = new Sqlite(path, {
        fileMustExist: mustExist && path !== ":memory:",
      });
      sqlite.pragma("foreign_keys = ON");
      sqlite.pragma("busy_timeout = 5000");
      sqlite.pragma("synchronous = FULL");
      db = new Kysely<any>({
        dialect: new SqliteDialect({ database: sqlite }),
      });
      registerDriver(db, "sqlite");
    } else {
      if (!this.config.url)
        throw new Error(
          "Configure DOCA_PLUGIN_DATABASE_URL once for all SQL plugins",
        );
      const pool = new Pool({
        connectionString: this.config.url,
        max: this.config.poolMax,
        options: "-csearch_path=public",
        connectionTimeoutMillis: 5000,
      });
      pool.on("error", () => {
        if (!this.closed)
          process.emitWarning("Shared plugin database connection lost");
      });
      db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
      registerDriver(db, "postgres");
      try {
        const identity = (
          await sql<{
            database: string;
            address: string | null;
            port: number | null;
            role: string;
            elevated: boolean;
            member: boolean;
          }>`select current_database() as database, inet_server_addr()::text as address, inet_server_port() as port, current_user as role, (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls) as elevated, exists(select 1 from pg_auth_members where member=r.oid) as member from pg_roles r where rolname=current_user`.execute(
            db,
          )
        ).rows[0]!;
        if (identity.elevated || identity.member)
          throw new Error(
            "Shared plugin database requires a restricted role without elevated privileges or role membership",
          );
        const core = (
          await sql<{
            database: string;
            address: string | null;
            port: number | null;
          }>`select current_database() as database, inet_server_addr()::text as address, inet_server_port() as port`.execute(
            coreConnection,
          )
        ).rows[0]!;
        if (core.address === identity.address && core.port === identity.port) {
          if (core.database === identity.database)
            throw new Error(
              "Shared plugin database must be separate from the core database",
            );
          const access = await sql<{
            allowed: boolean;
          }>`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=current_schema() and c.relkind in ('r','p','v') and has_table_privilege(${identity.role},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as allowed`.execute(
            coreConnection,
          );
          if (access.rows[0]!.allowed)
            throw new Error(
              "Shared plugin database role must not have access to core tables",
            );
        }
      } catch (error) {
        await db.destroy();
        throw error;
      }
    }
    try {
      await db.transaction().execute(async (tx) => {
        registerDriver(tx, this.config.driver);
        if (this.config.driver === "postgres")
          await sql`select pg_advisory_xact_lock(741093216)`.execute(tx);
        const tables = await currentSchemaTables(tx);
        // SQLite also contains prefixed business tables. The global marker must
        // already exist before any of those can have been created by this host.
        const marker = tables.find((t) => t.name === rootMarker);
        if (!marker) {
          if (mustExist || tables.length)
            throw new Error(
              "Shared plugin database is missing or contains unknown tables; no data was changed",
            );
          if (this.config.driver === "postgres") {
            const schemas = await sql<{
              name: string;
            }>`select nspname as name from pg_namespace where nspname !~ '^pg_' and nspname not in ('public','information_schema')`.execute(
              tx,
            );
            if (schemas.rows.length)
              throw new Error(
                "Shared plugin database contains unknown schemas; no data was changed",
              );
          }
          await tx.schema
            .createTable(rootMarker)
            .addColumn("id", "text", (c) => c.notNull().primaryKey())
            .addColumn("storage_version", "integer", (c) => c.notNull())
            .execute();
          await tx
            .insertInto(rootMarker)
            .values({ id: "shared", storage_version: 3 })
            .execute();
        } else {
          if (
            marker.columns.length !== 2 ||
            !marker.columns.some((c) => c.name === "id") ||
            !marker.columns.some((c) => c.name === "storage_version")
          )
            throw new Error("Shared plugin database marker is invalid");
          const rows = await tx.selectFrom(rootMarker).selectAll().execute();
          if (
            rows.length !== 1 ||
            rows[0]?.id !== "shared" ||
            rows[0]?.storage_version !== 3
          )
            throw new Error("Shared plugin database format is unsupported");
          if (
            tables.some(
              (t) =>
                t.name !== rootMarker &&
                (this.config.driver === "postgres" ||
                  !/^plugin_[a-f0-9]{56}__/.test(t.name)),
            )
          )
            throw new Error("Shared plugin database contains unknown tables");
        }
      });
      if (sqlite && this.config.driver === "sqlite") {
        sqlite.pragma("journal_mode = WAL");
        if (this.config.path !== ":memory:") chmodSync(this.config.path, 0o600);
      }
      return db;
    } catch (error) {
      await db.destroy();
      throw error;
    }
  }

  async close() {
    this.closed = true;
    this.handles.clear();
    const root = await this.root?.catch(() => undefined);
    this.root = undefined;
    await root?.destroy();
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
