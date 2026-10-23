import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createApp } from "@server/app/create-app.js";

it("derives browser assistant origin from the owned binding, retains it after revocation and never exposes another user's session", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const password = "isolated-session-source-2026";
  const owner = await createUser(db, { login: "originowner", displayName: "Owner", password }, { bootstrap: true });
  await createUser(db, { login: "originother", displayName: "Other", password }, { actor: { ...owner, admin: 1 } });
  const origin = "http://localhost:39284";
  const app = await createApp(db, { origin, ai: { memory: { driver: "sqlite", url: ":memory:" } } });
  const request = (method: any, path: string, cookie: string, payload?: any, headers: Record<string, string> = {}) => app.inject({ method, url: "/api/v1" + path, headers: { host: "localhost:39284", origin, cookie, ...headers }, payload });
  try {
    const login = async (name: string) => String((await request("POST", "/auth/login", "", { login: name, password })).headers["set-cookie"]).split(";")[0]!;
    const cookie = await login("originowner"), otherCookie = await login("originother");
    const regular = await request("POST", "/ai/sessions", cookie, { title: "浏览器助手", resourceIds: [] });
    expect(regular.statusCode, regular.body).toBe(200);
    expect(regular.json().source).toBe("doca");
    const profile = await request("POST", "/me/browser-clipper/profiles", cookie, { name: "Source QA", enabled: true, isDefault: true, strategy: "create", libraryId: null, parentId: null, targetId: null, titleTemplate: "{title}", aiInstruction: "" });
    expect(profile.statusCode, profile.body).toBe(200);
    const verifier = randomBytes(32).toString("hex");
    const activation = await request("POST", "/me/browser-clipper/authorize", cookie, { version: 2, installationId: randomUUID(), challenge: createHash("sha256").update(verifier).digest("hex") });
    expect(activation.statusCode, activation.body).toBe(200);
    const exchange = await request("POST", "/browser-clipper/token", "", { version: 2, code: activation.json().code, verifier }, { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(exchange.statusCode, exchange.body).toBe(200);
    const created = await request("POST", "/browser-clipper/assistant/sessions", "", { profileId: profile.json().id, profileRevision: profile.json().revision }, { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", authorization: `Bearer ${exchange.json().token}` });
    expect(created.statusCode, created.body).toBe(200);
    const sid = created.json().id;
    await db.updateTable("ai_sessions").set({ title: "Renamed neutral chat" }).where("id", "=", sid).execute();
    const verify = async () => {
      const list = await request("GET", "/ai/sessions", cookie);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().find((row: any) => row.id === sid).source).toBe("browser_assistant");
      expect(list.json().find((row: any) => row.id === regular.json().id).source).toBe("doca");
      const detail = await request("GET", `/ai/sessions/${sid}`, cookie);
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json().session.source).toBe("browser_assistant");
      expect(detail.json().session.connection_id).toBeUndefined();
      expect((await request("GET", "/ai/sessions", otherCookie)).json()).toEqual([]);
      const forbidden = await request("GET", `/ai/sessions/${sid}`, otherCookie);
      expect(forbidden.statusCode, forbidden.body).toBe(404);
      expect(forbidden.json().source).toBeUndefined();
    };
    await verify();
    expect((await request("POST", "/me/browser-clipper/revoke-all", cookie, {})).statusCode).toBe(200);
    await verify();
    const stored = await db.selectFrom("ai_sessions").selectAll().where("id", "=", sid).executeTakeFirstOrThrow();
    expect(stored.title).toBe("Renamed neutral chat");
    expect(stored).not.toHaveProperty("source");
  } finally {
    await app.close();
    await db.destroy();
  }
});
