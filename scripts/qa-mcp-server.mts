// Disposable Doca site for real MCP clients and browser acceptance. No user data.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
if (process.env.DOCA_QA_ISOLATED !== "1")
  throw new Error("Set DOCA_QA_ISOLATED=1 for the disposable MCP site");
const root = await mkdtemp(join(tmpdir(), "doca-mcp-acceptance-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: join(root, "objects") } },
});
const { openDatabase } = await import("../packages/db/src/connection.js");
const { createUser } =
  await import("../packages/core/src/modules/identity/passwords.js");
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({
  driver: "sqlite",
  path: join(root, "doca.db"),
});
const password = "isolated-mcp-acceptance-2026";
const admin = await createUser(
  db,
  { login: "mcpadmin", displayName: "MCP 验收管理员", password },
  { bootstrap: true },
);
const user = await createUser(
  db,
  { login: "mcpreporter", displayName: "报告接收员", password },
  { actor: { ...admin, admin: 1 } },
);
const port = Number(process.env.DOCA_MCP_QA_PORT ?? 39472),
  origin = `http://127.0.0.1:${port}`;
const app = await createApp(db, {
  origin,
  storage: storageRuntime(),
  staticDirectory: resolve("apps/web/dist"),
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port });
const login = await app.inject({
  method: "POST",
  url: "/api/v1/auth/login",
  headers: { host: `127.0.0.1:${port}`, origin },
  payload: { login: "mcpadmin", password },
});
const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
const headers = { host: `127.0.0.1:${port}`, origin, cookie };
const enable = await app.inject({
  method: "PUT",
  url: "/api/v1/me/mcp",
  headers,
  payload: { enabled: true, revision: 0 },
});
if (enable.statusCode !== 200) throw new Error(enable.body);
async function service(kind: "personal" | "admin", name: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/${kind === "personal" ? "me" : "admin"}/mcp-services`,
    headers,
    payload: {
      name,
      enabled: true,
      grantMode: "all",
      toolIds: [],
      skillIds: [],
      expiresAt: null,
    },
  });
  if (response.statusCode !== 200) throw new Error(response.body);
  return response.json();
}
const personal = await service("personal", "Codex 验收服务"),
  company = await service("admin", "公司测试平台");
const fixture = resolve(".cache/qa-mcp.json");
await mkdir(resolve(".cache"), { recursive: true });
await writeFile(
  fixture,
  JSON.stringify(
    {
      origin,
      root,
      database: join(root, "doca.db"),
      adminId: admin.id,
      userId: user.id,
      password,
      cookie,
      personal,
      company,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    origin,
    fixture,
    isolated: true,
    modelsRequiredForNativeTools: false,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await db.destroy();
  if (process.env.DOCA_MCP_QA_KEEP !== "1")
    await rm(root, { recursive: true, force: true });
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
