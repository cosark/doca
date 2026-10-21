import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "@db/index.js";
import { openTestDatabase } from "./database.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import { saveAIConfig, aiDefaults } from "@core/modules/ai/config.js";
import { readAIDocument } from "@core/workflows/ai-documents.js";
import { createApp } from "@server/app/create-app.js";
import { storageRuntime } from "@server/adapters/storage.js";
import { completionResponse, mockAI } from "./ai-mock.js";

let db: DB,
  app: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  root: string,
  cookie: string,
  token: string,
  connectionId: string,
  profile: any,
  requests: any[],
  action: "read" | "forbidden" | "delay" | "plain";
let materialId: string, forbiddenId: string;
const origin = "http://localhost:39473",
  host = "localhost:39473",
  password = "isolated-browser-ai";
const request = (method: any, path: string, payload?: any, external = false) =>
  app.inject({
    method,
    url: "/api/v1" + path,
    headers: {
      host,
      origin: external
        ? "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        : origin,
      cookie: external ? "" : cookie,
      ...(external ? { authorization: "Bearer " + token } : {}),
    },
    payload,
  });
const ai = (method: any, path: string, payload?: any) =>
  request(method, "/browser-clipper/assistant" + path, payload, true);
async function settle(
  id: string,
  states = ["completed", "failed", "cancelled", "awaiting_approval"],
) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const row = await db
      .selectFrom("ai_jobs")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    if (states.includes(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error("Browser AI job did not settle");
}
beforeEach(async () => {
  cookie = "";
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  root = await mkdtemp(join(tmpdir(), "doca-browser-ai-"));
  requests = [];
  action = "plain";
  actor = {
    ...(await createUser(
      db,
      { login: "browserai", displayName: "Browser AI", password },
      { bootstrap: true },
    )),
    admin: 1,
  };
  const library = await createContent(db).create(actor, {
    kind: "library",
    format: "rich_text",
    title: "故障资料",
  });
  const forbidden = await createContent(db).create(actor, {
    kind: "document",
    format: "markdown",
    title: "Private unrelated",
    markdown: "# Private unrelated\nUNRELATED_PRIVATE_CONTENT_9327",
  });
  forbiddenId = forbidden.id;
  await saveAIConfig(
    db,
    {
      ...aiDefaults,
      defaultModel: "test",
      vendors: [
        {
          id: "vendor",
          name: "Test",
          provider: "compatible",
          baseUrl: "https://model.example.test/v1",
          apiKey: "synthetic-model-key",
          enabled: true,
        },
      ],
      models: [
        {
          id: "test",
          vendorId: "vendor",
          model: "test",
          alias: "Test model",
          enabled: true,
          maxInput: 64000,
          maxOutput: 2000,
          tools: true,
        },
      ],
    },
    0,
  );
  const fallback = mockAI();
  const fetcher = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (
      body.tools?.some((tool: any) => tool.function?.name === "submit_review")
    )
      return fallback(url, init);
    if (action === "delay")
      await new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    const toolResults = body.messages.filter(
      (message: any) => message.role === "tool",
    );
    const name =
      !toolResults.length && action !== "plain"
        ? action === "read"
          ? "browser_material_read"
          : "document_read"
        : null;
    const message = name
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "browser-read",
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(
                  action === "read"
                    ? { requestId: materialId, offset: 0 }
                    : { resourceId: forbiddenId },
                ),
              },
            },
          ],
        }
      : {
          role: "assistant",
          content: "现象：设备无法启动。排查步骤：检查电源。",
        };
    return completionResponse(
      {
        id: randomUUID(),
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          { index: 0, message, finish_reason: name ? "tool_calls" : "stop" },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
      },
      !!body.stream,
    );
  }) as typeof fetch;
  app = await createApp(db, {
    origin,
    storage: { ...storageRuntime(), root },
    ai: { memory: { driver: "sqlite", url: ":memory:" }, fetch: fetcher },
  });
  const login = await request("POST", "/auth/login", {
    login: "browserai",
    password,
  });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const createdProfile = await request("POST", "/me/browser-clipper/profiles", {
    name: "故障资料",
    enabled: true,
    isDefault: true,
    strategy: "create",
    libraryId: library.id,
    parentId: null,
    targetId: null,
    titleTemplate: "{title}",
    aiInstruction: "",
  });
  expect(createdProfile.statusCode, createdProfile.body).toBe(200);
  profile = createdProfile.json();
  const verifier = randomBytes(32).toString("hex");
  const authorized = await request("POST", "/me/browser-clipper/authorize", {
    version: 2,
    installationId: randomUUID(),
    challenge: createHash("sha256").update(verifier).digest("hex"),
  });
  expect(authorized.statusCode, authorized.body).toBe(200);
  const activated = await request(
    "POST",
    "/browser-clipper/token",
    { version: 2, code: authorized.json().code, verifier },
    true,
  );
  expect(activated.statusCode, activated.body).toBe(200);
  connectionId = activated.json().connectionId;
  token = activated.json().token;
});
afterEach(async () => {
  await app?.close();
  await db?.destroy();
  await rm(root, { recursive: true, force: true });
});
async function session() {
  const result = await ai("POST", "/sessions", {
    profileId: profile.id,
    profileRevision: profile.revision,
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json().id;
}
async function send(id: string, captureRequestId: string | null = null) {
  const jobId = randomUUID(),
    result = await ai("POST", `/sessions/${id}/messages`, {
      id: jobId,
      modelId: "test",
      text: "只在对话中总结材料，不创建文件。",
      captureRequestId,
    });
  expect(result.statusCode, result.body).toBe(200);
  return jobId;
}
it("runs the same personal assistant with paged explicit browser materials and a restricted tool catalog", async () => {
  materialId = randomUUID();
  action = "read";
  const material = {
    version: 1,
    requestId: materialId,
    profileId: profile.id,
    profileRevision: profile.revision,
    mode: "selection",
    url: "https://material.example.test/post",
    title: "故障排查",
    capturedAt: new Date().toISOString(),
    markdown: "## 现象\n设备无法启动。\n\n## 排查\n检查电源。",
    images: [],
  };
  expect(
    (await request("POST", "/browser-clipper/clips", material, true))
      .statusCode,
  ).toBe(200);
  const sid = await session(),
    job = await settle(await send(sid, materialId));
  expect(job.status, job.error).toBe("completed");
  expect(job.result).toContain("检查电源");
  const catalog = requests.find((body) =>
    body.tools?.some(
      (tool: any) => tool.function?.name === "browser_material_read",
    ),
  );
  expect(catalog).toBeDefined();
  const names = catalog.tools.map((tool: any) => tool.function.name);
  expect(names).toContain("browser_capture");
  expect(names).not.toContain("http_request");
  expect(names).not.toContain("secret_write");
  expect(names).not.toContain("knowledge_book");
  expect(JSON.stringify(requests)).not.toContain(
    "UNRELATED_PRIVATE_CONTENT_9327",
  );
  expect((await request("GET", `/ai/sessions/${sid}`)).statusCode).toBe(200);
  const options = await ai("GET", "/options");
  expect(options.statusCode).toBe(200);
  expect(options.body).not.toContain("synthetic-model-key");
  const eventPage = await ai("GET", `/sessions/${sid}/events`);
  expect(eventPage.json().events.length).toBeGreaterThan(0);
  expect(
    await db
      .selectFrom("ai_calls")
      .select("id")
      .where("job_id", "=", job.id)
      .execute(),
  ).not.toHaveLength(0);
});
it("denies document tools outside the selected profile even when the Doca account itself can read the document", async () => {
  action = "forbidden";
  const sid = await session(),
    job = await settle(await send(sid));
  expect(["completed", "failed"]).toContain(job.status);
  expect(JSON.stringify(requests)).not.toContain(
    "UNRELATED_PRIVATE_CONTENT_9327",
  );
  expect((await readAIDocument(db, { actor }, forbiddenId)).value).toContain(
    "UNRELATED_PRIVATE_CONTENT_9327",
  );
});
it("revokes an in-flight browser task promptly while retaining the same conversation for ordinary Doca use", async () => {
  action = "delay";
  const sid = await session(),
    id = await send(sid);
  const deadline = Date.now() + 7000;
  while (!requests.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  expect(requests.length).toBeGreaterThan(0);
  const current = (await request("GET", "/me/browser-clipper/connections"))
    .json()
    .items.find((row: any) => row.id === connectionId);
  expect(
    (
      await request(
        "POST",
        `/me/browser-clipper/connections/${connectionId}/revoke`,
        { revision: current.revision },
      )
    ).statusCode,
  ).toBe(200);
  const stopped = await settle(id);
  expect(stopped.status).toBe("cancelled");
  expect(stopped.cancelled).toBe(1);
  expect((await ai("GET", `/sessions/${sid}`)).statusCode).toBe(401);
  expect((await request("GET", `/ai/sessions/${sid}`)).statusCode).toBe(200);
  action = "plain";
  const websiteId = randomUUID(),
    continued = await request("POST", `/ai/sessions/${sid}/messages`, {
      id: websiteId,
      text: "继续解释",
      modelId: "test",
      scope: "all",
    });
  expect(continued.statusCode, continued.body).toBe(200);
  expect((await settle(websiteId)).status).toBe("completed");
});

it("cancels a running browser AI job when its website session logs out", async () => {
  action = "delay";
  const sid = await session(),
    id = await send(sid);
  const deadline = Date.now() + 7000;
  while (!requests.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  expect(requests.length).toBeGreaterThan(0);
  expect((await request("POST", "/auth/logout", {})).statusCode).toBe(200);
  const job = await settle(id);
  expect(job.status).toBe("cancelled");
  expect(job.cancelled).toBe(1);
  expect((await ai("GET", `/sessions/${sid}`)).statusCode).toBe(401);
});
