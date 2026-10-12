import { expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import { createSchema } from "@db/create-schema.js";

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
