import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import { aiDefaults, saveAIConfig } from "@core/modules/ai/config.js";
import { createApp } from "@server/app/create-app.js";
import { mockAI } from "./ai-mock.js";
import { sessionSources } from "@server/services/ai/runner.js";

it("detaches deleted document sources while preserving chat history and allowing another message", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const password = "isolated-chat-deletion-2026";
  const owner = await createUser(db, { login: "chatlife", displayName: "Chat", password }, { bootstrap: true });
  const actor = { ...owner, admin: 1 };
  const content = createContent(db);
  const deleted = await content.create(actor, { kind: "document", format: "canvas", title: "Deleted source" });
  const retained = await content.create(actor, { kind: "document", format: "rich_text", title: "Retained source" });
  await saveAIConfig(db, {
    ...aiDefaults, defaultModel: "test", memoryEnabled: false,
    vendors: [{ id: "test-vendor", name: "Test", provider: "compatible", baseUrl: "https://mock.invalid/v1", apiKey: "not-real", enabled: true }],
    models: [{ id: "test", vendorId: "test-vendor", model: "mock", alias: "Mock", enabled: true, maxInput: 128000, maxOutput: 1000, vision: true, tools: true }],
  }, 0);
  const origin = "http://localhost:39281";
  const app = await createApp(db, { origin, ai: { memory: { driver: "sqlite", url: ":memory:" }, fetch: mockAI() } });
  const request = (method: any, path: string, cookie = "", payload?: any) => app.inject({ method, url: "/api/v1" + path, headers: { host: "localhost:39281", origin, cookie }, payload });
  try {
    const cookie = String((await request("POST", "/auth/login", "", { login: "chatlife", password })).headers["set-cookie"]).split(";")[0]!;
    const created = await request("POST", "/ai/sessions", cookie, { modelId: "test", resourceIds: [deleted.id, retained.id] });
    expect(created.statusCode, created.body).toBe(200);
    const sid = created.json().id;
    const send = (text: string) => request("POST", `/ai/sessions/${sid}/messages`, cookie, { id: randomUUID(), text, modelId: "test", scope: "all", references: [], attachments: [], webSearch: false });
    expect((await send("before deletion")).statusCode).toBe(200);
    let before: any;
    for (let i = 0; i < 100; i++) {
      before = (await request("GET", `/ai/sessions/${sid}`, cookie)).json();
      if (before.messages.some((m: any) => m.role === "assistant")) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    expect(before.messages.some((m: any) => m.role === "assistant")).toBe(true);
    await db.updateTable("ai_sessions").set({ mentioned_resource_ids: JSON.stringify([deleted.id]), approved_resource_ids: JSON.stringify([deleted.id, retained.id]) }).where("id", "=", sid).execute();
    await db.updateTable("resources").set({ deleted_at: new Date().toISOString() }).where("id", "=", deleted.id).execute();
    const listed = await request("GET", "/ai/sessions", cookie);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().find((row: any) => row.id === sid).restricted).toBeUndefined();
    const restored = await request("GET", `/ai/sessions/${sid}`, cookie);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().messages).toEqual(before.messages);
    expect(JSON.parse(restored.json().session.resource_ids)).toEqual([retained.id]);
    expect(JSON.parse(restored.json().session.mentioned_resource_ids)).toEqual([]);
    expect(JSON.parse(restored.json().session.approved_resource_ids)).toEqual([retained.id]);
    const next = await send("after deletion");
    expect(next.statusCode, next.body).toBe(200);
    const fresh = await request("POST", "/ai/sessions", cookie, { modelId: "test", resourceIds: [] });
    expect(fresh.statusCode, fresh.body).toBe(200);
  } finally {
    await app.close();
    await db.destroy();
  }
}, 30000);

it("does not detach an existing source whose access was revoked even when authorize conceals it with 404", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  try {
    const owner = await createUser(db, { login: "sourceowner", displayName: "Owner", password: "source-owner-password" }, { bootstrap: true });
    const other = await createUser(db, { login: "chatowner", displayName: "Other", password: "chat-owner-password" }, { actor: { ...owner, admin: 1 } });
    const source = await createContent(db).create({ ...owner, admin: 1 }, { kind: "document", format: "rich_text", title: "Not shared" });
    const now = new Date().toISOString();
    const row = { id: randomUUID(), user_id: other.id, title: "Revoked", model_id: null, resource_ids: JSON.stringify([source.id]), mentioned_resource_ids: "[]", approved_resource_ids: "[]", archived: 0, revision: 1, created_at: now, updated_at: now };
    await db.insertInto("ai_sessions").values(row).execute();
    const gone: string[] = [];
    await expect(sessionSources(db, other.id, row, gone)).rejects.toMatchObject({ status: 403 });
    expect(gone).toEqual([]);
    expect((await db.selectFrom("ai_sessions").select("resource_ids").where("id", "=", row.id).executeTakeFirstOrThrow()).resource_ids).toBe(JSON.stringify([source.id]));
  } finally {
    await db.destroy();
  }
});
