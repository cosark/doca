import { currentSchemaTables } from "@db/introspection.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { DB } from "@db/index.js";
import { transact } from "@db/transactions.js";
import type {
  PluginDatabaseSchema,
  PluginDatabaseServiceV1,
  PluginDatabaseTransaction,
  PluginDataFilter,
  PluginDataRow,
  PluginDataQuery,
  PluginStoredObject,
  PluginObjectStorageServiceV1,
  PluginCredentialServiceV1,
} from "@smartdoca/plugin-sdk/storage";
import type { CredentialCipher } from "./credential-cipher.js";
import {
  bindPluginCredentials,
  verifyCredentialKey,
} from "./plugin-credentials.js";
import { createPluginStorageNamespace } from "./plugin-storage-namespaces.js";
import type { HostFileStore } from "./host-file-store.js";
import { pluginDatabases } from "./plugin-databases.js";
import { registerDriver, databaseDriver } from "@db/transactions.js";
import {
  pluginStorageIdentifier as identifier,
  pluginDatabaseSchemaParser as schemaParser,
  pluginStorageDeclarationParser as declarationParser,
} from "@db/plugin-storage-format.js";

const valueParser = z.union([
  z.string().max(2_000_000),
  z.number().finite(),
  z.null(),
]);
const filtersParser = z
  .array(
    z
      .object({
        column: identifier,
        operator: z.enum(["=", "!=", "<", "<=", ">", ">="]),
        value: valueParser,
      })
      .strict(),
  )
  .max(100);
