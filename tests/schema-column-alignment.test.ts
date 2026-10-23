import { afterEach, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { openTestDatabase } from "./database.js";
import { createCurrentStructure } from "@db/create-schema.js";
import { reconcileSchema } from "@db/schema-reconciliation.js";
import { databaseDriver, transact } from "@db/transactions.js";

const opened: Kysely<any>[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.destroy();
});
const parent = (
  value: string,
  optional: string,
) => `create table alignment_parents (
  id varchar(36) primary key, value ${value}, optional ${optional},
  payload text not null check(length(payload)>=0))`;
const child = `create table alignment_children (id varchar(36) primary key,
  parent_id varchar(36) not null references alignment_parents(id) on delete cascade,
  payload text not null)`;
const index = `create index alignment_parent_value on alignment_parents(value)`;
async function target(db: Kysely<any>, driver = databaseDriver(db)) {
  await createCurrentStructure(db, driver);
  await sql.raw(parent("text default 'target' not null", "text")).execute(db);
  await sql.raw(child).execute(db);
  await sql.raw(index).execute(db);
}
const policy = { newTables: [], newColumns: [], alignColumns: true };
async function fixture(value?: string, optional?: string) {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  opened.push(db);
  await sql
    .raw(
      parent(
        value ??
          (databaseDriver(db) === "postgres"
            ? "text default 'legacy'"
            : "text default 'target'"),
        optional ??
          (databaseDriver(db) === "postgres"
            ? "text not null default ''"
            : "text not null"),
      ),
    )
    .execute(db);
  await sql.raw(child).execute(db);
  await sql.raw(index).execute(db);
  await sql`insert into alignment_parents(id,value,optional,payload)
    values ('original','保留原值','原有可选值','{"version":1,"text":"\\u0000 保留正文"}')`.execute(
    db,
  );
  await sql`insert into alignment_children(id,parent_id,payload)
    values ('child','original','权限与引用必须保留')`.execute(db);
  return db;
}
async function align(db: Kysely<any>, failAfter = false) {
  const run = async (tx: Kysely<any>) => {
    const result = await reconcileSchema(tx, target, policy);
    if (failAfter) throw new Error("simulated failure after reconciliation");
    return result;
  };
  return transact(db as any, run);
}
async function retained(db: Kysely<any>) {
  return {
    parent: await sql`select * from alignment_parents order by id`.execute(db),
    child: await sql`select * from alignment_children order by id`.execute(db),
    baseline: await db.selectFrom("schema_baseline").selectAll().execute(),
  };
}
async function column(db: Kysely<any>, name: string) {
  if (databaseDriver(db) === "sqlite") {
    const result = (
      await sql<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>`pragma table_info(alignment_parents)`.execute(db)
    ).rows.find((r) => r.name === name)!;
    return { nullable: !result.notnull, defaultValue: result.dflt_value };
  }
  return (
    await sql<{
      nullable: boolean;
      defaultValue: string | null;
    }>`select is_nullable='YES' as nullable,
    column_default as "defaultValue" from information_schema.columns
    where table_schema=current_schema() and table_name='alignment_parents' and column_name=${name}`.execute(
      db,
    )
  ).rows[0]!;
}

