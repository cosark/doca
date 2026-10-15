import Sqlite from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "@db/connection.js";
import { CURRENT_SCHEMA_BASELINE } from "@db/create-schema.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function oldDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "doca-schema-upgrade-"));
  directories.push(directory);
  const path = join(directory, "test.db");
  const db = await openDatabase({ driver: "sqlite", path });
  const now = new Date().toISOString();
  await db
    .insertInto("users")
    .values({
      id: "owner",
      login: "owner",
      display_name: "Owner",
      password_hash: "test-only",
      admin: 0,
      status: "active",
      created_at: now,
    })
    .execute();
  await db
    .insertInto("file_folders")
    .values({
      id: "folder",
      owner_id: "owner",
      name: "保留资料",
      parent_id: "shared",
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      delete_batch: null,
    })
    .execute();
  await db
    .insertInto("file_folder_share_links")
    .values({
      folder_id: "folder",
      token: "original-token",
      token_hash: "original-hash",
      role: "reader",
      enabled: 1,
      created_by: "owner",
      created_at: now,
      updated_at: now,
      max_members: null,
      expires_at: null,
      revision: 1,
    })
    .execute();
  await db.destroy();
  const raw = new Sqlite(path);
  raw.exec(
    "alter table schema_baseline drop column structure_json; drop table file_folder_invitations; drop table file_folder_link_members; alter table file_folder_share_links drop column max_members; alter table file_folder_share_links drop column expires_at; alter table file_folder_share_links drop column revision",
  );
  raw.close();
  return path;
}
it("smoothly upgrades the prior folder schema, preserves every old value and is idempotent", async () => {
  const path = await oldDatabase();
  let db = await openDatabase({ driver: "sqlite", path });
  try {
    const link = await db
      .selectFrom("file_folder_share_links")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(link).toMatchObject({
      token: "original-token",
      token_hash: "original-hash",
      enabled: 1,
      max_members: null,
      expires_at: null,
      revision: 1,
    });
    expect(
      (
        await db
          .selectFrom("file_folders")
          .selectAll()
          .executeTakeFirstOrThrow()
      ).name,
    ).toBe("保留资料");
    expect(
      (
        await db
          .selectFrom("schema_baseline")
          .select("id")
          .executeTakeFirstOrThrow()
      ).id,
    ).toBe(CURRENT_SCHEMA_BASELINE);
    expect(
      await db.selectFrom("file_folder_invitations").selectAll().execute(),
    ).toEqual([]);
    expect(
      await db.selectFrom("file_folder_link_members").selectAll().execute(),
    ).toEqual([]);
    await db
      .updateTable("file_folder_share_links")
      .set({ max_members: 7, revision: 2 })
      .execute();
  } finally {
    await db.destroy();
  }
  db = await openDatabase({ driver: "sqlite", path });
  try {
    expect(
      await db
        .selectFrom("file_folder_share_links")
        .selectAll()
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ token: "original-token", max_members: 7, revision: 2 });
  } finally {
    await db.destroy();
  }
});
it("reports destructive differences before applying even safe additions", async () => {
  const path = await oldDatabase(),
    raw = new Sqlite(path);
  raw.exec(
    "create table retired_business_data(id text primary key, value text); insert into retired_business_data values ('retained','不要删除')",
  );
  raw.close();
  await expect(openDatabase({ driver: "sqlite", path })).rejects.toThrow(
    /retired_business_data/,
  );
  const check = new Sqlite(path);
  try {
    expect(
      check.prepare("select value from retired_business_data").get(),
    ).toEqual({ value: "不要删除" });
    expect(
      check
        .prepare("pragma table_info(file_folder_share_links)")
        .all()
        .map((r: any) => r.name),
    ).not.toContain("max_members");
    expect(
      check
        .prepare(
          "select name from sqlite_schema where name='file_folder_invitations'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    check.close();
  }
});
it("requires review for changed defaults", async () => {
  const path = await oldDatabase(),
    raw = new Sqlite(path);
  raw.exec(
    "alter table file_folder_share_links add column revision integer default 7 not null",
  );
  raw.close();
  await expect(openDatabase({ driver: "sqlite", path })).rejects.toThrow(
    /column type, default or constraints changed/,
  );
  const check = new Sqlite(path);
  try {
    expect(
      (
        check
          .prepare("select revision from file_folder_share_links")
          .get() as any
      ).revision,
    ).toBe(7);
  } finally {
    check.close();
  }
});
it("detects missing previously installed fields without silently restoring security defaults", async () => {
  const path = await oldDatabase();
  const db = await openDatabase({ driver: "sqlite", path });
  await db
    .updateTable("file_folder_share_links")
    .set({ max_members: 3 })
    .execute();
  await db.destroy();
  const raw = new Sqlite(path);
  raw.exec("alter table file_folder_share_links drop column max_members");
  raw.close();
  await expect(openDatabase({ driver: "sqlite", path })).rejects.toThrow(
    /previously installed structure is missing/,
  );
});
it("serializes upgrades from two SQLite connections", async () => {
  const path = await oldDatabase();
  const connections = await Promise.all([
    openDatabase({ driver: "sqlite", path }),
    openDatabase({ driver: "sqlite", path }),
  ]);
  try {
    for (const db of connections)
      expect(
        await db
          .selectFrom("file_folder_share_links")
          .selectAll()
          .executeTakeFirstOrThrow(),
      ).toMatchObject({
        token: "original-token",
        max_members: null,
        revision: 1,
      });
  } finally {
    await Promise.all(connections.map((db) => db.destroy()));
  }
});
it("rejects invalid installed footprints before changing user data", async () => {
  const path = await oldDatabase(),
    db = await openDatabase({ driver: "sqlite", path });
  await db
    .updateTable("schema_baseline")
    .set({ structure_json: "[]" })
    .execute();
  await db.destroy();
  await expect(openDatabase({ driver: "sqlite", path })).rejects.toThrow(
    /Invalid recorded database structure/,
  );
});
it("rejects old colocated plugin tables without changing core structure or plugin data", async () => {
  const path = await oldDatabase(),
    raw = new Sqlite(path),
    name = "plugin_" + "a".repeat(56);
  raw.exec(
    `create table ${name}(id text primary key, value text); insert into ${name} values ('retained','plugin-data')`,
  );
  raw.close();
  await expect(openDatabase({ driver: "sqlite", path })).rejects.toThrow(
    "schema changes require review",
  );
  const check = new Sqlite(path);
  try {
    expect(check.prepare(`select value from ${name}`).get()).toEqual({
      value: "plugin-data",
    });
  } finally {
    check.close();
  }
});
