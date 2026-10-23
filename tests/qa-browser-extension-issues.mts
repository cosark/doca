// End-to-end fixture only. Uses an isolated DB, synthetic credentials and a disposable Chromium profile.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { readAIDocument } from "../packages/core/src/workflows/ai-documents.js";
import {
  b64,
  createDocuments,
  restoreDocument,
} from "../packages/core/src/modules/collaboration/documents.js";
import {
  saveAIConfig,
  aiDefaults,
} from "../packages/core/src/modules/ai/config.js";
import { completionResponse, mockAI } from "../tests/ai-mock.js";

import {
  createServer as createViteServer,
  preview as previewViteBuild,
} from "vite";
const webMode = process.env.DOCA_QA_WEB_MODE ?? "development";
assert(
  webMode === "development" || webMode === "production-build",
  "DOCA_QA_WEB_MODE must be development or production-build",
);
const webDistPath = resolve("apps/web/dist");
if (webMode === "production-build") {
  const index = await stat(join(webDistPath, "index.html"));
  assert(
    index.isFile() && index.size > 0,
    "Production-build QA requires apps/web/dist/index.html",
  );
}
const output = resolve(process.argv[2] ?? "artifacts/verification/browser-extension-issues");
async function fingerprintWebBuild() {
  const paths: string[] = [];
  async function walk(prefix = "") {
    for (const entry of await readdir(join(webDistPath, prefix), {
      withFileTypes: true,
    })) {
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await walk(path);
      else {
        assert(entry.isFile(), "Unsupported production-build entry: " + path);
        paths.push(path);
      }
    }
  }
  await walk();
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const path of paths.sort()) {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(join(webDistPath, path))) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    files[path] = { bytes, sha256: hash.digest("hex") };
  }
  const index = files["index.html"];
  assert(index && index.bytes > 0, "The compiled Web index must be present");
  return {
    root: "apps/web/dist",
    fileCount: paths.length,
    totalBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0),
    indexSha256: index.sha256,
    indexBytes: index.bytes,
    fullWebSha256: createHash("sha256")
      .update(
        JSON.stringify(
          Object.entries(files).map(([path, file]) => [path, file.sha256]),
        ),
      )
      .digest("hex"),
    files,
  };
}
const webBuildBefore =
  webMode === "production-build" ? await fingerprintWebBuild() : null;
const testedVersions = Object.fromEntries(
  await Promise.all(
    [
      ["doca", "package.json"],
      ["extension", "apps/browser-extension/manifest.json"],
      ["canvas", "node_modules/@smartdoca/canvas/package.json"],
    ].map(async ([name, path]) => [
      name,
      JSON.parse(await readFile(resolve(path!), "utf8")).version,
    ]),
  ),
);
const root = await mkdtemp(join(tmpdir(), "doca-clipper-browser-"));
await mkdir(output, { recursive: true });
if (webBuildBefore)
  await writeFile(
    join(output, "web-build-fingerprint-before.json"),
    JSON.stringify(webBuildBefore, null, 2),
  );
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
        apiMode: "chat",
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
const origin = "http://localhost:39646",
  host = "localhost:39646";
