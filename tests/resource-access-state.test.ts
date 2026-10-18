import { expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import { recentActivity } from "@core/modules/workspace/activity.js";

it("agrees across detail, document list and home, including inheritance, disabled accounts and public scope", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  try {
    const owner = {
      ...(await createUser(
        db,
        {
          login: "accessowner",
          displayName: "Owner",
          password: "isolated-access-state",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
    const member = {
      ...(await createUser(
        db,
        {
          login: "accessmember",
          displayName: "Member",
          password: "isolated-access-state",
        },
        { actor: owner },
      )),
      admin: 0,
    };
    const content = createContent(db),
      parent = await content.create(owner, {
        title: "Parent",
        kind: "library",
        format: "rich_text",
      });
    const child = await content.create(owner, {
      title: "📊 发布计划",
      kind: "document",
      format: "canvas",
      libraryId: parent.id,
    });
    const check = async (state: string) => {
      expect(
        (await content.detail(owner, child.id)).resource.access_state,
      ).toBe(state);
      expect(
        (
          await content.list(owner, {
            kind: "document",
            scope: "all",
            libraryId: parent.id,
          })
        ).items.find((r) => r.id === child.id)?.access_state,
      ).toBe(state);
      expect(
        (await recentActivity(db, owner)).items.find((r) => r.id === child.id)
          ?.access_state,
      ).toBe(state);
    };
    await content.visit(owner, child.id);
    await check("private");
    await content.permissions(owner, parent.id, {
      version: (await content.detail(owner, parent.id)).resource.version,
      accessMode: "custom",
      visibility: "invited",
      grants: [{ userId: member.id, role: "editor", includeDescendants: true }],
    });
    await check("collaborative");
    // A disabled identity cannot access the document even while its grant remains.
    await db
      .updateTable("users")
      .set({ status: "disabled" })
      .where("id", "=", member.id)
      .execute();
    await check("private");
    await db
      .updateTable("users")
      .set({ status: "active" })
      .where("id", "=", member.id)
      .execute();
    await check("collaborative");
    await content.permissions(owner, child.id, {
      version: (await content.detail(owner, child.id)).resource.version,
      accessMode: "custom",
      visibility: "invited",
      grants: [],
    });
    await check("private");
    for (const visibility of ["authenticated", "public"] as const) {
      await content.permissions(owner, child.id, {
        version: (await content.detail(owner, child.id)).resource.version,
        accessMode: "custom",
        visibility,
        grants: [],
      });
      await check("public");
    }
  } finally {
    await db.destroy();
  }
});
