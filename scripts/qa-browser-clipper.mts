// End-to-end fixture only. Uses an isolated DB, synthetic credentials and a disposable Chromium profile.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { readAIDocument } from "../packages/core/src/workflows/ai-documents.js";
import {
  saveAIConfig,
  aiDefaults,
} from "../packages/core/src/modules/ai/config.js";
import { mockAI } from "../tests/ai-mock.js";

const output = resolve(process.argv[2] ?? ".local/browser-clipper-qa");
const root = await mkdtemp(join(tmpdir(), "doca-clipper-browser-"));
await mkdir(output, { recursive: true });
const extension = join(root, "extension");
await mkdir(extension);
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: join(root, "objects") } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const actor = {
  ...(await createUser(
    db,
    {
      login: "clipperqa",
      displayName: "浏览器验收账户",
      password: "isolated-browser-qa-password",
    },
    { bootstrap: true },
  )),
  admin: 1,
};
await saveAIConfig(
  db,
  {
    ...aiDefaults,
    defaultModel: "test",
    vendors: [
      {
        id: "vendor",
        name: "Fixture",
        provider: "compatible",
        baseUrl: "https://model.example.test/v1",
        apiKey: "synthetic-only",
        enabled: true,
      },
    ],
    models: [
      {
        id: "test",
        vendorId: "vendor",
        model: "test",
        alias: "验收模型",
        enabled: true,
        tools: true,
        maxInput: 64000,
        maxOutput: 2000,
      },
    ],
  },
  0,
);
await createUser(
  db,
  {
    login: "clipperqasecond",
    displayName: "第二个验收账户",
    password: "isolated-browser-qa-password",
  },
  { actor },
);
const origin = "http://localhost:39474",
  host = "localhost:39474";