const fallbackModel = mockAI();
let materialReadVerified = false;
const modelCallTimes: number[] = [];
const browserModel = (async (url, init) => {
  modelCallTimes.push(Date.now());
  const body = JSON.parse(String(init?.body || "{}"));
  const messages = body.messages || [];
  const currentMessages = messages.slice(
    messages.findLastIndex((message: any) => message.role === "user"),
  );
  const requestId = JSON.stringify(
    currentMessages.filter((message: any) => message.role === "user"),
  ).match(/收录任务ID：([a-f0-9-]{36})/)?.[1];
  if (!requestId) return fallbackModel(url, init);
  const toolResults = currentMessages.filter(
    (message: any) => message.role === "tool",
  );
  const result = toolResults.at(-1);
  if (toolResults.length === 1) {
    assert(
      JSON.stringify(result.content).includes("接线端子松动"),
      result.content,
    );
    materialReadVerified = true;
  }
  const requestCapture = JSON.stringify(
    currentMessages.filter((message: any) => message.role === "user"),
  ).includes("先让我确认");
  const message =
    requestCapture && toolResults.length === 1
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "capture-approval",
              type: "function",
              function: {
                name: "browser_capture",
                arguments: JSON.stringify({ requestId }),
              },
            },
          ],
        }
      : result
        ? {
            role: "assistant",
            content:
              "这是模拟 AI 的回答，用于验证会话、页面和积分。\n\n## 排查建议\n\n| 步骤 | 操作 |\n| --- | --- |\n| 1 | 检查电源与接线 |\n\n```text\n检查接线\n```",
          }
        : {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "material-read",
                type: "function",
                function: {
                  name: "browser_material_read",
                  arguments: JSON.stringify({ requestId, offset: 0 }),
                },
              },
            ],
          };
  return completionResponse(
    {
      id: "browser-fixture",
      object: "chat.completion",
      created: 1,
      model: body.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: message.tool_calls ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
    },
    !!body.stream,
  );
}) as typeof fetch;
const app = await createApp(db, {
  origin,

  storage: storageRuntime(),
  ai: { memory: { driver: "sqlite", url: ":memory:" }, fetch: browserModel },
});
const serverTrace = new Map<string, Record<string, unknown>>();
let serverRequestId = 0;
app.server.on("request", (req, res) => {
  const trace: Record<string, unknown> = {
    path: req.url,
    method: req.method,
    started: Date.now(),
    contentLength: req.headers["content-length"],
  };
  Object.defineProperties(trace, {
    headersSent: { enumerable: true, get: () => res.headersSent },
    completeBody: { enumerable: true, get: () => req.complete },
  });
  serverTrace.set(String(++serverRequestId), trace);
  req.on("end", () => {
    trace.bodyEndedAt = Date.now();
  });
  res.on("finish", () =>
    Object.assign(trace, { finished: Date.now(), status: res.statusCode }),
  );
  res.on("close", () => {
    trace.closedAt = Date.now();
  });
});
await app.listen({ host: "0.0.0.0", port: 39645 });
const webServerOptions = {
  host: "0.0.0.0",
  port: 39646,
  strictPort: true,
  proxy: {
    "/api": {
      target: "http://127.0.0.1:39645",
      ws: true,
      changeOrigin: false,
    },
  },
};
const closeWebServer = await (async () => {
  if (webMode === "production-build") {
    const server = await previewViteBuild({
      configFile: resolve("apps/web/vite.config.ts"),
      build: { outDir: webDistPath },
      preview: webServerOptions,
    });
    return () => server.close();
  }
  const server = await createViteServer({
    configFile: resolve("apps/web/vite.config.ts"),
    cacheDir: resolve("artifacts/verification/browser-extension-issues/vite-cache"),
    server: webServerOptions,
  });
  await server.listen();
  return () => server.close();
})();
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
  if (req.url === "/auth-fast/delay.js") {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(
        "// Deliberately keep the parser active after its first inline callback.",
      );
    }, 250);
    return;
  }
  if (req.url?.startsWith("/auth-fast/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      '<!doctype html><html><head><script>window.postMessage({source:"doca-browser-auth",state:new URLSearchParams(location.hash.split("?")[1]).get("state"),status:"login-required"},location.origin)</script><script src="/auth-fast/delay.js"></script></head><body>Fast authorization callback</body></html>',
    );
    return;
  }
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
await new Promise<void>((resolve) => fixture.listen(39647, "0.0.0.0", resolve));
let cookie = "";
const request = (method: any, path: string, payload?: any) =>
  app.inject({
    method,
    url: "/api/v1" + path,
    headers: { host, origin, cookie },
    payload,
  });
