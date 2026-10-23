import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "@db/index.js";
import { openTestDatabase } from "./database.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import { readAIDocument } from "@core/workflows/ai-documents.js";
import { createApp } from "@server/app/create-app.js";
import { storageRuntime } from "@server/adapters/storage.js";
import { createBrowserQuickNote } from "@server/services/browser-quick-note.js";
import * as access from "@core/modules/browser-clipper/access.js";

let db: DB,
  app: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  cookie: string,
  root: string;
const host = "localhost:39497",
  origin = `http://${host}`;
const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const password = "isolated-quick-note-password";
const defaults = {
  name: "速记目标",
  enabled: true,
  isDefault: true,
  strategy: "append",
  libraryId: null,
  parentId: null,
  targetId: null,
  titleTemplate: "{title}",
  aiInstruction: "",
};
const request = (
  method: any,
  path: string,
  payload?: any,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { host, origin, cookie, ...headers },
    payload,
  });
const external = (
  method: any,
  path: string,
  token: string,
  payload?: unknown,
) =>
  request(method, `/browser-clipper/quick-note${path}`, payload, {
    cookie: "",
    origin: extensionOrigin,
    authorization: `Bearer ${token}`,
  });
async function connect(installationId = randomUUID()) {
  const verifier = randomBytes(32).toString("hex");
  const authorized = await request("POST", "/me/browser-clipper/authorize", {
    version: 2,
    installationId,
    challenge: createHash("sha256").update(verifier).digest("hex"),
  });
  expect(authorized.statusCode, authorized.body).toBe(200);
  const response = await request(
    "POST",
    "/browser-clipper/token",
    {
      version: 2,
      code: authorized.json().code,
      verifier,
    },
    { cookie: "", origin: extensionOrigin },
  );
  expect(response.statusCode, response.body).toBe(200);
  return { ...response.json(), installationId };
}
async function profile(targetId: string, values: Record<string, unknown> = {}) {
  const response = await request("POST", "/me/browser-clipper/profiles", {
    ...defaults,
    targetId,
    ...values,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function target(format: "rich_text" | "markdown" = "rich_text") {
  const doc = await createContent(db).create(actor, {
    kind: "document",
    format,
    title: "原文保留",
    ...(format === "markdown"
      ? { markdown: "# 原文保留\n\n旧内容 **不变**" }
      : {}),
  });
  // Open through the existing native reader, just as the website does.
  await readAIDocument(db, { actor }, doc.id);
  return doc;
}
async function prepared(
  p: any,
  token: string,
  text = "速记内容",
  requestId = randomUUID(),
) {
  const input = {
    requestId,
    profileId: p.id,
    profileRevision: p.revision,
    text,
  };
  const response = await external("POST", "/prepare", token, input);
  expect(response.statusCode, response.body).toBe(200);
  return { input, result: response.json() };
}
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  root = await mkdtemp(join(tmpdir(), "doca-quick-note-"));
  actor = {
    ...(await createUser(
      db,
      { login: "quicknoteowner", displayName: "Owner", password },
      { bootstrap: true },
    )),
    admin: 1,
  };
  app = await createApp(db, {
    origin,
    storage: { ...storageRuntime(), root },
    ai: { memory: { driver: "sqlite", url: ":memory:" } },
  });
  const login = await request(
    "POST",
    "/auth/login",
    { login: "quicknoteowner", password },
    { cookie: "" },
  );
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await db?.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});

it("lists only current append-profile exact targets and never grants arbitrary editable documents", async () => {
  const a = await target(),
    b = await target("markdown"),
    c = await target();
  const pa = await profile(a.id),
    pb = await profile(b.id, { isDefault: false });
  await profile(c.id, { enabled: false, isDefault: false });
  await profile(null as any, { strategy: "create", isDefault: false });
  const connection = await connect();
  const listed = await external("GET", "/targets", connection.token);
  expect(listed.statusCode, listed.body).toBe(200);
  expect(
    listed.json().items.map((i: any) => [i.profileId, i.targetId]),
  ).toEqual([
    [pa.id, a.id],
    [pb.id, b.id],
  ]);
  expect(
    (
      await external("POST", "/prepare", connection.token, {
        requestId: randomUUID(),
        profileId: pa.id,
        profileRevision: pa.revision,
        text: "test",
        targetId: c.id,
      })
    ).statusCode,
  ).toBe(400);
});

for (const format of ["rich_text", "markdown"] as const)
  it(`appends plain ${format} through native receipts, keeps original data, and replays one accepted increment`, async () => {
    const doc = await target(format),
      p = await profile(doc.id),
      c = await connect();
    const before = await readAIDocument(db, { actor }, doc.id);
    const stateBefore = await db
      .selectFrom("document_states")
      .selectAll()
      .where("resource_id", "=", doc.id)
      .executeTakeFirst();
    const note =
      "# literal **words** <script>alert(1)</script>\n第二行\n\n最后一行";
    const { input, result } = await prepared(p, c.token, note);
    expect(
      await db
        .selectFrom("document_states")
        .selectAll()
        .where("resource_id", "=", doc.id)
        .executeTakeFirst(),
    ).toEqual(stateBefore);
    const repeatPrepare = await external("POST", "/prepare", c.token, input);
    expect(repeatPrepare.json()).toEqual(result);
    const commit = { requestId: input.requestId, ticket: result.ticket };
    const first = await external("POST", "/commit", c.token, commit);
    expect(first.statusCode, first.body).toBe(200);
    const duplicate = await external("POST", "/commit", c.token, commit);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json().seq).toBe(first.json().seq);
    expect(duplicate.json().changed).toBe(false);
    const after = await readAIDocument(db, { actor }, doc.id);
    expect(after.epochId).toBe(before.epochId);
    if (format === "markdown") {
      expect(after.value).toBe(`${before.value}\n\n${note}`);
    } else {
      expect(
        (after.value as any[]).slice(0, (before.value as any[]).length),
      ).toEqual(before.value);
      expect(
        (after.value as any[])
          .slice(-4)
          .map((n: any) => ({ type: n.type, children: n.children })),
      ).toEqual(
        note
          .split("\n")
          .map((text) => ({ type: "paragraph", children: [{ text }] })),
      );
    }
    expect(
      await db.selectFrom("browser_clipper_receipts").selectAll().execute(),
    ).toEqual([]);
    expect(await db.selectFrom("ai_jobs").selectAll().execute()).toEqual([]);
    expect(
      await db
        .selectFrom(
          format === "markdown" ? "markdown_receipts" : "editor_receipts",
        )
        .selectAll()
        .where("resource_id", "=", doc.id)
        .where("message_id", "=", input.requestId)
        .execute(),
    ).toHaveLength(1);
  });

