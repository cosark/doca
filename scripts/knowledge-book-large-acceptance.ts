/** Real-model acceptance against an isolated, retained database and object store. */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { createServer } from "vite";
import { fromMarkdown } from "mdast-util-from-markdown";
import { z } from "zod";
import { openDatabase } from "@db/index.js";
import { createUser } from "@core/modules/identity/passwords.js";
import {
  createKnowledgeBook,
  saveBookConfiguration,
  queueBookRun,
  bookHash,
} from "@core/modules/knowledge-books/management.js";
import {
  acceptanceOutputSchema,
  defaultBookConfiguration,
} from "@core/modules/knowledge-books/protocol.js";
import { executeBookCommand } from "@core/modules/knowledge-books/commands.js";
import { executeBookRun } from "@core/modules/knowledge-books/engine.js";
import {
  readBookRun,
  readBookRelease,
} from "@core/modules/knowledge-books/reads.js";
import { createApp } from "../apps/server/src/app/create-app.js";
import { storageRuntime } from "../apps/server/src/adapters/storage.js";
import { createHostFileStore } from "../apps/server/src/services/host-file-store.js";
import { bindBookPayloadStore } from "@core/modules/knowledge-books/payload-storage.js";
import { recoverBookRuns } from "@core/modules/knowledge-books/recovery.js";
import { knowledgeBookRuntime } from "../apps/server/src/services/ai/knowledge-book-runtime.js";
import { bookContentMetrics } from "../apps/server/src/services/ai/knowledge-book-batching.js";

const output = resolve(
  process.env.DOCA_LARGE_BOOK_OUTPUT ??
    "artifacts/knowledge-book-large-2026-10-13",
);
const depthFixture = process.env.DOCA_LARGE_BOOK_DEPTH_STATE
  ? JSON.parse(
      await readFile(resolve(process.env.DOCA_LARGE_BOOK_DEPTH_STATE), "utf8"),
    )
  : undefined;
const resumeState =
  process.env.DOCA_LARGE_BOOK_RESUME === "1" ||
  process.env.DOCA_LARGE_BOOK_SERVE_ONLY === "1"
    ? JSON.parse(await readFile(resolve(output, "state.json"), "utf8"))
    : depthFixture;
const creating = !resumeState || !!depthFixture;
const root = resolve(
  resumeState?.root ??
    process.env.DOCA_LARGE_BOOK_DIR ??
    `.cache/knowledge-book-large-${Date.now()}`,
);
await mkdir(root, { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: true });
let config: any;
if (resumeState) {
  const source = new Database(resolve(root, "qa.db"), { readonly: true });
  try {
    config = JSON.parse(
      (
        source
          .prepare("select config from account_settings where id='ai'")
          .get() as any
      ).config,
    );
  } finally {
    source.close();
  }
} else if (process.env.DOCA_DATABASE === "postgres") {
  const pool = new Pool({
    connectionString: process.env.DOCA_DATABASE_URL,
    max: 1,
  });
  try {
    config = JSON.parse(
      (await pool.query("select config from account_settings where id='ai'"))
        .rows[0].config,
    );
  } finally {
    await pool.end();
  }
} else {
  const source = new Database(
    process.env.DOCA_SQLITE_PATH ?? "./data/v1/doca.db",
    { readonly: true },
  );
  try {
    config = JSON.parse(
      (
        source
          .prepare("select config from account_settings where id='ai'")
          .get() as any
      ).config,
    );
  } finally {
    source.close();
  }
}
const model =
  config.models.find(
    (item: any) => item.id === process.env.DOCA_LARGE_BOOK_MODEL,
  ) ??
  config.models.find(
    (item: any) =>
      item.enabled && item.tools && item.model === "doubao-seed-2.1-lite",
  );
if (!model?.enabled) throw new Error("An enabled authorized model is required");
config.defaultModel = model.id;
config.memoryEnabled = false;
process.env.DOCA_FILE_STORE_ID = "large-book-qa";
if (resumeState)
  process.env.DOCA_CREDENTIAL_MASTER_KEY = (
    await readFile(resolve(root, "master-key.txt"), "utf8")
  ).trim();
