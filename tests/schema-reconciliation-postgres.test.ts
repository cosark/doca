import { currentSchemaTables } from "@db/introspection.js";
import { expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import { createSchema } from "@db/create-schema.js";
import { openDatabase } from "@db/connection.js";
import { sql } from "kysely";

it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "upgrades and rechecks an isolated PostgreSQL old schema",
  async () => {
    const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
    try {
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
      await db.schema
        .alterTable("schema_baseline")
        .dropColumn("structure_json")
        .execute();
      await db.schema.dropTable("file_folder_invitations").execute();
      await db.schema.dropTable("file_folder_link_members").execute();
      for (const column of ["max_members", "expires_at", "revision"])
        await db.schema
          .alterTable("file_folder_share_links")
          .dropColumn(column)
          .execute();
      await Promise.all([createSchema(db), createSchema(db)]);
      expect(
        await db
          .selectFrom("file_folder_share_links")
          .selectAll()
          .executeTakeFirstOrThrow(),
      ).toMatchObject({
        token: "original-token",
        max_members: null,
        expires_at: null,
        revision: 1,
      });
      expect(
        await db.selectFrom("file_folder_invitations").selectAll().execute(),
      ).toEqual([]);
      const baseline = await db
        .selectFrom("schema_baseline")
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(typeof baseline.structure_json).toBe("string");
      expect(
        JSON.parse(baseline.structure_json!).file_folder_invitations,
      ).toBeDefined();
      const version = (
        await sql<{
          server_version_num: string;
        }>`show server_version_num`.execute(db)
      ).rows[0]!.server_version_num;
      if (Number(version) >= 180000) {
        const constraints = await sql<{ definition: string }>`
          select pg_get_constraintdef(oid) as definition from pg_constraint
          where contype='n' and conrelid='file_folder_share_links'::regclass`.execute(
          db,
        );
        expect(constraints.rows.map((row) => row.definition)).toContain(
          "NOT NULL revision",
        );
      }
      await createSchema(db);
      await db.schema
        .createTable("retained_business_data")
        .addColumn("id", "text")
        .execute();
      await expect(createSchema(db)).rejects.toThrow(/retained_business_data/);
      expect(
        await db
          .selectFrom("file_folder_share_links")
          .selectAll()
          .executeTakeFirstOrThrow(),
      ).toMatchObject({ token: "original-token", max_members: null });
    } finally {
      await db.destroy();
    }
  },
);

it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "aligns existing PostgreSQL column nullability after validating old rows",
  async () => {
    const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
    try {
      await sql`alter table file_folder_share_links alter column revision drop not null`.execute(
        db,
      );
      await createSchema(db);
      const column = (await currentSchemaTables(db))
        .find((table) => table.name === "file_folder_share_links")!
        .columns.find((column) => column.name === "revision")!;
      expect(column.isNullable).toBe(false);
    } finally {
      await db.destroy();
    }
  },
);

it.skipIf(!process.env.DOCA_TEST_POSTGRES)(
  "stores candidates, widens old PostgreSQL purpose lengths, and rejects shrinking without partial writes",
  async () => {
    const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
    const width = async () =>
      (
        await sql<{ width: number }>`select character_maximum_length as width
        from information_schema.columns where table_schema=current_schema()
        and table_name='assets' and column_name='purpose'`.execute(db)
      ).rows[0]!.width;
    try {
      expect(await width()).toBe(32);
      const sqlite = await openDatabase({ driver: "sqlite", path: ":memory:" });
      try {
        await createSchema(sqlite);
        const ddl = await sql<{
          sql: string;
        }>`select sql from sqlite_schema where name='assets'`.execute(sqlite);
        expect(ddl.rows[0]!.sql).toContain('"purpose" varchar(16)');
      } finally {
        await sqlite.destroy();
      }
      const now = new Date().toISOString();
      await db
        .insertInto("users")
        .values({
          id: "image-owner",
          login: "image-owner",
          display_name: "Retained owner",
          password_hash: "test-only",
          admin: 0,
          status: "active",
          created_at: now,
        })
        .execute();
      await db
        .insertInto("storage_profiles")
        .values({ id: "test-images", active: 0, created_at: now })
        .execute();
      await db
        .insertInto("assets")
        .values({
          id: "candidate",
          owner_id: "image-owner",
          purpose: "ai_image_candidate",
          profile_id: "test-images",
          object_key: "original.png",
          filename: "original.png",
          mime: "image/png",
          size: 42,
          created_at: now,
        })
        .execute();
      const saved = await db.selectFrom("assets").selectAll().execute();
      await Promise.all([createSchema(db), createSchema(db)]);
      await createSchema(db);
      expect(await db.selectFrom("assets").selectAll().execute()).toEqual(
        saved,
      );
      expect(await width()).toBe(32);

      // A synthetic old-width fixture supplements the actual released-version QA.
      await db.updateTable("assets").set({ purpose: "document" }).execute();
      await sql`alter table assets alter column purpose type varchar(16)`.execute(
        db,
      );
      await sql`drop index assets_resource`.execute(db);
      const oldRows = await db.selectFrom("assets").selectAll().execute();
      await Promise.all([createSchema(db), createSchema(db)]);
      expect(await width()).toBe(32);
      expect(await db.selectFrom("assets").selectAll().execute()).toEqual(
        oldRows,
      );
      await sql`alter table assets alter column purpose type varchar(64)`.execute(
        db,
      );
      await sql`drop index assets_resource`.execute(db);
      const retained = await db.selectFrom("assets").selectAll().execute();
      const baseline = await db
        .selectFrom("schema_baseline")
        .selectAll()
        .execute();
      for (const result of await Promise.allSettled([
        createSchema(db),
        createSchema(db),
      ])) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({
            changes: expect.arrayContaining([
              expect.objectContaining({
                kind: "review",
                table: "assets",
                column: "purpose",
              }),
            ]),
          });
      }
      expect(await width()).toBe(64);
      expect(await db.selectFrom("assets").selectAll().execute()).toEqual(
        retained,
      );
      expect(
        await db.selectFrom("schema_baseline").selectAll().execute(),
      ).toEqual(baseline);
      expect(
        (
          await sql`select 1 from pg_indexes where schemaname=current_schema()
        and indexname='assets_resource'`.execute(db)
        ).rows,
      ).toEqual([]);
    } finally {
      await db.destroy();
    }
  },
);
