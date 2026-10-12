import Sqlite from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { databaseDriver, registerDriver } from "./transactions.js";

type Column = { signature: string; definition: string };
type Index = { signature: string; ddl: string; unique: boolean };
type Table = {
  ddl: string;
  columns: Map<string, Column>;
  constraints: string[];
  indexes: Map<string, Index>;
};
type Catalog = Map<string, Table>;
export type SchemaPolicy = {
  newTables: readonly string[];
  newColumns: readonly string[];
};
export type SchemaChange = {
  kind: "create_table" | "add_column" | "create_index" | "review";
  table: string;
  column?: string;
  reason?: string;
  sql?: string;
  installed?: string;
  target?: string;
};
export class SchemaReviewRequired extends Error {
  constructor(public readonly changes: SchemaChange[]) {
    super(
      "Database schema changes require review; no data was changed: " +
        JSON.stringify(changes),
    );
  }
}
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
// Preserve literals: case and whitespace inside SQL strings are meaningful.
function normalize(value: string) {
  return value
    .split(/('(?:''|[^'])*')/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replaceAll('"', "")
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/;$/, ""),
    )
    .join("");
}
function definitions(ddl: string) {
  const body = ddl.slice(ddl.indexOf("(") + 1, ddl.lastIndexOf(")"));
  const parts: string[] = [];
  let start = 0,
    depth = 0,
    quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'") {
      if (quoted && body[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (quoted) continue;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts;
}
function sqliteTable(ddl: string): Table {
  const columns = new Map<string, Column>(),
    constraints: string[] = [];
  for (const definition of definitions(ddl)) {
    if (
      /^(constraint|primary\s+key|unique|check|foreign\s+key)\b/i.test(
        definition,
      )
    )
      constraints.push(normalize(definition));
    else {
      const name = definition.match(/^(?:"([^"]+)"|([\w]+))/);
      if (!name)
        throw new Error("Unsupported target column declaration: " + definition);
      columns.set((name[1] ?? name[2])!, {
        definition,
        signature: normalize(definition),
      });
    }
  }
  return { ddl, columns, constraints: constraints.sort(), indexes: new Map() };
}
async function sqliteCatalog(db: Kysely<any>): Promise<Catalog> {
  const rows = await sql<{
    name: string;
    tbl_name: string;
    type: string;
    sql: string;
  }>`select name,tbl_name,type,sql from sqlite_schema where type in ('table','index','view') and name not like 'sqlite_%' order by rowid`.execute(
    db,
  );
  const catalog: Catalog = new Map();
  for (const row of rows.rows)
    if (row.type !== "index")
      catalog.set(
        row.name,
        row.type === "table"
          ? sqliteTable(row.sql)
          : {
              ddl: row.sql,
              columns: new Map(),
              constraints: [],
              indexes: new Map(),
            },
      );
  for (const row of rows.rows)
    if (row.type === "index" && row.sql)
      catalog.get(row.tbl_name)?.indexes.set(row.name, {
        ddl: row.sql,
        signature: normalize(row.sql.replace(/\bif not exists\b/i, "")),
        unique: /^create unique/i.test(row.sql),
      });
  return catalog;
}
async function postgresCatalog(
  db: Kysely<any>,
  source: Catalog,
): Promise<Catalog> {
  const columns = await sql<{
    table_name: string;
    column_name: string;
    type: string;
    nullable: boolean;
    default_value: string | null;
  }>`
    select c.relname as table_name,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as type,
      not a.attnotnull as nullable,pg_get_expr(d.adbin,d.adrelid) as default_value
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname=current_schema() and c.relkind in ('r','p','v') order by c.relname,a.attnum`.execute(
    db,
  );
  const catalog: Catalog = new Map();
  for (const row of columns.rows) {
    let table = catalog.get(row.table_name);
    if (!table) {
      table = {
        ddl: source.get(row.table_name)?.ddl ?? "",
        columns: new Map(),
        constraints: [],
        indexes: new Map(),
      };
      catalog.set(row.table_name, table);
    }
    table.columns.set(row.column_name, {
      definition:
        source.get(row.table_name)?.columns.get(row.column_name)?.definition ??
        "",
      signature: JSON.stringify([row.type, row.nullable, row.default_value]),
    });
  }
  const constraints = await sql<{
    table_name: string;
    definition: string;
  }>`select c.relname as table_name,pg_get_constraintdef(k.oid) as definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=current_schema() order by c.relname,definition`.execute(db);
  for (const row of constraints.rows)
    catalog.get(row.table_name)?.constraints.push(normalize(row.definition));
  const indexes = await sql<{
    table_name: string;
    name: string;
    definition: string;
    unique: boolean;
  }>`
    select t.relname as table_name,i.relname as name,pg_get_indexdef(i.oid) as definition,x.indisunique as unique
    from pg_index x join pg_class t on t.oid=x.indrelid join pg_class i on i.oid=x.indexrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname=current_schema() and not exists(select 1 from pg_constraint k where k.conindid=i.oid)`.execute(
    db,
  );
  for (const row of indexes.rows)
    catalog.get(row.table_name)?.indexes.set(row.name, {
      signature: normalize(row.definition.replace(/ ON [^\s]+\./, " ON ")),
      ddl: source.get(row.table_name)?.indexes.get(row.name)?.ddl ?? "",
      unique: row.unique,
    });
  return catalog;
}
const sourcePromises = new WeakMap<
  (db: Kysely<any>) => Promise<void>,
  Promise<Catalog>
>();
function latestSource(create: (db: Kysely<any>) => Promise<void>) {
  let pending = sourcePromises.get(create);
  if (pending) return pending;
  pending = (async () => {
    const db = new Kysely<any>({
      dialect: new SqliteDialect({ database: new Sqlite(":memory:") }),
    });
    registerDriver(db, "sqlite");
    try {
      await create(db);
      return await sqliteCatalog(db);
    } finally {
      await db.destroy();
    }
  })();
  sourcePromises.set(create, pending);
  return pending;
}
async function latestPostgres(db: Kysely<any>, source: Catalog) {
  const previous = (
    await sql<{
      path: string;
    }>`select current_setting('search_path') as path`.execute(db)
  ).rows[0]!.path;
  // A reference catalog in session-local temporary tables avoids requiring database CREATE SCHEMA permission.
  await sql`select set_config('search_path', ${"pg_temp"}, true)`.execute(db);
  for (const table of source.values())
    await sql
      .raw(
        table.ddl
          .replace(/^create table/i, "create temporary table")
          .replace(/;$/, "") + " on commit drop",
      )
      .execute(db);
  for (const table of source.values())
    for (const index of table.indexes.values())
      await sql.raw(index.ddl).execute(db);
  const target = await postgresCatalog(db, source);
  for (const name of [...source.keys()].reverse())
    await sql.raw(`drop table pg_temp.${quote(name)} cascade`).execute(db);
  await sql`select set_config('search_path', ${previous}, true)`.execute(db);
  return target;
}

export function planSchemaChanges(
  actual: Catalog,
  target: Catalog,
  policy: SchemaPolicy,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  for (const [name, expected] of target) {
    const found = actual.get(name),
      creating = !found && policy.newTables.includes(name);
    if (!found) {
      changes.push(
        creating
          ? { kind: "create_table", table: name, sql: expected.ddl }
          : {
              kind: "review",
              table: name,
              reason:
                "missing table has no approved creation policy; possible data loss",
            },
      );
    } else {
      const added: string[] = [];
      for (const [column, definition] of expected.columns) {
        const current = found.columns.get(column);
        if (!current) {
          const safe =
            policy.newColumns.includes(`${name}.${column}`) &&
            !/\b(primary key|unique)\b/i.test(definition.definition) &&
            (!/\bnot null\b/i.test(definition.definition) ||
              /\bdefault\s+(?:'(?:''|[^'])*'|-?\d+(?:\.\d+)?)(?=\s|$)/i.test(
                definition.definition,
              ));
          changes.push(
            safe
              ? {
                  kind: "add_column",
                  table: name,
                  column,
                  sql: `alter table ${quote(name)} add column ${definition.definition}`,
                }
              : {
                  kind: "review",
                  table: name,
                  column,
                  reason:
                    "new column needs an explicit historical-value policy",
                },
          );
          if (safe) added.push(column);
        } else if (current.signature !== definition.signature)
          changes.push({
            kind: "review",
            table: name,
            column,
            reason: "column type, default or constraints changed",
            installed: current.signature,
            target: definition.signature,
          });
      }
      for (const column of found.columns.keys())
        if (!expected.columns.has(column))
          changes.push({
            kind: "review",
            table: name,
            column,
            reason: "column removal requires data preservation and approval",
          });
      // PostgreSQL exposes inline column checks as table constraints. ADD COLUMN creates these checks too.
      const deferred = (constraint: string) =>
        constraint.startsWith("check(") &&
        added.some(
          (column) =>
            expected.columns.get(column)!.definition.includes("check") &&
            constraint.includes(column),
        );
      const wanted = expected.constraints.filter((c) => !deferred(c));
      if (
        JSON.stringify(found.constraints.slice().sort()) !==
        JSON.stringify(wanted.slice().sort())
      )
        changes.push({
          kind: "review",
          table: name,
          reason: "primary, foreign, unique or check constraints changed",
          installed: JSON.stringify(found.constraints),
          target: JSON.stringify(wanted),
        });
    }
    for (const [index, definition] of expected.indexes) {
      const current = found?.indexes.get(index);
      if (!current && (creating || (!definition.unique && !!found)))
        changes.push({
          kind: "create_index",
          table: name,
          sql: definition.ddl,
        });
      else if (!current || current.signature !== definition.signature)
        changes.push({
          kind: "review",
          table: name,
          reason: `index ${index} requires validation`,
        });
    }
    for (const index of found?.indexes.keys() ?? [])
      if (!expected.indexes.has(index))
        changes.push({
          kind: "review",
          table: name,
          reason: `index ${index} removal requires review`,
        });
  }
  for (const name of actual.keys())
    if (!target.has(name) && !/^plugin_[a-f0-9]{56}$/.test(name))
      changes.push({
        kind: "review",
        table: name,
        reason:
          "unknown table retained; deletion requires ownership and data review",
      });
  return changes;
}