it("coalesces simultaneous preparation and commit while keeping both independent concurrent appends", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const input = {
    requestId: randomUUID(),
    profileId: p.id,
    profileRevision: p.revision,
    text: "第一条并发",
  };
  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      external("POST", "/prepare", c.token, input),
    ),
  );
  for (const r of responses) expect(r.statusCode, r.body).toBe(200);
  expect(new Set(responses.map((r) => r.json().ticket)).size).toBe(1);
  const next = await prepared(p, c.token, "第二条并发");
  const firstCommit = {
    requestId: input.requestId,
    ticket: responses[0]!.json().ticket,
  };
  const committed = await Promise.all([
    external("POST", "/commit", c.token, firstCommit),
    external("POST", "/commit", c.token, firstCommit),
    external("POST", "/commit", c.token, {
      requestId: next.input.requestId,
      ticket: next.result.ticket,
    }),
  ]);
  for (const r of committed) expect(r.statusCode, r.body).toBe(200);
  const value = JSON.stringify(
    (await readAIDocument(db, { actor }, doc.id)).value,
  );
  expect(value.match(/第一条并发/g)).toHaveLength(1);
  expect(value.match(/第二条并发/g)).toHaveLength(1);
});

it("rejects same request id with changed text and foreign connection tickets without writes", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect(),
    other = await connect();
  const { input, result } = await prepared(p, c.token);
  expect(
    (
      await external("POST", "/prepare", c.token, {
        ...input,
        text: "替换内容",
      })
    ).statusCode,
  ).toBe(409);
  const foreign = await external("POST", "/commit", other.token, {
    requestId: input.requestId,
    ticket: result.ticket,
  });
  expect(foreign.statusCode).toBe(409);
  expect(
    JSON.stringify((await readAIDocument(db, { actor }, doc.id)).value),
  ).not.toContain(input.text);
});

