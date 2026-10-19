import { afterEach, beforeEach, expect, it } from "vitest";
import { sql } from "kysely";
import { openTestDatabase, testTableColumns } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createSchema, CURRENT_SCHEMA_BASELINE } from "@db/create-schema.js";
import { mcpTables } from "@db/mcp-schema.js";
import type { DB } from "@db/index.js";

let db: DB, userId: string;
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  userId = (
    await createUser(
      db,
      {
        login: "mcpupgrade",
        displayName: "Keep me",
        password: "isolated-upgrade-password",
      },
      { bootstrap: true },
    )
  ).id;
  await db
    .insertInto("ai_mcp_keys")
    .values({
      id: "retained-retired-key",
      user_id: userId,
      name: "Old credential archive",
      token_hash: "old-hash",
      resource_ids: "[]",
      writable: 0,
      expires_at: "2030-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    })
    .execute();
});
afterEach(async () => db.destroy());
async function priorStructure() {
  const baseline = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .executeTakeFirstOrThrow();
  const footprint = JSON.parse(baseline.structure_json!);
  for (const table of [...mcpTables].reverse()) {
    await sql.raw(`drop table "${table}"`).execute(db);
    delete footprint[table];
  }
  await db
    .updateTable("schema_baseline")
    .set({ structure_json: JSON.stringify(footprint) })
    .execute();
}
it("adds empty MCP tables, retains old records and generation, and tolerates repeated/concurrent startup", async () => {
  await priorStructure();
  const users = await db.selectFrom("users").selectAll().execute(),
    keys = await db.selectFrom("ai_mcp_keys").selectAll().execute();
  await createSchema(db);
  await Promise.all([createSchema(db), createSchema(db)]);
  expect(await db.selectFrom("users").selectAll().execute()).toEqual(users);
  expect(await db.selectFrom("ai_mcp_keys").selectAll().execute()).toEqual(
    keys,
  );
  for (const table of mcpTables)
    expect(await db.selectFrom(table).selectAll().execute()).toEqual([]);
  const baseline = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .executeTakeFirstOrThrow();
  expect(baseline.id).toBe(CURRENT_SCHEMA_BASELINE);
  expect(Object.keys(JSON.parse(baseline.structure_json!))).toEqual(
    expect.arrayContaining([...mcpTables]),
  );
});
it("stops before adding MCP tables when another structural difference requires review", async () => {
  await priorStructure();
  await sql`create table retained_business_data (id text primary key, body text not null)`.execute(
    db,
  );
  await sql`insert into retained_business_data (id, body) values ('keep', 'original')`.execute(
    db,
  );
  const footprint = await db
    .selectFrom("schema_baseline")
    .selectAll()
    .execute();
  await expect(createSchema(db)).rejects.toThrow("retained_business_data");
  const tables = await testTableColumns(db);
  for (const table of mcpTables)
    expect(tables.some((item) => item.name === table)).toBe(false);
  expect(await db.selectFrom("schema_baseline").selectAll().execute()).toEqual(
    footprint,
  );
  expect(
    (await sql`select body from retained_business_data`.execute(db)).rows,
  ).toEqual([{ body: "original" }]);
});
it("does not silently recreate a previously installed MCP table after data loss", async () => {
  await db
    .insertInto("mcp_user_settings")
    .values({
      user_id: userId,
      enabled: 1,
      revision: 2,
      updated_at: "2026-10-20T00:00:00.000Z",
    })
    .execute();
  await sql`drop table mcp_user_settings`.execute(db);
  const baseline = await db.selectFrom("schema_baseline").selectAll().execute();
  await expect(createSchema(db)).rejects.toThrow("possible data loss");
  expect(
    (await testTableColumns(db)).some(
      (table) => table.name === "mcp_user_settings",
    ),
  ).toBe(false);
  expect(await db.selectFrom("schema_baseline").selectAll().execute()).toEqual(
    baseline,
  );
  expect(
    (await db.selectFrom("ai_mcp_keys").selectAll().execute())[0]?.token_hash,
  ).toBe("old-hash");
});