/** Caller owns the transaction and schema lock. Never partly apply a plan needing review. */
async function schemaContext(
  db: Kysely<any>,
  create: (db: Kysely<any>) => Promise<void>,
  policy: SchemaPolicy,
) {
  const source = await latestSource(create),
    pg = databaseDriver(db) === "postgres";
  const actual = pg
    ? await postgresCatalog(db, source)
    : await sqliteCatalog(db);
  const target = pg ? await latestPostgres(db, source) : source;
  const changes = planSchemaChanges(actual, target, policy);
  if (actual.get("schema_baseline")?.columns.has("structure_json")) {
    const previous = (
      await sql<{
        structure_json: string;
      }>`select structure_json from schema_baseline`.execute(db)
    ).rows[0];
    const footprint = JSON.parse(previous?.structure_json ?? "{}");
    if (!footprint || typeof footprint !== "object" || Array.isArray(footprint))
      throw new Error(
        "Invalid recorded database structure; no data was changed",
      );
    for (const [table, columns] of Object.entries(footprint) as [
      string,
      string[],
    ][]) {
      if (
        !Array.isArray(columns) ||
        columns.some((column) => typeof column !== "string")
      )
        throw new Error(
          "Invalid recorded database structure; no data was changed",
        );
      for (const column of columns)
        if (!actual.get(table)?.columns.has(column))
          changes.push({
            kind: "review",
            table,
            column,
            reason:
              "previously installed structure is missing; possible data loss, restore or review before upgrading",
          });
    }
  }
  return { source, target, changes, pg };
}