const app = await createApp(db, {
  origin,
  staticDirectory: join(output, "web"),
  storage: storageRuntime(),
  ai: { memory: { driver: "sqlite", url: ":memory:" }, fetch: mockAI() },
});
await app.listen({ host: "0.0.0.0", port: 39474 });
const image = await sharp({
  create: { width: 640, height: 340, channels: 3, background: "#e8f0fc" },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="640" height="340"><rect x="80" y="65" width="480" height="210" rx="18" fill="#4874bb"/><circle cx="170" cy="170" r="52" fill="#a6c3ef"/><path d="M270 130h210M270 170h170M270 210h190" stroke="#fff" stroke-width="12" stroke-linecap="round"/></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
const fixture = createServer((req, res) => {
  if (req.url === "/original.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(image);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>设备启动故障排查</title><style>body{font:16px/1.9 system-ui,sans-serif;color:#28364b;max-width:760px;margin:40px auto}nav{font-size:13px;color:#8090a8}img{width:640px;border-radius:12px}table{border-collapse:collapse;width:640px}td,th{padding:8px 14px;border:1px solid #dbe3ed}</style></head><body><nav>技术资料 / 现场维护</nav><article id="article"><h1>设备启动故障排查</h1><p id="selection">故障现象：设备无法启动。排查时发现接线端子松动，需要断电后重新固定。</p><h2>现场图片</h2><img src="/original.png" alt="设备接线示意"><h2>排查记录</h2><table><tr><th>检查项</th><th>结果</th></tr><tr><td>电源</td><td>正常</td></tr><tr><td>接线端子</td><td>已加固</td></tr></table><p>解决方案：固定接线端子后重新启动，设备恢复运行。</p></article></body></html>`,
  );
});
await new Promise<void>((resolve) => fixture.listen(39475, "0.0.0.0", resolve));
let cookie = "";
const request = (method: any, path: string, payload?: any) =>
  app.inject({
    method,
    url: "/api/v1" + path,
    headers: { host, origin, cookie },
    payload,
  });
try {
  const library = await createContent(db).create(actor, {
    title: "故障知识库",
    kind: "library",
    format: "rich_text",
  });
  const target = await createContent(db).create(actor, {
    title: "排查记录",
    kind: "document",
    format: "markdown",
    libraryId: library.id,
    markdown: "# 排查记录\n\n原有排查内容，必须保留。",
  });
  await readAIDocument(db, { actor }, target.id);
  const login = await request("POST", "/auth/login", {
    login: "clipperqa",
    password: "isolated-browser-qa-password",
  });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const profileBase = {
    enabled: true,
    isDefault: true,
    titleTemplate: "{title}",
    aiInstruction: "按故障现象、原因、排查步骤和解决方案整理。",
  };
  const profile = (
    await request("POST", "/me/browser-clipper/profiles", {
      ...profileBase,
      name: "故障案例",
      strategy: "create",
      libraryId: library.id,
      parentId: null,
      targetId: null,
    })
  ).json();
  assert(profile.id);
  const append = (
    await request("POST", "/me/browser-clipper/profiles", {
      ...profileBase,
      isDefault: false,
      name: "排查摘录",
      strategy: "append",
      libraryId: null,
      parentId: null,
      targetId: target.id,
    })
  ).json();
  assert(append.id);
  const download = await request("POST", "/me/browser-clipper/download", {});
  assert.equal(download.statusCode, 200, download.body);
  for (const [name, bytes] of Object.entries(unzipSync(download.rawPayload))) {
    assert(/^[\w.-]+$/.test(name));
    await writeFile(join(extension, name), bytes);
  }
  const args = [
    "run",
    "--rm",
    "-i",
    "--user",
    "root",
    "--entrypoint",
    "node",
    "--mount",
    `type=bind,src=${extension},dst=/tmp/doca-extension,readonly`,
    "--mount",
    `type=bind,src=${output},dst=/artifacts`,
    "-e",
    `DOCA_QA_COOKIE=${cookie}`,
    "-e",
    `DOCA_QA_PROFILE=${profile.id}`,
    "-e",
    `DOCA_QA_APPEND=${append.id}`,
    "-e",
    `DOCA_QA_TARGET=${target.id}`,
    "smartdoca/doca:0.2.6",
    "--input-type=module",
    "-",
  ];
  await new Promise<void>(async (resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Browser QA exited " + code)),
    );
    child.stdin.end(
      await readFile(
        new URL("./qa-browser-clipper-browser.mjs", import.meta.url),
      ),
    );
  });
  const rows = await db
    .selectFrom("browser_clipper_receipts")
    .selectAll()
    .where("status", "=", "completed")
    .execute();
  assert.equal(rows.length, 3);
  const appended = await readAIDocument(db, { actor }, target.id);
  assert(String(appended.value).includes("原有排查内容"));
  assert(String(appended.value).includes("接线端子松动"));
  const assets = await db
    .selectFrom("assets")
    .selectAll()
    .where("purpose", "=", "attachment")
    .execute();
  assert.equal(assets.length, 3);
  for (const asset of assets) {
    const response = await request("GET", `/assets/${asset.id}/content`);
    assert.equal(response.statusCode, 200);
    assert(response.rawPayload.equals(image));
  }
  const aiJobs = await db.selectFrom("ai_jobs").selectAll().execute();
  assert(
    aiJobs.some((job) => job.status === "completed"),
    "AI must finish with an actual runner result",
  );
  const connections = await db
    .selectFrom("browser_clipper_connections")
    .selectAll()
    .execute();
  assert(
    connections
      .filter((connection) => connection.user_id === actor.id)
      .every((connection) => connection.revoked_at && !connection.token_hash),
  );
  const result = {
    status: "passed",
    database: "isolated SQLite",
    browser: "disposable Linux Chromium extension",
    realModelProvider: false,
    completedCaptures: rows.length,
    originalImagesByteExact: assets.length,
    appendRetainsExistingContent: true,
    revocationRetainsDocuments: true,
    userDataUsed: false,
  };
  await writeFile(
    join(output, "server-report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