const queryParser = z
  .object({
    where: filtersParser.optional(),
    orderBy: z
      .array(
        z
          .object({ column: identifier, direction: z.enum(["asc", "desc"]) })
          .strict(),
      )
      .max(16)
      .optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const emptyDeclaration = () => canonical({ storageVersion: 2, schema: null });
/** Old installed plugins must be uninstalled by the previous host before upgrading. */
export function pluginStorageDeclaration(definition: string | null) {
  try {
    return declarationParser.parse(JSON.parse(definition ?? "null"));
  } catch {
    throw new Error(
      "Plugin storage format is unsupported; uninstall plugins using the previous host, then upgrade and reinstall. No business data is migrated.",
    );
  }
}
const markerTable = "_doca_plugin_store";
const databaseMarker = (
  id: string,
  generation: number,
  dataVersion: string,
  schema: PluginDatabaseSchema,
) =>
  canonical({
    storageVersion: 2,
    pluginId: id,
    generation,
    dataVersion,
    schema,
  });
async function verifyDatabase(db: Kysely<any>, expected: string) {
  const marker = await db.selectFrom(markerTable).selectAll().execute();
  if (
    marker.length !== 1 ||
    marker[0]?.id !== "installation" ||
    marker[0]?.definition !== expected
  )
    throw new PluginStorageError(
      "unavailable",
      "Plugin database installation differs from the host declaration",
    );
}
async function verifyConstraints(
  db: Kysely<any>,
  schema: PluginDatabaseSchema,
) {
  const actual = new Map<string, string[]>();
  const add = (name: string, type: string, columns: string[]) => {
    const constraints = actual.get(name) ?? [];
    constraints.push(canonical([type, columns]));
    actual.set(name, constraints);
  };
  if (databaseDriver(db) === "postgres") {
    const constraints = await sql<{
      name: string;
      type: string;
      columns: string[];
      deferred: boolean;
    }>`
      select t.relname as name, c.contype as type, c.condeferrable as deferred,
        array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum order by k.ord) as columns
      from pg_constraint c join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = current_schema() and c.contype <> 'n'`.execute(db);
    for (const c of constraints.rows) {
      if (c.name === markerTable) continue;
      if (c.deferred)
        throw new PluginStorageError(
          "unavailable",
          "Plugin database structure is incomplete",
        );
      add(c.name, c.type, c.columns);
    }
    const indexes = await sql<{ extra: boolean }>`select exists(
      select 1 from pg_index i join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = current_schema() and not exists(select 1 from pg_constraint c where c.conindid = i.indexrelid)
    ) as extra`.execute(db);
    if (indexes.rows[0]!.extra)
      throw new PluginStorageError(
        "unavailable",
        "Plugin database structure is incomplete",
      );
  } else {
    for (const name of Object.keys(schema.tables)) {
      const columns = await sql<{
        name: string;
        pk: number;
      }>`select name, pk from pragma_table_info(${name}) where pk > 0 order by pk`.execute(
        db,
      );
      add(
        name,
        "p",
        columns.rows.map((c) => c.name),
      );
      const indexes = await sql<{
        name: string;
        origin: string;
      }>`select name, origin from pragma_index_list(${name})`.execute(db);
      for (const index of indexes.rows) {
        if (index.origin === "pk") continue;
        const fields = await sql<{
          name: string;
        }>`select name from pragma_index_info(${index.name}) order by seqno`.execute(
          db,
        );
        add(
          name,
          index.origin === "u" ? "u" : "index",
          fields.rows.map((c) => c.name),
        );
      }
      const foreign = await sql<{
        id: number;
      }>`select id from pragma_foreign_key_list(${name})`.execute(db);
      if (foreign.rows.length) add(name, "f", []);
      const ddl = await sql<{
        definition: string;
      }>`select sql as definition from sqlite_schema where type = 'table' and name = ${name}`.execute(
        db,
      );
      if (/\bcheck\s*\(/i.test(ddl.rows[0]!.definition)) add(name, "c", []);
    }
  }
  for (const [name, table] of Object.entries(schema.tables)) {
    const expected = [
      canonical(["p", [...table.primaryKey]]),
      ...table.unique.map((c) => canonical(["u", [...c]])),
    ].sort();
    if (canonical((actual.get(name) ?? []).sort()) !== canonical(expected))
      throw new PluginStorageError(
        "unavailable",
        "Plugin database structure is incomplete",
      );
  }
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",")}}`;
  return JSON.stringify(value);
};
export class PluginStorageError extends Error {
  constructor(
    readonly code: "invalid-input" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PluginStorageError";
  }
}
const invalid = () =>
  new PluginStorageError("invalid-input", "Invalid plugin storage input");
function parse<T>(parser: z.ZodType<T>, value: unknown): T {
  const result = parser.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PluginStorageError) throw error;
    const code = (error as { code?: string }).code;
    throw new PluginStorageError(
      [
        "23505",
        "SQLITE_CONSTRAINT_PRIMARYKEY",
        "SQLITE_CONSTRAINT_UNIQUE",
        "40001",
        "40P01",
        "SQLITE_BUSY",
        "SQLITE_BUSY_SNAPSHOT",
      ].includes(code ?? "")
        ? "conflict"
        : "unavailable",
      "Plugin storage operation failed",
    );
  }
}
/** Called only as part of the registry transaction for an explicit new installation. */
export async function installPluginStorage(
  db: DB,
  id: string,
  dataVersion: string,
) {
  const namespace = createPluginStorageNamespace(id);
  const row = await db
    .selectFrom("plugin_storage_namespaces")
    .selectAll()
    .where("plugin_id", "=", id)
    .executeTakeFirst();
  if (row?.state === "active") {
    if (
      row.data_version !== dataVersion ||
      row.namespace !== namespace.database
    )
      throw new Error("Plugin data structure differs from installation");
    pluginStorageDeclaration(row.definition);
    return;
  }
  if (row?.definition) {
    // A removed old-format installation was already cleaned by the previous host.
    const stored = JSON.parse(row.definition);
    const declaration = declarationParser.safeParse(stored);
    if (declaration.success)
      throw new Error(
        "Plugin database cleanup is pending; retry cleanup before reinstalling",
      );
    if (!schemaParser.safeParse(stored).success)
      throw new Error(
        "Removed plugin storage metadata is invalid; review it before reinstalling",
      );
  }
  if (!row)
    await db
      .insertInto("plugin_storage_namespaces")
      .values({
        plugin_id: id,
        namespace: namespace.database,
        data_version: dataVersion,
        generation: 1,
        state: "active",
        definition: emptyDeclaration(),
        created_at: new Date().toISOString(),
      })
      .execute();
  else
    await db
      .updateTable("plugin_storage_namespaces")
      .set({
        generation: row.generation + 1,
        data_version: dataVersion,
        state: "active",
        definition: emptyDeclaration(),
      })
      .where("plugin_id", "=", id)
      .where("generation", "=", row.generation)
      .execute();
}
/** Fence earlier instance handles and clear only this generation's private business data. Normal user files are retained. */
export async function removePluginStorage(db: DB, id: string) {
  const namespace = createPluginStorageNamespace(id);
  const row = await db
    .updateTable("plugin_storage_namespaces")
    .set({ state: "removed" })
    .where("plugin_id", "=", id)
    .where("state", "=", "active")
    .returningAll()
    .executeTakeFirstOrThrow();
  if (row.namespace !== namespace.database)
    throw new Error("Plugin storage installation is unavailable");
  pluginStorageDeclaration(row.definition);
  // Keep the declaration as a durable cleanup intent. Business DDL runs after the
  // registry commit, while this removed generation already rejects old handles.
  const objects = await db
    .selectFrom("plugin_private_objects")
    .selectAll()
    .where("plugin_id", "=", id)
    .where("generation", "=", row.generation)
    .execute();
  for (const object of objects) {
    namespace.assertObjectKey(object.object_key, row.generation);
    await db
      .insertInto("plugin_object_garbage")
      .values({
        id: randomUUID(),
        store_id: object.store_id,
        object_key: object.object_key,
        created_at: new Date().toISOString(),
      })
      .execute();
  }
  await db
    .deleteFrom("plugin_private_objects")
    .where("plugin_id", "=", id)
    .where("generation", "=", row.generation)
    .execute();
  await db
    .deleteFrom("plugin_credentials")
    .where("plugin_id", "=", id)
    .where("namespace", "=", namespace.database)
    .where("generation", "=", row.generation)
    .execute();
}
/** Retryable cleanup, fenced by the core namespace lock; never a distributed transaction. */
export async function cleanupPluginDatabases(db: DB) {
  const pending = await db
    .selectFrom("plugin_storage_namespaces")
    .selectAll()
    .where("state", "=", "removed")
    .execute();
  let failed = 0;
  for (const row of pending) {
    if (row.definition === null) continue;
    let declaration: z.infer<typeof declarationParser>;
    try {
      const stored = JSON.parse(row.definition),
        parsed = declarationParser.safeParse(stored);
      if (!parsed.success) {
        if (!schemaParser.safeParse(stored).success) failed++;
        continue;
      }
      declaration = parsed.data;
    } catch {
      failed++;
      continue;
    }
    // Historical removed rows contain no live old store; their tables were removed by the old host.
    const schema = declaration.schema;
    try {
      await transact(db, async (core) => {
        const locked = await core
          .updateTable("plugin_storage_namespaces")
          .set({ state: "removed" })
          .where("plugin_id", "=", row.plugin_id)
          .where("generation", "=", row.generation)
          .where("state", "=", "removed")
          .where("definition", "=", row.definition)
          .executeTakeFirst();
        if (!Number(locked.numUpdatedRows)) return;
        const business = await pluginDatabases(db).existing(
          row.plugin_id,
          core,
        );
        if (schema && !business)
          throw new Error(
            "Plugin database is missing; cleanup requires review",
          );
        if (business)
          await business.transaction().execute(async (tx) => {
            registerDriver(tx, databaseDriver(business));
            const tables = await currentSchemaTables(tx);
            if (tables.length) {
              let installedSchema = schema;
              if (!installedSchema) {
                const marker = await tx
                  .selectFrom(markerTable)
                  .select("definition")
                  .where("id", "=", "installation")
                  .executeTakeFirstOrThrow();
                installedSchema = parse(
                  schemaParser,
                  JSON.parse(marker.definition).schema,
                );
              }
              await verifyDatabase(
                tx,
                databaseMarker(
                  row.plugin_id,
                  row.generation,
                  row.data_version,
                  installedSchema,
                ),
              );
              const names = new Set([
                markerTable,
                ...Object.keys(installedSchema.tables),
              ]);
              if (tables.some((t) => !names.has(t.name)))
                throw new Error(
                  "Unexpected plugin database tables; cleanup refused",
                );
              for (const name of Object.keys(installedSchema.tables))
                await tx.schema.dropTable(name).execute();
              await tx.schema.dropTable(markerTable).execute();
            }
          });
        await core
          .updateTable("plugin_storage_namespaces")
          .set({ definition: null })
          .where("plugin_id", "=", row.plugin_id)
          .where("generation", "=", row.generation)
          .where("state", "=", "removed")
          .execute();
      });
    } catch {
      failed++;
    }
  }
  return { failed };
}
/** Durable garbage intents survive process crashes and storage outages. Archives never enter this collector. */
export async function cleanupPluginObjects(db: DB, files: HostFileStore) {
  const pending = await db
    .selectFrom("plugin_object_garbage")
    .selectAll()
    .orderBy("created_at")
    .limit(100)
    .execute();
  let failed = 0;
  for (const row of pending) {
    try {
      if (
        !row.object_key.startsWith("plugins/") ||
        !row.object_key.includes("/objects/")
      )
        throw new Error("Invalid plugin garbage key");
      try {
        await files.remove(row.store_id, row.object_key);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          (error as { name?: string }).name !== "NoSuchKey"
        )
          throw error;
      }
      await db
        .deleteFrom("plugin_object_garbage")
        .where("id", "=", row.id)
        .execute();
    } catch {
      failed++;
    }
  }
  return { processed: pending.length - failed, failed };
}
export interface PluginStorageServices {
  readonly database: PluginDatabaseServiceV1;
  readonly objects: PluginObjectStorageServiceV1;
  readonly credentials?: PluginCredentialServiceV1;
}

/** Internal factory: the SDK receives only these already-bound services. */
export async function bindPluginStorage(
  db: DB,
  files: HostFileStore,
  id: string,
  dataVersion: string,
  credentialCipher?: CredentialCipher,
): Promise<PluginStorageServices> {
  const namespace = createPluginStorageNamespace(id);
  const installed = await db
    .selectFrom("plugin_storage_namespaces")
    .selectAll()
    .where("plugin_id", "=", id)
    .executeTakeFirstOrThrow();
  if (
    installed.state !== "active" ||
    installed.data_version !== dataVersion ||
    installed.namespace !== namespace.database
  )
    throw new Error("Plugin storage installation is unavailable");
  pluginStorageDeclaration(installed.definition);
  const databases = pluginDatabases(db);
  const generation = installed.generation;
  async function current(tx: DB, lock = false) {
    // UPDATE locks the namespace for writes and schema declarations on every backend.
    if (lock) {
      const locked = await tx
        .updateTable("plugin_storage_namespaces")
        .set({ generation })
        .where("plugin_id", "=", id)
        .where("generation", "=", generation)
        .where("state", "=", "active")
        .executeTakeFirst();
      if (!Number(locked.numUpdatedRows))
        throw new PluginStorageError(
          "unavailable",
          "Plugin storage installation is no longer active",
        );
    }
    const row = await tx
      .selectFrom("plugin_storage_namespaces")
      .selectAll()
      .where("plugin_id", "=", id)
      .where("generation", "=", generation)
      .where("state", "=", "active")
      .executeTakeFirst();
    if (!row || row.data_version !== dataVersion)
      throw new PluginStorageError(
        "unavailable",
        "Plugin storage installation is no longer active",
      );
    return row;
  }
  async function structure(tx: DB) {
    const row = await current(tx);
    const declaration = pluginStorageDeclaration(row.definition);
    if (!declaration.schema)
      throw new PluginStorageError(
        "unavailable",
        "Declare the plugin database schema first",
      );
    return declaration.schema;
  }
  const validateSchema = (input: PluginDatabaseSchema) => {
    const schema = parse(schemaParser, input);
    if (
      !Object.keys(schema.tables).length ||
      Object.keys(schema.tables).length > 100
    )
      throw invalid();
    for (const table of Object.values(schema.tables)) {
      if (
        !Object.keys(table.columns).length ||
        Object.keys(table.columns).length > 100
      )
        throw invalid();
      for (const columns of [table.primaryKey, ...table.unique]) {
        if (
          new Set(columns).size !== columns.length ||
          columns.some((c) => !Object.hasOwn(table.columns, c))
        )
          throw invalid();
      }
      if (table.primaryKey.some((c) => table.columns[c]!.nullable))
        throw invalid();
    }
    return schema;
  };
  function transactionService(
    tx: Kysely<any>,
    schema: PluginDatabaseSchema,
    active: () => boolean,
  ): PluginDatabaseTransaction {
    async function table(name: string) {
      if (!active())
        throw new PluginStorageError(
          "unavailable",
          "Plugin transaction has ended",
        );
      parse(identifier, name);
      const definition = schema.tables[name];
      if (!definition) throw invalid();
      return {
        definition,
        name,
        query: tx as Kysely<any>,
      };
    }
    const cell = (
      columns: PluginDatabaseSchema["tables"][string]["columns"],
      name: string,
      value: unknown,
    ) => {
      if (!Object.hasOwn(columns, name)) throw invalid();
      const c = columns[name]!;
      const v = parse(valueParser, value);
      if (
        v === null
          ? !c.nullable
          : c.type === "text"
            ? typeof v !== "string"
            : typeof v !== "number" ||
              (c.type === "integer" &&
                (!Number.isSafeInteger(v) || v < -2147483648 || v > 2147483647))
      )
        throw invalid();
      return v;
    };
    const values = (
      columns: PluginDatabaseSchema["tables"][string]["columns"],
      input: PluginDataRow,
      full: boolean,
    ) => {
      const v = parse(z.record(identifier, valueParser), input);
      if (
        !Object.keys(v).length ||
        (full && Object.keys(columns).some((c) => !Object.hasOwn(v, c)))
      )
        throw invalid();
      for (const [name, value] of Object.entries(v)) cell(columns, name, value);
      return v;
    };
    const where = (
      query: any,
      columns: PluginDatabaseSchema["tables"][string]["columns"],
      input: readonly PluginDataFilter[],
      required: boolean,
    ) => {
      const clauses = parse(filtersParser, input);
      if (required && !clauses.length) throw invalid();
      for (const filter of clauses) {
        cell(columns, filter.column, filter.value);
        if (filter.value === null && !["=", "!="].includes(filter.operator))
          throw invalid();
        query = query.where(
          filter.column,
          filter.value === null
            ? filter.operator === "="
              ? "is"
              : "is not"
            : filter.operator,
          filter.value,
        );
      }
      return query;
    };
    return Object.freeze({
      select: (name: string, input: PluginDataQuery = {}) =>
        safe(async () => {
          const t = await table(name),
            q = parse(queryParser, input);
          let query = where(
            t.query.selectFrom(t.name).selectAll(),
            t.definition.columns,
            q.where ?? [],
            false,
          );
          for (const order of q.orderBy ?? []) {
            if (!Object.hasOwn(t.definition.columns, order.column))
              throw invalid();
            query = query.orderBy(order.column, order.direction);
          }
          return query.limit(q.limit ?? 100).execute() as Promise<
            PluginDataRow[]
          >;
        }),
      insert: (name: string, rows: readonly PluginDataRow[]) =>
        safe(async () => {
          const t = await table(name);
          if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
            throw invalid();
          await t.query
            .insertInto(t.name)
            .values(rows.map((v) => values(t.definition.columns, v, true)))
            .execute();
        }),
      update: (
        name: string,
        input: PluginDataRow,
        filters: readonly PluginDataFilter[],
      ) =>
        safe(async () => {
          const t = await table(name);
          const result = await where(
            t.query
              .updateTable(t.name)
              .set(values(t.definition.columns, input, false)),
            t.definition.columns,
            filters,
            true,
          ).executeTakeFirst();
          return Number(result.numUpdatedRows);
        }),
      remove: (name: string, filters: readonly PluginDataFilter[]) =>
        safe(async () => {
          const t = await table(name);
          const result = await where(
            t.query.deleteFrom(t.name),
            t.definition.columns,
            filters,
            true,
          ).executeTakeFirst();
          return Number(result.numDeletedRows);
        }),
    });
  }
  async function transaction<T>(
    run: (service: PluginDatabaseTransaction) => Promise<T>,
  ) {
    // User callback is never automatically retried. A retained transaction handle expires at completion.
    return safe(() =>
      db.transaction().execute(async (tx) => {
        await current(tx, true);
        const schema = await structure(tx);
        const business = await databases.open(id, true, tx);
        return business.transaction().execute(async (businessTx) => {
          await verifyDatabase(
            businessTx,
            databaseMarker(id, generation, dataVersion, schema),
          );
          let active = true;
          try {
            return await run(
              transactionService(businessTx, schema, () => active),
            );
          } finally {
            active = false;
          }
        });
      }),
    );
  }
  const database: PluginDatabaseServiceV1 =
    Object.freeze<PluginDatabaseServiceV1>({
      defineSchema: (input: PluginDatabaseSchema) =>
        safe(async () => {
          const schema = validateSchema(input);
          const definition = canonical({ storageVersion: 2, schema });
          await transact(db, async (tx) => {
            const row = await current(tx, true);
            const declared = pluginStorageDeclaration(row.definition);
            if (declared.schema) {
              if (row.definition !== definition)
                throw new PluginStorageError(
                  "conflict",
                  "Plugin database schema differs from its declaration",
                );
              // Verify persisted physical tables as well; never recreate a missing table over lost business data.
            }
            const business = await databases.open(id, !!declared.schema, tx);
            await business.transaction().execute(async (businessTx) => {
              registerDriver(businessTx, databaseDriver(business));
              const tables = await currentSchemaTables(businessTx);
              if (tables.length) {
                // An interrupted first declaration may have committed the business
                // transaction. Adopt only its exact installation marker and schema.
                await verifyDatabase(
                  businessTx,
                  databaseMarker(id, generation, dataVersion, schema),
                );
                if (tables.length !== Object.keys(schema.tables).length + 1)
                  throw new PluginStorageError(
                    "unavailable",
                    "Plugin database structure is incomplete",
                  );
              } else if (declared.schema) {
                throw new PluginStorageError(
                  "unavailable",
                  "Plugin database structure is incomplete",
                );
              }
              if (tables.length)
                for (const [name, t] of Object.entries(schema.tables)) {
                  const physical = tables.find((v) => v.name === name);
                  if (
                    !physical ||
                    physical.columns.length !== Object.keys(t.columns).length ||
                    Object.keys(t.columns).some(
                      (c) =>
                        !physical.columns.some((v) => {
                          const column = t.columns[c]!;
                          const type = v.dataType.toLowerCase();
                          const expectedTypes =
                            column.type === "integer"
                              ? ["integer", "int4"]
                              : column.type === "real"
                                ? ["double precision", "float8"]
                                : ["text"];
                          return (
                            v.name === c &&
                            v.isNullable === column.nullable &&
                            !v.hasDefaultValue &&
                            expectedTypes.includes(type)
                          );
                        }),
                    )
                  )
                    throw new PluginStorageError(
                      "unavailable",
                      "Plugin database structure is incomplete",
                    );
                }
              if (tables.length) {
                await verifyConstraints(businessTx, schema);
                return;
              }
              for (const [name, t] of Object.entries(schema.tables)) {
                let builder: any = businessTx.schema.createTable(name);
                for (const [column, c] of Object.entries(t.columns))
                  builder = builder.addColumn(
                    column,
                    c.type === "real" ? "double precision" : c.type,
                    (b: any) => (c.nullable ? b : b.notNull()),
                  );
                builder = builder.addPrimaryKeyConstraint(
                  "_doca_" + hash(name).slice(0, 40) + "_pk",
                  [...t.primaryKey],
                );
                for (let i = 0; i < t.unique.length; i++)
                  builder = builder.addUniqueConstraint(
                    "_doca_" + hash(name).slice(0, 40) + "_u" + i,
                    [...t.unique[i]!],
                  );
                await builder.execute();
              }
              await businessTx.schema
                .createTable(markerTable)
                .addColumn("id", "text", (c) => c.notNull().primaryKey())
                .addColumn("definition", "text", (c) => c.notNull())
                .execute();
              await businessTx
                .insertInto(markerTable)
                .values({
                  id: "installation",
                  definition: databaseMarker(
                    id,
                    generation,
                    dataVersion,
                    schema,
                  ),
                })
                .execute();
            });
            await tx
              .updateTable("plugin_storage_namespaces")
              .set({ definition })
              .where("plugin_id", "=", id)
              .where("generation", "=", generation)
              .execute();
          });
        }),
      transaction,
      select: (name, query) => transaction((t) => t.select(name, query)),
      insert: (name, rows) => transaction((t) => t.insert(name, rows)),
      update: (name, values, where) =>
        transaction((t) => t.update(name, values, where)),
      remove: (name, where) => transaction((t) => t.remove(name, where)),
    });
  const metadata = (row: {
    id: string;
    mime: string;
    size: number;
    sha256: string;
    created_at: string;
  }): PluginStoredObject =>
    Object.freeze({
      id: row.id,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
      createdAt: row.created_at,
    });
  const objects: PluginObjectStorageServiceV1 =
    Object.freeze<PluginObjectStorageServiceV1>({
      put: (input) =>
        safe(async () => {
          if (
            !(input?.data instanceof Uint8Array) ||
            input.data.length > 32 * 1024 ** 2 ||
            !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(
              input.mime,
            ) ||
            input.mime.length > 160
          )
            throw invalid();
          await current(db);
          const objectId = randomUUID(),
            key = namespace.objectKey(generation, objectId, randomUUID());
          const stored = await files.putImmutable(key, input.data, input.mime);
          const row = {
            plugin_id: id,
            generation,
            id: objectId,
            store_id: stored.storeId,
            object_key: key,
            mime: input.mime,
            size: stored.size,
            sha256: stored.sha256,
            created_at: new Date().toISOString(),
          };
          // Upload precedes the transaction. A rejected/stale commit can leave an unreferenced immutable object, never partial data.
          await transact(db, async (tx) => {
            await current(tx, true);
            await tx.insertInto("plugin_private_objects").values(row).execute();
          });
          return metadata(row);
        }),
      get: (objectId) =>
        safe(async () => {
          parse(z.string().uuid(), objectId);
          await current(db);
          const row = await db
            .selectFrom("plugin_private_objects")
            .selectAll()
            .where("plugin_id", "=", id)
            .where("generation", "=", generation)
            .where("id", "=", objectId)
            .executeTakeFirst();
          if (!row) return null;
          namespace.assertObjectKey(row.object_key, generation);
          const data = await files.read(
            row.store_id,
            row.object_key,
            row.size,
            row.sha256,
          );
          await current(db);
          return { object: metadata(row), data: new Uint8Array(data) };
        }),
      remove: (objectId) =>
        safe(async () => {
          parse(z.string().uuid(), objectId);
          const row = await transact(db, async (tx) => {
            await current(tx, true);
            const row = await tx
              .selectFrom("plugin_private_objects")
              .selectAll()
              .where("plugin_id", "=", id)
              .where("generation", "=", generation)
              .where("id", "=", objectId)
              .executeTakeFirst();
            if (!row) return null;
            namespace.assertObjectKey(row.object_key, generation);
            await tx
              .insertInto("plugin_object_garbage")
              .values({
                id: randomUUID(),
                store_id: row.store_id,
                object_key: row.object_key,
                created_at: new Date().toISOString(),
              })
              .execute();
            await tx
              .deleteFrom("plugin_private_objects")
              .where("plugin_id", "=", id)
              .where("generation", "=", generation)
              .where("id", "=", objectId)
              .execute();
            return row;
          });
          if (row) await cleanupPluginObjects(db, files);
        }),
    });
  if (credentialCipher) await verifyCredentialKey(db, credentialCipher);
  return Object.freeze({
    database,
    objects,
    ...(credentialCipher
      ? {
          credentials: bindPluginCredentials(
            db,
            credentialCipher,
            id,
            namespace.database,
            generation,
            current,
          ),
        }
      : {}),
  });
}