export async function inspectSchema(
  db: Kysely<any>,
  create: (db: Kysely<any>) => Promise<void>,
  policy: SchemaPolicy,
) {
  return (await schemaContext(db, create, policy)).changes;
}

export async function reconcileSchema(
  db: Kysely<any>,
  create: (db: Kysely<any>) => Promise<void>,
  policy: SchemaPolicy,
) {
  const { source, target, changes, pg } = await schemaContext(
    db,
    create,
    policy,
  );
  if (changes.some((c) => c.kind === "review"))
    throw new SchemaReviewRequired(changes);
  // Create all tables before indexes. Source table order retains FK dependencies.
  for (const kind of ["create_table", "add_column", "create_index"] as const)
    for (const change of changes.filter((c) => c.kind === kind))
      await sql.raw(change.sql!).execute(db);
  const checked = pg
    ? await postgresCatalog(db, source)
    : await sqliteCatalog(db);
  const remaining = planSchemaChanges(checked, target, policy);
  if (remaining.length) throw new SchemaReviewRequired(remaining);
  await recordSchemaStructure(db, create);
  return changes;
}

/** Record only the currently installed footprint, never an accumulating migration history. */
export async function recordSchemaStructure(
  db: Kysely<any>,
  create: (db: Kysely<any>) => Promise<void>,
) {
  const source = await latestSource(create);
  const footprint = Object.fromEntries(
    [...source].map(([name, table]) => [name, [...table.columns.keys()]]),
  );
  await sql`update schema_baseline set structure_json=${JSON.stringify(footprint)}`.execute(
    db,
  );
}