it("aligns supported attributes with native ALTER, preserving parent, child, rowid and future defaults", async () => {
  const db = await fixture();
  const before = await retained(db);
  const pages =
    databaseDriver(db) === "sqlite"
      ? (
          await sql`select name,rootpage from sqlite_schema where name like 'alignment_%' order by name`.execute(
            db,
          )
        ).rows
      : undefined;
  const rowid =
    databaseDriver(db) === "sqlite"
      ? (await sql`select rowid from alignment_parents`.execute(db)).rows
      : undefined;
  await align(db);
  const after = await retained(db);
  expect(after.parent.rows).toEqual(before.parent.rows);
  expect(after.child.rows).toEqual(before.child.rows);
  expect(await column(db, "value")).toMatchObject({ nullable: false });
  expect(await column(db, "optional")).toEqual({
    nullable: true,
    defaultValue: null,
  });
  await sql`insert into alignment_parents(id,payload) values ('new','new body')`.execute(
    db,
  );
  expect(
    (
      await sql`select value,optional from alignment_parents where id='new'`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ value: "target", optional: null }]);
  if (rowid) {
    expect(
      (
        await sql`select name,rootpage from sqlite_schema where name like 'alignment_%' order by name`.execute(
          db,
        )
      ).rows,
    ).toEqual(pages);
    expect(
      (
        await sql`select rowid from alignment_parents where id='original'`.execute(
          db,
        )
      ).rows,
    ).toEqual(rowid);
    expect((await sql`pragma foreign_keys`.execute(db)).rows).toEqual([
      { foreign_keys: 1 },
    ]);
    expect((await sql`pragma foreign_key_check`.execute(db)).rows).toEqual([]);
    expect(
      (
        await sql`select count(*) as n from sqlite_schema where name='alignment_parent_value'`.execute(
          db,
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  }
  await Promise.all([align(db), align(db)]);
  expect((await retained(db)).child.rows).toEqual(before.child.rows);
  await sql`delete from alignment_parents where id='original'`.execute(db);
  expect(
    (await sql`select * from alignment_children`.execute(db)).rows,
  ).toEqual([]);
});

it("rejects existing NULL before changing defaults or recreating a missing ordinary index", async () => {
  const db = await fixture();
  await sql`update alignment_parents set value=null`.execute(db);
  await sql`drop index alignment_parent_value`.execute(db);
  const before = await retained(db);
  await expect(align(db)).rejects.toThrow(/existing NULL/);
  expect(await retained(db)).toEqual(before);
  expect(await column(db, "value")).toMatchObject({ nullable: true });
  if (databaseDriver(db) === "sqlite") {
    expect(
      (
        await sql`select name from sqlite_schema where name='alignment_parent_value'`.execute(
          db,
        )
      ).rows,
    ).toEqual([]);
    expect((await sql`pragma foreign_keys`.execute(db)).rows).toEqual([
      { foreign_keys: 1 },
    ]);
  } else
    expect(
      (
        await sql`select 1 from pg_indexes where schemaname=current_schema() and indexname='alignment_parent_value'`.execute(
          db,
        )
      ).rows,
    ).toEqual([]);
});

it("rejects a type conversion without applying otherwise allowed attribute changes", async () => {
  const db = await fixture("varchar(128) default 'legacy'");
  const before = await retained(db);
  await expect(align(db)).rejects.toThrow(
    /column type, default or constraints changed/,
  );
  expect(await retained(db)).toEqual(before);
  expect(await column(db, "optional")).toMatchObject({ nullable: false });
});

it("rolls back defaults, nullability, indexes and every retained row after a later failure", async () => {
  const db = await fixture();
  const before = await retained(db),
    definition = await column(db, "value");
  await expect(align(db, true)).rejects.toThrow(/simulated failure/);
  expect(await retained(db)).toEqual(before);
  expect(await column(db, "value")).toEqual(definition);
  await align(db);
  expect((await retained(db)).parent.rows).toEqual(before.parent.rows);
});

it.skipIf(!!process.env.DOCA_TEST_POSTGRES)(
  "rejects unknown SQLite triggers before changing any field",
  async () => {
    const db = await fixture();
    await sql`create trigger alignment_retained_trigger after update on alignment_parents begin select 1; end`.execute(
      db,
    );
    const before = await retained(db);
    await expect(align(db)).rejects.toThrow(/alignment_retained_trigger/);
    expect(await retained(db)).toEqual(before);
    expect(
      (
        await sql`select name from sqlite_schema where type='trigger'`.execute(
          db,
        )
      ).rows,
    ).toEqual([{ name: "alignment_retained_trigger" }]);
  },
);

it.skipIf(!!process.env.DOCA_TEST_POSTGRES)(
  "rejects unsupported SQLite default changes without replacing tables or touching data",
  async () => {
    const db = await fixture("text default 'legacy'");
    const before = await retained(db);
    const ddl = (
      await sql`select name,sql from sqlite_schema order by name`.execute(db)
    ).rows;
    await expect(align(db)).rejects.toThrow(/SQLite DEFAULT/);
    expect(await retained(db)).toEqual(before);
    expect(
      (await sql`select name,sql from sqlite_schema order by name`.execute(db))
        .rows,
    ).toEqual(ddl);
  },
);

it.skipIf(!!process.env.DOCA_TEST_POSTGRES)(
  "keeps foreign-key SET DEFAULT and SET NULL distinct from column defaults and nullability",
  async () => {
    const db = await fixture();
    await sql`drop table alignment_children`.execute(db);
    await sql`create table alignment_children (id varchar(36) primary key,
    parent_id varchar(36) references alignment_parents(id) on delete set default not null,
    payload text not null)`.execute(db);
    await sql`insert into alignment_children values ('child','original','保留引用')`.execute(
      db,
    );
    const before = await retained(db);
    async function differentReference(
      tx: Kysely<any>,
      driver = databaseDriver(tx),
    ) {
      await createCurrentStructure(tx, driver);
      await sql
        .raw(parent("text default 'target' not null", "text"))
        .execute(tx);
      await sql`create table alignment_children (id varchar(36) primary key,
      parent_id varchar(36) references alignment_parents(id) on delete set null not null,
      payload text not null)`.execute(tx);
      await sql.raw(index).execute(tx);
    }
    await expect(
      transact(db as any, (tx) =>
        reconcileSchema(tx, differentReference, policy),
      ),
    ).rejects.toThrow(/column type, default or constraints changed/);
    expect(await retained(db)).toEqual(before);
    expect(
      (
        await sql<{
          on_delete: string;
        }>`pragma foreign_key_list(alignment_children)`.execute(db)
      ).rows[0]!.on_delete,
    ).toBe("SET DEFAULT");
  },
);
