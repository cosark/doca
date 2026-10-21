import { afterEach, beforeEach, expect, it } from "vitest";
import { sql } from "kysely";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { authenticateBrowserConnection } from "@core/modules/browser-clipper/access.js";
import type { DB } from "@db/index.js";
import { openTestDatabase, testTableColumns } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createSchema, CURRENT_SCHEMA_BASELINE } from "@db/create-schema.js";
import { browserClipperTables } from "@db/browser-clipper-schema.js";
let db: DB;
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  await createUser(
    db,
    {
      login: "retainedclipper",
      displayName: "Keep original",
      password: "isolated-schema-password",
    },
    { bootstrap: true },
  );
});
afterEach(async () => db.destroy());
async function precedingStructure() {
  const baseline = await db
      .selectFrom("schema_baseline")
      .selectAll()
      .executeTakeFirstOrThrow(),
    footprint = JSON.parse(baseline.structure_json!);
  for (const table of [...browserClipperTables].reverse()) {
    await sql.raw(`drop table "${table}"`).execute(db);
    delete footprint[table];
  }
  await db
    .updateTable("schema_baseline")
    .set({ structure_json: JSON.stringify(footprint) })
    .execute();
}
it("adds seven empty tables under the current generation and retains rows through repeated/concurrent startup", async () => {
  await precedingStructure();
  const users = await db.selectFrom("users").selectAll().execute(),
    settings = await db.selectFrom("settings").selectAll().execute();
  await createSchema(db);
  await Promise.all([createSchema(db), createSchema(db)]);
  expect(await db.selectFrom("users").selectAll().execute()).toEqual(users);
  expect(await db.selectFrom("settings").selectAll().execute()).toEqual(
    settings,
  );
  for (const table of browserClipperTables)
    expect(await db.selectFrom(table).selectAll().execute()).toEqual([]);
  expect(
    (
      await db
        .selectFrom("schema_baseline")
        .select("id")
        .executeTakeFirstOrThrow()
    ).id,
  ).toBe(CURRENT_SCHEMA_BASELINE);
});
it("rejects review-required differences without partially applying clipper additions", async () => {
  await precedingStructure();
  await sql`create table retained_unknown (id text primary key, body text not null)`.execute(
    db,
  );
  await sql`insert into retained_unknown values ('original','retain')`.execute(
    db,
  );
  const baseline = await db.selectFrom("schema_baseline").selectAll().execute();
  await expect(createSchema(db)).rejects.toThrow("retained_unknown");
  const names = (await testTableColumns(db)).map((table) => table.name);
  for (const table of browserClipperTables) expect(names).not.toContain(table);
  expect(await db.selectFrom("schema_baseline").selectAll().execute()).toEqual(
    baseline,
  );
  expect(
    (await sql`select body from retained_unknown`.execute(db)).rows,
  ).toEqual([{ body: "retain" }]);
});
it("refuses to silently recreate an installed clipper table that was lost", async () => {
  await sql`drop table browser_clipper_assistant_sessions`.execute(db);
  const baseline = await db.selectFrom("schema_baseline").selectAll().execute();
  await expect(createSchema(db)).rejects.toThrow("possible data loss");
  expect(await db.selectFrom("schema_baseline").selectAll().execute()).toEqual(
    baseline,
  );
});

it("adds the website-session tables while retaining unreleased v1 credentials as inactive facts", async () => {
  const user = await db
    .selectFrom("users")
    .select("id")
    .where("login", "=", "retainedclipper")
    .executeTakeFirstOrThrow();
  const id = randomUUID(),
    token = "doca_browser_v1_" + randomBytes(32).toString("hex"),
    now = new Date().toISOString();
  await db
    .insertInto("browser_clipper_connections")
    .values({
      id,
      user_id: user.id,
      name: "Prelaunch fixture",
      token_hash: createHash("sha256").update(token).digest("hex"),
      token_hint: token.slice(-8),
      assistant_enabled: 1,
      revoked_at: null,
      expires_at: "2099-01-01T00:00:00Z",
      revision: 3,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const before = await db
    .selectFrom("browser_clipper_connections")
    .selectAll()
    .execute();
  const baseline = await db
      .selectFrom("schema_baseline")
      .selectAll()
      .executeTakeFirstOrThrow(),
    footprint = JSON.parse(baseline.structure_json!);
  for (const table of [
    "browser_clipper_login_codes",
    "browser_clipper_web_sessions",
  ]) {
    await sql.raw(`drop table "${table}"`).execute(db);
    delete footprint[table];
  }
  await db
    .updateTable("schema_baseline")
    .set({ structure_json: JSON.stringify(footprint) })
    .execute();
  await createSchema(db);
  await Promise.all([createSchema(db), createSchema(db)]);
  expect(
    await db.selectFrom("browser_clipper_connections").selectAll().execute(),
  ).toEqual(before);
  expect(
    await db.selectFrom("browser_clipper_web_sessions").selectAll().execute(),
  ).toEqual([]);
  await expect(
    authenticateBrowserConnection(db, "Bearer " + token),
  ).rejects.toThrow("clipper_token_required");
});
