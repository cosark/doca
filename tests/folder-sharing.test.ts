import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import type { DB } from "@db/index.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import { createFolderSharing } from "@core/modules/access/folder-sharing.js";
import { createTickets } from "@core/modules/tickets/service.js";

let db: DB,
  owner: Actor,
  alice: Actor,
  bob: Actor,
  admin: Actor,
  folderId: string;
async function testActor(
  ...args: Parameters<typeof createUser>
): Promise<Actor> {
  const user = await createUser(...args);
  return { ...user, admin: Number(user.admin) };
}
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  admin = await testActor(
    db,
    { login: "admin", displayName: "Admin", password: "test-only-password" },
    { bootstrap: true },
  );
  owner = await testActor(
    db,
    { login: "owner", displayName: "Owner", password: "test-only-password" },
    { actor: admin },
  );
  alice = await testActor(
    db,
    { login: "alice", displayName: "Alice", password: "test-only-password" },
    { actor: admin },
  );
  bob = await testActor(
    db,
    { login: "bob", displayName: "Bob", password: "test-only-password" },
    { actor: admin },
  );
  folderId = randomUUID();
  const now = new Date().toISOString();
  await db
    .insertInto("file_folders")
    .values({
      id: folderId,
      owner_id: owner.id,
      parent_id: "shared",
      name: "Private folder",
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      delete_batch: null,
    })
    .execute();
});
afterEach(async () => {
  await db?.destroy();
});

it("serializes concurrent admissions so a one-person link cannot overfill", async () => {
  const service = createFolderSharing(db),
    link = await service.setLink(owner, folderId, {
      enabled: true,
      role: "reader",
    });
  const results = await Promise.allSettled([
    service.redeem(alice, link.token!),
    service.redeem(bob, link.token!),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 403 },
  });
  expect((await service.linkInfo(owner, folderId)).memberCount).toBe(1);
});
it("enforces expiry and revisions and never lets a manager adjust administrative roles", async () => {
  const service = createFolderSharing(db);
  await service.invite(owner, folderId, { userId: alice.id, role: "admin" });
  const link = await service.setLink(owner, folderId, {
    enabled: true,
    role: "admin",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await expect(
    service.setLink(alice, folderId, { enabled: true, role: "reader" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.invite(alice, folderId, { userId: bob.id, role: "admin" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.setLink(owner, folderId, {
      enabled: false,
      role: "admin",
      revision: link.revision! - 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await db
    .updateTable("file_folder_share_links")
    .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .execute();
  await expect(service.redeem(bob, link.token!)).rejects.toMatchObject({
    status: 404,
  });
});
it("keeps pending and rejected invitations private, with live approval permissions", async () => {
  const service = createFolderSharing(db),
    tickets = createTickets(db);
  await db
    .updateTable("distribution_settings")
    .set({ config: JSON.stringify({ grantMode: "invite" }) })
    .execute();
  const invitation = await service.invite(owner, folderId, {
    userId: alice.id,
    role: "reader",
  });
  await expect(
    tickets.detail(admin, invitation.ticketId!),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await tickets.detail(alice, invitation.ticketId!)).processorsHidden,
  ).toBe(true);
  await expect(
    tickets.act(bob, invitation.ticketId!, "accept"),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await tickets.act(alice, invitation.ticketId!, "reject")).status,
  ).toBe("rejected");
  expect(
    await db
      .selectFrom("file_folder_shares")
      .selectAll()
      .where("folder_id", "=", folderId)
      .execute(),
  ).toEqual([]);
  await expect(
    service.act(alice, invitation.ticketId!, "accept"),
  ).rejects.toMatchObject({ status: 409 });
});
it("asks for link consent before occupying a place or granting folder access", async () => {
  const service = createFolderSharing(db);
  await db
    .updateTable("distribution_settings")
    .set({ config: JSON.stringify({ grantMode: "invite" }) })
    .execute();
  const link = await service.setLink(owner, folderId, {
    enabled: true,
    role: "reader",
  });
  expect(await service.redeem(alice, link.token!)).toMatchObject({
    pending: true,
    id: folderId,
  });
  expect((await service.linkInfo(owner, folderId)).memberCount).toBe(0);
  expect(
    await db.selectFrom("file_folder_shares").selectAll().execute(),
  ).toEqual([]);
  await service.redeem(alice, link.token!, true);
  expect((await service.linkInfo(owner, folderId)).memberCount).toBe(1);
  await service.remove(owner, folderId, alice.id);
  expect((await service.linkInfo(owner, folderId)).memberCount).toBe(0);
  await service.redeem(bob, link.token!, true);
  expect((await service.linkInfo(owner, folderId)).memberCount).toBe(1);
});
