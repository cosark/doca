import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import {
  clearFileTrash,
  previewFileTrashClear,
} from "@server/services/file-trash-clear.js";
import { createApp } from "@server/app/create-app.js";
import type { DB } from "@db/index.js";

let db: DB, owner: string, other: string, object: string;
const now = "2026-10-21T00:00:00.000Z";
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const admin = await createUser(
    db,
    {
      login: "trash-owner",
      displayName: "Owner",
      password: "isolated-trash-password",
    },
    { bootstrap: true },
  );
  owner = admin.id;
  other = (
    await createUser(
      db,
      {
        login: "trash-other",
        displayName: "Other",
        password: "isolated-trash-password",
      },
      { actor: { ...admin, admin: 1 } },
    )
  ).id;
  const profile = randomUUID();
  object = randomUUID();
  await db
    .insertInto("storage_profiles")
    .values({ id: profile, active: 0, created_at: now })
    .execute();
  await db
    .insertInto("file_storage_objects")
    .values({
      id: object,
      profile_id: profile,
      object_key: randomUUID(),
      sha256: "0".repeat(64),
      size: 1,
      mime: "text/plain",
      created_at: now,
    })
    .execute();
});
afterEach(async () => {
  await db?.destroy();
});

async function folder(
  deleted = true,
  parent: string | null = null,
  user = owner,
) {
  const id = randomUUID();
  await db
    .insertInto("file_folders")
    .values({
      id,
      owner_id: user,
      parent_id: parent,
      name: id,
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: deleted ? now : null,
      delete_batch: null,
    })
    .execute();
  return id;
}
function item(user = owner, deleted = true, parent: string | null = null) {
  return {
    id: randomUUID(),
    owner_id: user,
    parent_type: parent ? ("folder" as const) : ("system" as const),
    parent_id: parent ?? "root",
    storage_object_id: object,
    name: "synthetic.txt",
    mime: "text/plain",
    size: 1,
    metadata: "{}",
    ai_description_override: null,
    locked: 0,
    version: 1,
    created_at: now,
    updated_at: now,
    deleted_at: deleted ? now : null,
    delete_batch: null,
  };
}

it("clears the entire confirmed owned trash beyond the 500-row display cap, preserving active/other files and stored objects", async () => {
  const parent = await folder(),
    child = await folder(true, parent);
  const deleted = Array.from({ length: 503 }, () => item(owner, true, child));
  const active = item(owner, false),
    foreign = item(other);
  for (let offset = 0; offset < deleted.length; offset += 50)
    await db
      .insertInto("file_items")
      .values(deleted.slice(offset, offset + 50))
      .execute();
  await db.insertInto("file_items").values([active, foreign]).execute();
  const preview = await previewFileTrashClear(db, owner);
  expect(preview).toMatchObject({
    fileCount: 503,
    folderCount: 2,
    omitted: 455,
  });
  expect(preview.names).toHaveLength(50);
  const enqueue = vi.fn(async (_tx: DB, _id: string) => {});
  expect(
    await clearFileTrash(db, owner, preview.fingerprint, enqueue),
  ).toMatchObject({ fileCount: 503, folderCount: 2 });
  expect(enqueue).toHaveBeenCalledTimes(503);
  expect(
    (await db.selectFrom("file_items").select("id").execute())
      .map((row) => row.id)
      .sort(),
  ).toEqual([active.id, foreign.id].sort());
  expect(await db.selectFrom("file_folders").select("id").execute()).toEqual(
    [],
  );
  expect(
    await db
      .selectFrom("file_storage_objects")
      .select("id")
      .where("id", "=", object)
      .execute(),
  ).toHaveLength(1);
});

it("rejects a stale confirmation after restoration or newly trashed content without deleting any other entry", async () => {
  const a = item(),
    b = item();
  await db.insertInto("file_items").values([a, b]).execute();
  const preview = await previewFileTrashClear(db, owner);
  await db
    .updateTable("file_items")
    .set({ deleted_at: null, version: 2 })
    .where("id", "=", a.id)
    .execute();
  const enqueue = vi.fn(async () => {});
  await expect(
    clearFileTrash(db, owner, preview.fingerprint, enqueue),
  ).rejects.toMatchObject({ status: 409 });
  const second = await previewFileTrashClear(db, owner);
  await db.insertInto("file_items").values(item()).execute();
  await expect(
    clearFileTrash(db, owner, second.fingerprint, enqueue),
  ).rejects.toMatchObject({ status: 409 });
  expect(enqueue).not.toHaveBeenCalled();
  expect(await db.selectFrom("file_items").select("id").execute()).toHaveLength(
    3,
  );
});