async function verifyServedWebIndex() {
  assert(webBuildBefore);
  const response = await fetch(origin + "/", {
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert(response.headers.get("content-type")?.includes("text/html"));
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    sha256,
    webBuildBefore.indexSha256,
    "The web server must serve the exact compiled index",
  );
  assert.equal(bytes.length, webBuildBefore.indexBytes);
  return {
    status: response.status,
    indexSha256: sha256,
    indexBytes: bytes.length,
  };
}
try {
  const servedWebIndexBefore = webBuildBefore
    ? await verifyServedWebIndex()
    : null;
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
  const quickNoteFixtures: {
    format: "rich_text" | "markdown";
    targetId: string;
    profileId: string;
    profileRevision: number;
    profileInput: Record<string, unknown>;
    original: string;
    before: Awaited<ReturnType<typeof readAIDocument>>;
  }[] = [];
  for (const format of ["rich_text", "markdown"] as const) {
    const original = `速记原文_${format}_必须完整保留`;
    const document = await createContent(db).create(actor, {
      title: `速记验收 ${format}`,
      kind: "document",
      format,
      libraryId: library.id,
      ...(format === "markdown"
        ? { markdown: `# 速记原文\n\n${original} **旧格式** <>&` }
        : {}),
    });
    const baseline = await readAIDocument(db, { actor }, document.id);
    if (format === "rich_text") {
      const loaded = await restoreDocument(db, document.id);
      try {
        const last: any = loaded.runtime.getValue().at(-1);
        const update = loaded.runtime.editText(last.id, 0, 0, original);
        await createDocuments(db).exchange(actor, document.id, {
          codec: "slate-kit",
          schemaVersion: 3,
          protocolVersion: 1,
          epochId: baseline.epochId!,
          messageId: randomUUID(),
          update: b64(update),
        });
      } finally {
        loaded.destroy();
      }
    }
    const profileInput = {
      ...profileBase,
      isDefault: false,
      name: `速记 ${format}`,
      strategy: "append",
      libraryId: null,
      parentId: null,
      targetId: document.id,
    };
    const response = await request(
      "POST",
      "/me/browser-clipper/profiles",
      profileInput,
    );
    assert.equal(response.statusCode, 200, response.body);
    const noteProfile = response.json();
    quickNoteFixtures.push({
      format,
      targetId: document.id,
      profileId: noteProfile.id,
      profileRevision: noteProfile.revision,
      profileInput,
      original,
      before: await readAIDocument(db, { actor }, document.id),
    });
  }
  const download = await request("POST", "/me/browser-clipper/download", {});
  assert.equal(download.statusCode, 200, download.body);
  const extensionZipSha256 = createHash("sha256")
    .update(download.rawPayload)
    .digest("hex");
  const unpacked = unzipSync(download.rawPayload);
  assert.equal(
    JSON.parse(new TextDecoder().decode(unpacked["manifest.json"])).version,
    testedVersions.extension,
  );
  const packagedAssetsSha256 = createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(unpacked)
          .filter(([name]) => name.startsWith("generated/"))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, bytes]) => [
            name,
            createHash("sha256").update(bytes).digest("hex"),
          ]),
      ),
    )
    .digest("hex");
  for (const [name, bytes] of Object.entries(unpacked)) {
    assert(
      /^[\w./-]+$/.test(name) &&
        name.split("/").every((part) => part && part !== "." && part !== ".."),
    );
    await mkdir(dirname(join(extension, name)), { recursive: true });
    await writeFile(join(extension, name), bytes);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("./qa-browser-extension-issues-browser.mjs", import.meta.url),
        ),
      ],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          ...process.env,
          DOCA_QA_COOKIE: cookie,
          DOCA_QA_PROFILE: profile.id,
          DOCA_QA_APPEND: append.id,
          DOCA_QA_TARGET: target.id,
          DOCA_QA_QUICK_NOTES: JSON.stringify(
            quickNoteFixtures.map(({ before: _before, ...fixture }) => fixture),
          ),
          DOCA_QA_EXTENSION: extension,
          DOCA_QA_OUTPUT: output,
          DOCA_QA_BROWSER_PROFILE: join(root, "browser-profile"),
          DOCA_QA_WEB_MODE: webMode,
          ...(webBuildBefore
            ? { DOCA_QA_WEB_INDEX_SHA256: webBuildBefore.indexSha256 }
            : {}),
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Browser QA exited " + code)),
    );
  });
  const rows = await db
    .selectFrom("browser_clipper_receipts")
    .selectAll()
    .where("status", "=", "completed")
    .execute();
  assert.equal(rows.length, 4);
  const appended = await readAIDocument(db, { actor }, target.id);
  assert(String(appended.value).includes("原有排查内容"));
  assert(String(appended.value).includes("接线端子松动"));
  const assets = await db
    .selectFrom("assets")
    .selectAll()
    .where("purpose", "=", "attachment")
    .execute();
  assert.equal(assets.length, 4);
  for (const asset of assets) {
    const response = await request("GET", `/assets/${asset.id}/content`);
    assert.equal(response.statusCode, 200);
    assert(response.rawPayload.equals(image));
  }
  assert(
    materialReadVerified,
    "AI invoked browser_material_read on the attached receipt",
  );
  const aiJobs = await db.selectFrom("ai_jobs").selectAll().execute();
  assert(
    aiJobs.some((job) => job.status === "completed"),
    "AI must finish with an actual runner result",
  );
  const browserReport = JSON.parse(
    await readFile(join(output, "browser-report.json"), "utf8"),
  );
  assert.equal(browserReport.websiteRuntime?.mode, webMode);
  let websiteRuntime: Record<string, unknown> = {
    mode: webMode,
    server: "vite-development",
  };
  if (webBuildBefore) {
    const webBuildAfter = await fingerprintWebBuild();
    assert.deepEqual(
      webBuildAfter,
      webBuildBefore,
      "The compiled Web build changed during MV3 QA",
    );
    const servedWebIndexAfter = await verifyServedWebIndex();
    assert.equal(
      browserReport.websiteRuntime.document?.indexSha256,
      webBuildBefore.indexSha256,
    );
    assert.deepEqual(
      browserReport.websiteRuntime.developmentSourceRequests,
      [],
    );
    assert(browserReport.websiteRuntime.compiledScriptRequests.length > 0);
    await writeFile(
      join(output, "web-build-fingerprint.json"),
      JSON.stringify(webBuildAfter, null, 2),
    );
    websiteRuntime = {
      mode: webMode,
      server: "vite-preview",
      root: webBuildBefore.root,
      indexSha256: webBuildBefore.indexSha256,
      fullWebSha256: webBuildBefore.fullWebSha256,
      fileCount: webBuildBefore.fileCount,
      totalBytes: webBuildBefore.totalBytes,
      servedWebIndexBefore,
      servedWebIndexAfter,
      browserDocument: browserReport.websiteRuntime.document,
      unchangedDuringRun: true,
      fingerprintReceipt: "web-build-fingerprint.json",
    };
  }
  const quickNotes = browserReport.quickNotes;
  assert(quickNotes?.completedAt, "Installed MV3 quick-note QA completed");
  assert.equal(quickNotes.cases.length, 2);
  const noteResults = [];
  for (const fixture of quickNoteFixtures) {
    const note = quickNotes.cases.find(
      (entry: any) => entry.targetId === fixture.targetId,
    );
    assert(note, "The real popup appended to each supported format");
    assert.equal(note.profileId, fixture.profileId);
    assert.equal(note.format, fixture.format);
    const after = await readAIDocument(db, { actor }, fixture.targetId);
    assert.equal(after.epochId, fixture.before.epochId);
    assert.equal(after.seq, fixture.before.seq + 1);
    assert.equal(note.seq, after.seq);
    assert.equal(note.epochId, after.epochId);
    if (fixture.format === "markdown") {
      assert.equal(after.value, `${fixture.before.value}\n\n${note.text}`);
    } else {
      const previous = fixture.before.value as any[];
      const current = after.value as any[];
      assert.deepEqual(current.slice(0, previous.length), previous);
      assert.deepEqual(
        current.slice(previous.length).map((block) => ({
          type: block.type,
          children: block.children,
        })),
        note.text.split(/\r\n|\r|\n/).map((text: string) => ({
          type: "paragraph",
          children: [{ text }],
        })),
      );
    }
    const receipts = await db
      .selectFrom(
        fixture.format === "markdown" ? "markdown_receipts" : "editor_receipts",
      )
      .selectAll()
      .where("resource_id", "=", fixture.targetId)
      .where("message_id", "=", note.requestId)
      .execute();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]!.seq, after.seq);
    assert.equal(receipts[0]!.epoch_id, after.epochId);
    for (const failedId of quickNotes.rejectedRequestIds) {
      assert.equal(
        (
          await db
            .selectFrom(
              fixture.format === "markdown"
                ? "markdown_receipts"
                : "editor_receipts",
            )
            .select("message_id")
            .where("resource_id", "=", fixture.targetId)
            .where("message_id", "=", failedId)
            .execute()
        ).length,
        0,
      );
    }
    noteResults.push({
      format: fixture.format,
      targetId: fixture.targetId,
      requestId: note.requestId,
      seq: after.seq,
      epochId: after.epochId,
      receiptCount: receipts.length,
      originalContentAndEpochPreserved: true,
    });
  }
  assert.equal(
    modelCallTimes.filter((at) => at <= quickNotes.completedAt).length,
    0,
  );
  assert.equal(
    aiJobs.filter((job) => Date.parse(job.created_at) <= quickNotes.completedAt)
      .length,
    0,
  );
  assert.equal(
    (
      await db
        .selectFrom("browser_clipper_receipts")
        .select("created_at")
        .execute()
    ).filter((row) => Date.parse(row.created_at) <= quickNotes.completedAt)
      .length,
    0,
  );
  assert.equal(
    assets.filter(
      (asset) => Date.parse(asset.created_at) <= quickNotes.completedAt,
    ).length,
    0,
  );
  assert.equal(browserReport.extensionVersion, testedVersions.extension);
  assert.deepEqual(
    browserReport.earlyRefreshRecovery.map(
      (entry: { stage: string }) => entry.stage,
    ),
    ["paint", "create-session", "prepare-page"],
  );
  for (const entry of browserReport.earlyRefreshRecovery) {
    assert.equal(entry.acceptedMessagePosts, 1);
    assert.equal(entry.capturePreparations, 1);
    assert.equal(entry.newDraftPreserved, true);
    assert.equal(entry.profileIsolation, true);
    assert.equal(entry.indexedDBAcceptedTombstone, true);
    assert.equal(entry.legacyBytesPreserved, true);
    assert.equal(entry.profileId, profile.id);
    const jobs = aiJobs.filter((job) =>
      String(JSON.parse(job.input).text).startsWith(
        `QA_EARLY_${entry.stage}_ORIGINAL`,
      ),
    );
    assert.equal(jobs.length, 1);
    const job = jobs[0]!;
    assert.equal(job.id, entry.messageId);
    assert.equal(job.session_id, entry.sessionId);
    assert.equal(job.user_id, actor.id);
    assert.equal(job.status, "completed", job.error);
    assert(String(JSON.parse(job.input).text).includes(entry.captureRequestId));
    const binding = await db
      .selectFrom("browser_clipper_assistant_sessions")
      .selectAll()
      .where("session_id", "=", entry.sessionId)
      .executeTakeFirstOrThrow();
    assert.equal(binding.profile_id, profile.id);
    assert.equal(binding.user_id, actor.id);
    assert.equal(
      JSON.parse(binding.job_ids).ids.filter(
        (id: string) => id === entry.messageId,
      ).length,
      1,
    );
    const capture = await db
      .selectFrom("browser_clipper_receipts")
      .selectAll()
      .where("user_id", "=", actor.id)
      .where("request_id", "=", entry.captureRequestId)
      .executeTakeFirstOrThrow();
    assert.equal(capture.connection_id, binding.connection_id);
    assert.equal(capture.profile_id, profile.id);
    assert.notEqual(capture.status, "completed");
    assert.equal(capture.resource_id, null);
  }
  const replyLost = browserReport.acceptedReplyLostRecovery;
  assert.equal(replyLost.indexedDBAcceptedTombstone, true);
  assert.equal(replyLost.messageId, replyLost.serverJobId);
  assert.equal(replyLost.exactPendingReconciliation, true);
  assert.equal(replyLost.legacyBytesPreserved, true);
  assert.equal(replyLost.capturesAfterRefresh, 0);
  assert.equal(replyLost.messagePostsAfterRefresh, 0);
  assert.equal(replyLost.captureAttemptsAfterRefresh, 0);
  assert.equal(
    aiJobs.filter((job) => job.id === replyLost.messageId).length,
    1,
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
    websiteRuntime,
    database: "isolated SQLite",
    browser: "isolated native macOS Chrome for Testing extension",
    realModelProvider: false,
    attachedMaterialReadThroughRunner: materialReadVerified,
    completedCaptures: rows.length,
    originalImagesByteExact: assets.length,
    appendRetainsExistingContent: true,
    revocationRetainsDocuments: true,
    earlyRefreshRecovery: browserReport.earlyRefreshRecovery,
    acceptedReplyLostRecovery: replyLost,
    quickNotes: {
      ...quickNotes,
      nativeDocuments: noteResults,
      aiJobs: 0,
      modelCalls: 0,
      clipReceipts: 0,
      imageAssets: 0,
    },
    paidProviderCalls: 0,
    testedVersions,
    extensionZipSha256,
    packagedAssetsSha256,
    userDataUsed: false,
  };
  await writeFile(
    join(output, "server-report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(
    join(output, "server-failure-diagnostic.json"),
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
        webMode,
        compiledWebIndexSha256: webBuildBefore?.indexSha256,
        compiledFullWebSha256: webBuildBefore?.fullWebSha256,
        requests: [...serverTrace.values()].slice(-200),
        sessions: await db
          .selectFrom("ai_sessions")
          .select(["id", "created_at", "title"])
          .execute(),
        jobs: await db
          .selectFrom("ai_jobs")
          .select(["id", "session_id", "status"])
          .execute(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeWebServer();
  await app.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