else {
  process.env.DOCA_CREDENTIAL_MASTER_KEY ||= randomBytes(32).toString("hex");
  await writeFile(
    resolve(root, "master-key.txt"),
    process.env.DOCA_CREDENTIAL_MASTER_KEY,
    { mode: 0o600 },
  );
}
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: {
    "large-book-qa": { provider: "local", root: resolve(root, "objects") },
  },
});
const db = await openDatabase({
  driver: "sqlite",
  path: resolve(root, "qa.db"),
});
await chmod(resolve(root, "qa.db"), 0o600);
const actor = resumeState
  ? await db
      .selectFrom("users")
      .select(["id", "display_name", "admin"])
      .where("id", "=", resumeState.userId)
      .executeTakeFirstOrThrow()
  : {
      ...(await createUser(
        db,
        {
          login: "large-book-qa",
          displayName: "知识册长文验收",
          password: "isolated-book-qa-2026",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
if (!resumeState)
  await db
    .insertInto("account_settings")
    .values({ id: "ai", revision: 1, config: JSON.stringify(config) })
    .execute();
const origin = "http://127.0.0.1:39273";
// Own the execution in this harness so the HTTP worker cannot race it and
// discard the inspection observer or the in-memory repair diagnostics.
const fixtureStorage = storageRuntime(process.env);
bindBookPayloadStore(db, createHostFileStore(fixtureStorage));
await recoverBookRuns(db, new Date(Date.now() - 5 * 60_000).toISOString());
const book = !creating
  ? { id: resumeState.bookId }
  : await createKnowledgeBook(
      db,
      actor,
      depthFixture
        ? "计算机网络深入解析 · 十万字深度验收"
        : "计算机网络知识百科 · 十万字验收",
    );
const actionBook = resumeState
  ? { id: resumeState.actionBookId }
  : await createKnowledgeBook(db, actor, "卡片操作验收");
const sourceDirectory = resolve(
  process.env.DOCA_LARGE_BOOK_SOURCES ?? "tests/fixtures/network-guide",
);
const sources: string[] = creating ? [] : resumeState.sources;
if (creating)
  for (const file of (await readdir(sourceDirectory))
    .filter((file) =>
      process.env.DOCA_LARGE_BOOK_SOURCES
        ? file.endsWith(".md")
        : /^(link|net|trans|app|sec|exp)-\d.*\.md$/.test(file),
    )
    .sort()) {
    const markdown = await readFile(resolve(sourceDirectory, file), "utf8");
    await executeBookCommand(db, actor, book.id, {
      operation: "source.save",
      expectedRevision: 0,
      title: markdown.match(/^#\s+(.+)$/m)?.[1] ?? file,
      status: "active",
      configuration: {
        version: 1,
        items: [{ id: "chapter", kind: "manual", markdown }],
      },
    });
    sources.push(file);
  }
const configuration = defaultBookConfiguration();
configuration.modelId = model.id;
configuration.autoPublish = true;
configuration.goal =
  "生成中文计算机网络知识百科，目标约120000字，最终实际正文至少100000字符。面向工程师，详细解释分层、链路、IP与邻居发现、路由、TCP与QUIC、DNS、HTTP、TLS与IPsec、安全、性能及排障。第一层按基础概念、协议机制、工程实践、排障与验证中的适用分类，具体章节自定。包含真实可渲染的 Mermaid 流程图、架构图和时序图，图表须配合机制讲解。各批次承担分配的字数，不能每批重复全册要求；引用所提供来源，有条件和反例、字段含义、步骤、权衡、可执行示例。不能用学习指引替代实际正文，不能重复填充文字或虚构事实。";
configuration.criteria = [
  {
    id: "grounded",
    description:
      "实际正文详细覆盖当前来源的机制、条件、易错点与实践，事实均被来源支持，保留不确定性；不能用重复填充或学习路线替代内容。单批只检查本批的事实和细节，整册主题覆盖在最终汇总检查。",
    required: true,
  },
  {
    id: "size-and-diagrams",
    description:
      "整册实际正文至少100000字符，并包含真实 Mermaid 流程图、架构关系图和时序图，有解释节点和关系的文字。各批无需独立达到总字数或包含所有类型的图。",
    required: true,
  },
];
if (process.env.DOCA_LARGE_BOOK_CONFIGURATION) {
  const supplied = JSON.parse(
    await readFile(resolve(process.env.DOCA_LARGE_BOOK_CONFIGURATION), "utf8"),
  );
  configuration.goal = supplied.goal;
  configuration.criteria = supplied.criteria;
  for (const node of configuration.workflow.nodes)
    if (supplied.nodeInstructions?.[node.id])
      node.parameters.instructions = supplied.nodeInstructions[node.id];
}
if (creating) await saveBookConfiguration(db, actor, book.id, 1, configuration);
const state = {
  root,
  bookId: book.id,
  actionBookId: actionBook.id,
  modelId: model.id,
  userId: actor.id,
  origin,
  url: `${origin}/#/knowledge-books/${book.id}`,
  sources,
};
await writeFile(resolve(output, "state.json"), JSON.stringify(state, null, 2));
console.log(
  JSON.stringify({
    event: "fixture_ready",
    ...state,
    model: model.model,
    maxInput: model.maxInput,
    maxOutput: model.maxOutput,
  }),
);
const run = !creating
  ? process.env.DOCA_LARGE_BOOK_SERVE_ONLY === "1"
    ? { id: (await readFile(resolve(output, "run-id.txt"), "utf8")).trim() }
    : ((await executeBookCommand(db, actor, book.id, {
        operation: "run.resume",
        runId: (await readFile(resolve(output, "run-id.txt"), "utf8")).trim(),
      })) as { id: string })
  : await queueBookRun(db, actor, book.id);
await writeFile(resolve(output, "run-id.txt"), run.id);
const repairFindings = process.env.DOCA_LARGE_BOOK_REPAIR_FINDINGS
  ? z
      .object({
        pagesHash: z.string().regex(/^[a-f0-9]{64}$/),
        scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
        reviews: acceptanceOutputSchema.shape.checks
          .min(1)
          .max(512)
          .refine((reviews) => reviews.every((review) => !review.passed)),
      })
      .strict()
      .parse(
        JSON.parse(
          await readFile(
            resolve(process.env.DOCA_LARGE_BOOK_REPAIR_FINDINGS),
            "utf8",
          ),
        ),
      )
  : undefined;
const baseRuntime = knowledgeBookRuntime(
  db,
  actor.id,
  run.id,
  model.id,
  undefined,
  async (event) => {
    const directory = resolve(root, "invalid-model-output");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(
        directory,
        `${event.stage}-${randomBytes(12).toString("hex")}.json`,
      ),
      JSON.stringify(event),
      { mode: 0o600 },
    );
  },
  async (event) => {
    const directory = resolve(root, "inspection-findings");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(directory, `${randomBytes(12).toString("hex")}.json`),
      JSON.stringify(event),
      { mode: 0o600 },
    );
  },
);
const runtime: typeof baseRuntime = {
  ...baseRuntime,
  async generate(stage, input, signal, report) {
    const matchesRepairCandidate =
      stage === "organize" &&
      repairFindings &&
      [input.priorReviewPages, input.pages].some(
        (pages) =>
          Array.isArray(pages) && bookHash(pages) === repairFindings.pagesHash,
      );
    if (
      matchesRepairCandidate &&
      bookHash([input.evidence, input.claims]) !== repairFindings!.scopeHash
    )
      throw new Error(
        "Independent repair findings do not match the live execution evidence scope",
      );
    // Independent QA findings guide ordinary model repair only. They never
    // replace model output, override acceptance checks or edit stored pages.
    if (
      stage === "organize" &&
      repairFindings &&
      bookHash([input.evidence, input.claims]) === repairFindings.scopeHash &&
      matchesRepairCandidate
    ) {
      input = {
        ...input,
        priorReviews: [
          ...((input.priorReviews ?? []) as typeof repairFindings.reviews),
          ...repairFindings.reviews,
        ],
      };
      await writeFile(
        resolve(output, "manual-repair-feedback-applied.json"),
        JSON.stringify(repairFindings, null, 2),
      );
    }
    return baseRuntime.generate(stage, input, signal, report);
  },
};
const timer = setInterval(() => {
  void readBookRun(db, actor, book.id, run.id)
    .then((current) => {
      const recent = current.logs.at(-1);
      console.log(
        JSON.stringify({
          event: "progress",
          status: current.status,
          last: recent && {
            nodeId: recent.nodeId,
            code: recent.code,
            value: recent.value,
            total: recent.total,
          },
          nodes: current.nodes.map((node) => ({
            type: node.type,
            status: node.status,
          })),
        }),
      );
    })
    .catch((error) => console.error(error.message));
}, 15000);
if (process.env.DOCA_LARGE_BOOK_SERVE_ONLY !== "1")
  for (let attempt = 0; ; attempt++) {
    await executeBookRun(db, run.id, runtime);
    const current = await readBookRun(db, actor, book.id, run.id);
    await writeFile(
      resolve(output, `attempt-${attempt}-report.json`),
      JSON.stringify(current, null, 2),
    );
    const limit = Number(process.env.DOCA_LARGE_BOOK_AUTO_REPAIR ?? 0);
    if (
      attempt >= limit ||
      current.status !== "failed" ||
      !current.error?.includes('"book_acceptance"')
    )
      break;
    await executeBookCommand(db, actor, book.id, {
      operation: "run.resume",
      runId: run.id,
    });
  }
clearInterval(timer);
const app = await createApp(db, {
  origin,
  logging: false,
  pluginDirectory: resolve(root, "plugins"),
  ai: { memory: { driver: "sqlite", url: resolve(root, "memory.db") } },
  webhookDispatch: false,
});
await app.listen({ host: "127.0.0.1", port: 39272 });
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 39273,
    strictPort: true,
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        `${resolve(".cache")}/**`,
        `${resolve("data")}/**`,
        `${root}/**`,
      ],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:39272",
        ws: true,
        changeOrigin: false,
      },
      "/health": "http://127.0.0.1:39272",
    },
  },
});
await web.listen();
console.log(JSON.stringify({ event: "reader_ready", url: state.url }));
const result = await readBookRun(db, actor, book.id, run.id);
await writeFile(
  resolve(output, "run-report.json"),
  JSON.stringify(result, null, 2),
);
if (result.status === "published" && result.artifact) {
  const row = await db
    .selectFrom("knowledge_books")
    .select("published_release_id")
    .where("id", "=", book.id)
    .executeTakeFirstOrThrow();
  const release = await readBookRelease(
    db,
    actor,
    book.id,
    row.published_release_id!,
  );
  const markdown = release
    .artifact!.pages.map(
      (page) =>
        `# ${[...page.path, page.title].join(" / ")}\n\n${page.paragraphs.map((paragraph) => paragraph.markdown).join("\n\n")}`,
    )
    .join("\n\n");
  const text = (node: any): string =>
    node.type === "code"
      ? ""
      : (node.value ?? (node.children ?? []).map(text).join(""));
  const metrics = {
    ...bookContentMetrics(release.artifact!.pages, release.artifact!.claims),
    exportedTextCharacters: text(fromMarkdown(markdown)).length,
  };
  await writeFile(resolve(output, "network-encyclopedia.md"), markdown);
  await writeFile(
    resolve(output, "metrics.json"),
    JSON.stringify(
      {
        status: result.status,
        releaseId: release.id,
        metrics,
        checks: release.artifact!.checks,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ event: "completed", metrics, releaseId: release.id }),
  );
  if (metrics.bodyCharacters < 100000 || metrics.diagramCount < 3)
    throw new Error(
      "Persisted output did not satisfy the real length/diagram acceptance",
    );
} else
  console.error(
    JSON.stringify({
      event: "failed",
      status: result.status,
      error: result.error,
    }),
  );
// Retain the isolated fixture for browser checks and inspection until interrupted.
const keepAlive = setInterval(() => {}, 60000);
process.stdin.resume();
const close = async () => {
  clearInterval(keepAlive);
  await web.close();
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