it("revalidates profile revision and exact target rather than retargeting a prepared note", async () => {
  const doc = await target(),
    replacement = await target(),
    p = await profile(doc.id),
    c = await connect();
  const { input, result } = await prepared(p, c.token);
  const { id, ...values } = p;
  expect(
    (
      await request("PUT", `/me/browser-clipper/profiles/${id}`, {
        ...values,
        targetId: replacement.id,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await external("POST", "/commit", c.token, {
        requestId: input.requestId,
        ticket: result.ticket,
      })
    ).statusCode,
  ).toBe(409);
  for (const d of [doc, replacement])
    expect(
      JSON.stringify((await readAIDocument(db, { actor }, d.id)).value),
    ).not.toContain(input.text);
});

it("does not require AI permission or assistantEnabled to append a note", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const row = (await request("GET", "/me/browser-clipper/connections")).json()
    .items[0];
  expect(
    (
      await request("PUT", `/me/browser-clipper/connections/${row.id}`, {
        revision: row.revision,
        name: row.name,
        assistantEnabled: false,
      })
    ).statusCode,
  ).toBe(200);
  const { input, result } = await prepared(p, c.token);
  expect(
    (
      await external("POST", "/commit", c.token, {
        requestId: input.requestId,
        ticket: result.ticket,
      })
    ).statusCode,
  ).toBe(200);
  expect(await db.selectFrom("ai_jobs").selectAll().execute()).toEqual([]);
});

it("binds the prepared note to the actual sign-in token and refuses after token rotation", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const { input, result } = await prepared(p, c.token);
  const renewed = await connect(c.installationId);
  expect(
    (
      await external("POST", "/commit", c.token, {
        requestId: input.requestId,
        ticket: result.ticket,
      })
    ).statusCode,
  ).toBe(401);
  const rotated = await external("POST", "/commit", renewed.token, {
    requestId: input.requestId,
    ticket: result.ticket,
  });
  expect(rotated.statusCode).toBe(409);
  expect(rotated.json().message).toBe("quick_note_signin_changed");
});

it("rechecks token and website binding after obtaining the user lock", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const service = createBrowserQuickNote(db, origin, async () => {});
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const real = access.authenticateBrowserConnection;
  let first = true;
  vi.spyOn(access, "authenticateBrowserConnection").mockImplementation(
    async (...args) => {
      const result = await real(...args);
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return result;
    },
  );
  const work = service.prepare(`Bearer ${c.token}`, {
    requestId: randomUUID(),
    profileId: p.id,
    profileRevision: p.revision,
    text: "撤销后禁止写",
  });
  await reached;
  const row = (await request("GET", "/me/browser-clipper/connections")).json()
    .items[0];
  expect(
    (
      await request(
        "POST",
        `/me/browser-clipper/connections/${row.id}/revoke`,
        { revision: row.revision },
      )
    ).statusCode,
  ).toBe(200);
  release();
  await expect(work).rejects.toMatchObject({ status: 401 });
  service.close();
  expect(
    await db
      .selectFrom("editor_receipts")
      .selectAll()
      .where("resource_id", "=", doc.id)
      .execute(),
  ).toEqual([]);
});

it("refuses expired and restarted tickets; preserves native receipts and never regenerates an accepted request", async () => {
  const doc = await target("markdown"),
    p = await profile(doc.id),
    c = await connect();
  let time = Date.now();
  const service = createBrowserQuickNote(db, origin, async () => {}, {
    now: () => time,
    lifetimeMs: 1000,
  });
  const input = {
    requestId: randomUUID(),
    profileId: p.id,
    profileRevision: p.revision,
    text: "只保存一次",
  };
  const prepared = await service.prepare(`Bearer ${c.token}`, input);
  const commit = { requestId: input.requestId, ticket: prepared.ticket };
  await service.commit(`Bearer ${c.token}`, commit);
  time += 1001;
  await expect(
    service.commit(`Bearer ${c.token}`, commit),
  ).rejects.toMatchObject({
    status: 409,
    message: "quick_note_ticket_missing",
  });
  await expect(
    service.prepare(`Bearer ${c.token}`, input),
  ).rejects.toMatchObject({
    status: 409,
    message: "quick_note_request_already_used",
  });
  service.close();
  await expect(
    service.commit(`Bearer ${c.token}`, commit),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    String((await readAIDocument(db, { actor }, doc.id)).value).match(
      /只保存一次/g,
    ),
  ).toHaveLength(1);
});