it("refuses folders containing active or other-user content and rolls back a failed indexing transaction", async () => {
  const parent = await folder(),
    live = item(owner, false, parent),
    deleted = item();
  await db.insertInto("file_items").values([live, deleted]).execute();
  let preview = await previewFileTrashClear(db, owner);
  await expect(
    clearFileTrash(db, owner, preview.fingerprint, async () => {}),
  ).rejects.toMatchObject({ status: 409 });
  await db.deleteFrom("file_items").where("id", "=", live.id).execute();
  const foreign = await folder(true, parent, other);
  await expect(
    clearFileTrash(db, owner, preview.fingerprint, async () => {}),
  ).rejects.toMatchObject({ status: 409 });
  await db.deleteFrom("file_folders").where("id", "=", foreign).execute();
  preview = await previewFileTrashClear(db, owner);
  await expect(
    clearFileTrash(db, owner, preview.fingerprint, async () => {
      throw Error("queue unavailable");
    }),
  ).rejects.toThrow("queue unavailable");
  expect(
    await db
      .selectFrom("file_items")
      .select("id")
      .where("id", "=", deleted.id)
      .execute(),
  ).toHaveLength(1);
  expect(
    await db
      .selectFrom("file_folders")
      .select("id")
      .where("id", "=", parent)
      .execute(),
  ).toHaveLength(1);
});

it("requires authenticated confirmation and binds it to the signed-in owner", async () => {
  await db.insertInto("file_items").values(item()).execute();
  const app = await createApp(db, { origin: "http://localhost:39130" });
  try {
    expect(
      (
        await app.inject({
          url: "/api/v1/files/trash/clear-preview",
          headers: { host: "localhost:39130" },
        })
      ).statusCode,
    ).toBe(401);
    const preview = await previewFileTrashClear(db, owner);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { host: "localhost:39130", origin: "http://localhost:39130" },
      payload: { login: "trash-other", password: "isolated-trash-password" },
    });
    const headers = {
      host: "localhost:39130",
      origin: "http://localhost:39130",
      cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    };
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/files/trash/clear",
      headers,
      payload: { fingerprint: preview.fingerprint },
    });
    expect(denied.statusCode, denied.body).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/files/trash/clear",
          headers,
          payload: { fingerprint: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      await db.selectFrom("file_items").select("id").execute(),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it("also prevents a single folder purge from deleting restored or foreign children", async () => {
  const parent = await folder(),
    deleted = item(owner, true, parent),
    restored = item(owner, false, parent);
  await db.insertInto("file_items").values([deleted, restored]).execute();
  const app = await createApp(db, { origin: "http://localhost:39130" });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { host: "localhost:39130", origin: "http://localhost:39130" },
      payload: { login: "trash-owner", password: "isolated-trash-password" },
    });
    const headers = {
      host: "localhost:39130",
      origin: "http://localhost:39130",
      cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    };
    const purge = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/files/trash/purge",
        headers,
        payload: { kind: "folder", id: parent },
      });
    expect((await purge()).statusCode).toBe(409);
    expect(
      await db.selectFrom("file_items").select("id").execute(),
    ).toHaveLength(2);
    await db
      .updateTable("file_items")
      .set({ parent_type: "system", parent_id: "root" })
      .where("id", "=", restored.id)
      .execute();
    const foreign = item(other, true, parent);
    await db.insertInto("file_items").values(foreign).execute();
    expect((await purge()).statusCode).toBe(409);
    expect(
      await db.selectFrom("file_items").select("id").execute(),
    ).toHaveLength(3);
    await db.deleteFrom("file_items").where("id", "=", foreign.id).execute();
    expect((await purge()).statusCode).toBe(200);
    expect(
      (await db.selectFrom("file_items").select("id").execute()).map(
        (row) => row.id,
      ),
    ).toEqual([restored.id]);
    expect(await db.selectFrom("file_folders").select("id").execute()).toEqual(
      [],
    );
  } finally {
    await app.close();
  }
});