it("rejects invalid text and unsupported create profiles without document changes", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const create = await profile(null as any, { strategy: "create" });
  for (const text of ["   ", "汉".repeat(23000)])
    expect(
      (
        await external("POST", "/prepare", c.token, {
          requestId: randomUUID(),
          profileId: p.id,
          profileRevision: p.revision,
          text,
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await external("POST", "/prepare", c.token, {
        requestId: randomUUID(),
        profileId: create.id,
        profileRevision: create.revision,
        text: "有效文本",
      })
    ).statusCode,
  ).toBe(403);
  expect(await db.selectFrom("editor_receipts").selectAll().execute()).toEqual(
    [],
  );
});

it("preserves both actors' concurrent native increments and refuses a later append after ACL revocation", async () => {
  const doc = await target("markdown"),
    ownProfile = await profile(doc.id),
    ownConnection = await connect();
  const other = await createUser(
    db,
    { login: "quicknoteother", displayName: "Other", password },
    { actor },
  );
  const timestamp = new Date().toISOString();
  await db
    .insertInto("grants")
    .values({
      resource_id: doc.id,
      user_id: other.id,
      role: "editor",
      include_descendants: 0,
      source_type: "direct",
      source_id: "",
      source_resource_id: null,
      status: "active",
      created_by: actor.id,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();
  const savedCookie = cookie;
  const login = await request(
    "POST",
    "/auth/login",
    { login: "quicknoteother", password },
    { cookie: "" },
  );
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const otherProfile = await profile(doc.id),
    otherConnection = await connect();
  cookie = savedCookie;
  const first = await prepared(ownProfile, ownConnection.token, "作者一的新增"),
    second = await prepared(
      otherProfile,
      otherConnection.token,
      "作者二的新增",
    );
  const responses = await Promise.all([
    external("POST", "/commit", ownConnection.token, {
      requestId: first.input.requestId,
      ticket: first.result.ticket,
    }),
    external("POST", "/commit", otherConnection.token, {
      requestId: second.input.requestId,
      ticket: second.result.ticket,
    }),
  ]);
  for (const response of responses)
    expect(response.statusCode, response.body).toBe(200);
  const beforeRevoke = String(
    (await readAIDocument(db, { actor }, doc.id)).value,
  );
  expect(beforeRevoke.match(/作者一的新增/g)).toHaveLength(1);
  expect(beforeRevoke.match(/作者二的新增/g)).toHaveLength(1);
  const later = await prepared(
    otherProfile,
    otherConnection.token,
    "撤权后禁止追加",
  );
  await db
    .deleteFrom("grants")
    .where("resource_id", "=", doc.id)
    .where("user_id", "=", other.id)
    .execute();
  expect(
    (await external("GET", "/targets", otherConnection.token)).json().items,
  ).toEqual([]);
  expect(
    (
      await external("POST", "/commit", otherConnection.token, {
        requestId: later.input.requestId,
        ticket: later.result.ticket,
      })
    ).statusCode,
  ).toBe(404);
  expect((await readAIDocument(db, { actor }, doc.id)).value).toBe(
    beforeRevoke,
  );
});

it("keeps existing tickets usable when capacity rejects a new request", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const service = createBrowserQuickNote(db, origin, async () => {}, {
    maxTickets: 1,
  });
  const input = {
    requestId: randomUUID(),
    profileId: p.id,
    profileRevision: p.revision,
    text: "保留的原票据",
  };
  const first = await service.prepare(`Bearer ${c.token}`, input);
  await expect(
    service.prepare(`Bearer ${c.token}`, {
      ...input,
      requestId: randomUUID(),
      text: "超额的新输入",
    }),
  ).rejects.toMatchObject({ status: 429 });
  await service.commit(`Bearer ${c.token}`, {
    requestId: input.requestId,
    ticket: first.ticket,
  });
  expect(
    JSON.stringify((await readAIDocument(db, { actor }, doc.id)).value),
  ).toContain(input.text);
  service.close();
});

it("checks the actual website session and refuses native epochs changed after preparation", async () => {
  const doc = await target(),
    p = await profile(doc.id),
    c = await connect();
  const note = await prepared(p, c.token);
  await db
    .updateTable("editor_epochs")
    .set({ epoch_id: randomUUID() })
    .where("resource_id", "=", doc.id)
    .execute();
  expect(
    (
      await external("POST", "/commit", c.token, {
        requestId: note.input.requestId,
        ticket: note.result.ticket,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    await db
      .selectFrom("editor_receipts")
      .selectAll()
      .where("message_id", "=", note.input.requestId)
      .execute(),
  ).toEqual([]);
  await db
    .updateTable("sessions")
    .set({ expires_at: "2000-01-01T00:00:00.000Z" })
    .where("user_id", "=", actor.id)
    .execute();
  expect((await external("GET", "/targets", c.token)).statusCode).toBe(401);
  expect(
    (
      await external("POST", "/commit", c.token, {
        requestId: note.input.requestId,
        ticket: note.result.ticket,
      })
    ).statusCode,
  ).toBe(401);
});
