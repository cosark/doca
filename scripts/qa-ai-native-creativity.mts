// Actual model -> Doca tools -> durable native documents -> browser rendering.
// Synthetic accounts, an in-memory SQLite database and temporary file storage only.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import {
  aiDefaults,
  saveAIConfig,
} from "../packages/core/src/modules/ai/config.js";
import { readAIDocument } from "../packages/core/src/workflows/ai-documents.js";
import { canvasSceneNodes } from "../packages/core/src/modules/ai/canvas-workflows.js";
import { exportPptx, importPptx } from "@smartdoca/slides/pptx";

assert.equal(process.env.DOCA_QA_ISOLATED, "1", "Set DOCA_QA_ISOLATED=1");
assert(process.env.DOCA_QA_KEY_FILE, "Use a private temporary credential file");
const key = (await readFile(process.env.DOCA_QA_KEY_FILE, "utf8")).trim();
const model = process.env.DOCA_QA_MODEL ?? "kimi-k2.7-code";
const baseUrl =
  process.env.DOCA_QA_BASE_URL ?? "https://ai-gateway.heyphp.com/v1";
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? `artifacts/ai-native-creativity-${Date.now()}`,
);
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "doca-ai-creativity-"));
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const owner = {
  ...(await createUser(
    db,
    {
      login: "aicreativity",
      displayName: "AI Demo QA",
      password: "isolated-ai-creativity",
    },
    { bootstrap: true },
  )),
  admin: 1,
};
await saveAIConfig(
  db,
  {
    ...aiDefaults,
    defaultModel: "qa",
    maxSteps: 40,
    historyRounds: 12,
    vendors: [
      {
        id: "gateway",
        name: "QA gateway",
        provider: "compatible",
        baseUrl,
        apiKey: key,
        enabled: true,
      },
    ],
    models: [
      {
        id: "qa",
        vendorId: "gateway",
        model,
        alias: model,
        enabled: true,
        tools: true,
        vision: false,
        maxInput: 250000,
        maxOutput: 16000,
      },
    ],
  },
  0,
);
const port = Number(process.env.DOCA_QA_PORT ?? 39462),
  origin = `http://127.0.0.1:${port}`;
let requestNumber = 0;
const traceWrites: Promise<unknown>[] = [];
const app = await createApp(db, {
  origin,
  storage: { ...storageRuntime(), root },
  ai: {
    memory: { driver: "sqlite", url: ":memory:" },
    maxConcurrentJobs: 2,
    fetch: (async (input, init) => {
      const n = ++requestNumber,
        body = String(init?.body ?? "");
      if (body)
        await writeFile(
          join(output, `model-${n}-request.json`),
          body.replaceAll(key, "[redacted]"),
        );
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(Number(process.env.DOCA_QA_TIMEOUT_MS ?? 600000)),
        ]),
      });
      traceWrites.push(
        response
          .clone()
          .text()
          .then((text) =>
            writeFile(
              join(output, `model-${n}-response.txt`),
              text.replaceAll(key, "[redacted]"),
            ),
          )
          .catch((error) =>
            writeFile(
              join(output, `model-${n}-transport-error.txt`),
              String(error).replaceAll(key, "[redacted]"),
            ),
          ),
      );
      return response;
    }) as typeof fetch,
  },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
await web.listen();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
});
const errors: string[] = [],
  results: any[] = [];
context.on("page", (page) =>
  page.on("pageerror", (error) => errors.push(error.message)),
);
const request = async (path: string, data?: unknown) => {
  const response = await context.request.fetch(origin + "/api/v1" + path, {
    method: data ? "POST" : "GET",
    headers: { origin },
    data,
  });
  assert(
    response.ok(),
    `${path}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
};
await request("/auth/login", {
  login: "aicreativity",
  password: "isolated-ai-creativity",
});
const nodes = (value: any) => canvasSceneNodes(value.scene);
const text = (value: any) => JSON.stringify(value);
const deckSlides = (v: any) => v.slideOrder.map((id: string) => v.slides[id]);
const cases = [
  {
    id: "ppt",
    format: "presentation",
    title: "远程团队协作方案",
    prompt:
      "把当前空白演示制作成完整5页《远程团队协作方案》PPT：封面、现状与痛点、同步会议与共享文档对比（原生表格，至少3行3列）、两周试点计划、验收与下一步。恰好5页，复用或清理默认示例页；每页有明确标题、实际正文和讲稿备注，统一蓝白配色，原生可编辑元素，不用图片替代。不要新建另一份文档，不查外部资料，不编造统计数据。完成后保存回读。",
    verify(v: any) {
      assert.equal(v.slideOrder.length, 5);
      assert(deckSlides(v).every((s: any) => s.notes?.trim()));
      assert(
        deckSlides(v).some((s: any) =>
          Object.values(s.elements).some((e: any) => e.type === "table"),
        ),
      );
      for (const s of deckSlides(v))
        assert(
          s.elementOrder.some((id: string) => s.elements[id].type === "text"),
        );
    },
    edit: "只修改第3页和第5页，保持其余页面及页面数量不变：第3页表格第二行第二列改为“共享文档优先”，表头背景改深蓝且白字加粗；第5页标题改为“下一步与负责人”，讲稿备注写明“周五复盘，负责人小林”。保留所有已有元素ID与原生可编辑结构。",
    verifyEdit(a: any, b: any) {
      assert.deepEqual(b.slideOrder, a.slideOrder);
      for (const i of [0, 1, 3])
        assert.deepEqual(b.slides[b.slideOrder[i]], a.slides[a.slideOrder[i]]);
      assert(text(b).includes("共享文档优先"));
      assert(text(b).includes("下一步与负责人"));
      assert(text(b).includes("周五复盘，负责人小林"));
    },
  },
  {
    id: "flowchart",
    format: "canvas",
    title: "请假审批流程",
    prompt:
      "在当前画布生成完整的请假审批流程图：提交申请、资料检查、资料完整？、补充材料、主管审批、审批通过？、归档。包含条件分支和退回连线，连线标签写清通过/退回。使用原生流程节点和有端点关系的连接器，布局整齐，不要画成截图；保存回读。",
    verify(v: any) {
      assert(
        nodes(v).filter((n) => n.data?.kind === "diagram-node").length >= 7,
      );
      assert(nodes(v).filter((n) => n.data?.kind === "connector").length >= 6);
      for (const word of ["提交申请", "资料", "主管", "归档"])
        assert(text(v).includes(word));
    },
    edit: "将“归档”节点标签改成“归档并通知申请人”，将该节点填充改为浅绿色 #e5f6ee，保留全部节点ID、连接器和其他节点文字。",
    verifyEdit(a: any, b: any) {
      assert.deepEqual(
        nodes(b)
          .map((n) => n.id)
          .sort(),
        nodes(a)
          .map((n) => n.id)
          .sort(),
      );
      assert(text(b).includes("归档并通知申请人"));
      assert(text(b).includes("#e5f6ee"));
    },
  },
  {
    id: "mindmap",
    format: "canvas",
    title: "产品发布思维导图",
    prompt:
      "在当前画布生成原生思维导图：根主题“产品发布”，四个分支“产品设计”“研发实现”“市场推广”“客户支持”，每个分支至少两个具体子主题。左右均衡布局，主题、逻辑层级和连线都要可编辑。保存回读。",
    verify(v: any) {
      assert(nodes(v).filter((n) => n.data?.kind === "mind-node").length >= 13);
      assert(nodes(v).some((n) => n.data?.kind === "mindmap"));
      for (const word of ["产品设计", "研发实现", "市场推广", "客户支持"])
        assert(text(v).includes(word));
    },
    edit: "删除“市场推广”主题和它的全部子主题，保留其他三条分支及各自子主题，根主题改成“产品发布计划”。不要重建整张导图，保留其他节点ID。",
    verifyEdit(a: any, b: any) {
      assert(text(b).includes("产品发布计划"));
      assert(!text(b).includes("市场推广"));
      const topics = nodes(b).filter((n) => n.data?.kind === "mind-node"),
        ids = new Set(topics.map((n) => n.id));
      for (const n of topics)
        assert(!n.data?.parentId || ids.has(n.data.parentId));
      assert(
        nodes(b).filter((n) => n.data?.kind === "mind-node").length <
          nodes(a).filter((n) => n.data?.kind === "mind-node").length,
      );
    },
  },
  {
    id: "table",
    format: "canvas",
    title: "项目任务表",
    prompt:
      "在当前画布创建原生可编辑任务表，3列4行，内容必须是：任务/负责人/状态；视觉设计/小林/进行中；前端开发/小周/待开始；测试验收/小李/待开始。表头深蓝白字、居中加粗，列宽适合中文，行高至少52像素。保存回读。",
    verify(v: any) {
      const t = nodes(v).find((n) => n.data?.kind === "table");
      assert(t);
      assert.equal(t.data!.rows, 4);
      assert.equal(t.data!.columns, 3);
      for (const word of ["视觉设计", "小林", "前端开发", "测试验收"])
        assert(text(v).includes(word));
    },
    edit: "修改这张原生表格：视觉设计负责人改成“小陈”；末尾新增一行“接口联调/小周/进行中”；第1列宽设为260像素；把最后两行的第3列状态格合并，保留原有文字；不重建表格。",
    verifyEdit(a: any, b: any) {
      const t = nodes(b).find((n) => n.data?.kind === "table")!;
      assert.equal(t.data!.rows, 5);
      assert.equal(t.data!.columnWidths[0], 260);
      assert(text(b).includes("小陈"));
      assert(text(b).includes("接口联调"));
      assert(
        t.children!.some(
          (n) =>
            n.data?.row === 3 && n.data?.column === 2 && n.data?.rowSpan === 2,
        ),
        "合并必须覆盖最终最后两行 index 3/4 的状态列",
      );
      assert.equal(t.id, nodes(a).find((n) => n.data?.kind === "table")!.id);
    },
  },
  {
    id: "ui",
    format: "canvas",
    title: "拾光手机与平板界面",
    prompt:
      "在当前画布制作“拾光”阅读记录App的两个原生可编辑UI设计：手机首页和pad阅读工作台，并排放在phone和tablet原生设备容器内。浅底、深文字、蓝色强调；手机包含顶部标题与头像、阅读进度卡、最近阅读列表、主要按钮、底部导航；平板包含侧栏导航、阅读概览、书籍卡片和笔记区。使用Text/Rect等原生矢量元素放入各自容器，至少每个容器12个内容元素，布局完整、留白一致，不使用截图或图片，不额外创建文档。",
    verify(v: any) {
      assert(v.scene.children.every((n: any) => ["phone", "tablet"].includes(n.data?.containerType)), "UI content must be inside device containers, not root siblings");
      for (const kind of ["phone", "tablet"]) {
        const n = nodes(v).find((n) => n.data?.containerType === kind);
        assert(n, kind);
        assert((n.children?.length ?? 0) >= 12, kind + " content");
      }
      assert(text(v).includes("拾光"));
      assert(!nodes(v).some((n) => n.tag === "Image"));
    },
    edit: "保留手机和平板容器及内容，把两套界面的主要按钮和强调色统一改为珊瑚色 #cf5b3b，手机主按钮文字改成“开始今日阅读”，平板笔记区标题改成“本周阅读笔记”。不要重新生成或删除原有内容。",
    verifyEdit(a: any, b: any) {
      assert(text(b).includes("#cf5b3b"));
      assert(text(b).includes("开始今日阅读"));
      assert(text(b).includes("本周阅读笔记"));
      const ids = new Set(nodes(b).map((n) => n.id));
      for (const n of nodes(a)) assert(ids.has(n.id));
    },
  },
  {
    id: "pattern",
    format: "canvas",
    title: "几何小狐狸徽章",
    prompt:
      "在当前画布用原生可编辑矢量图形画一个有辨识度的小狐狸徽章：橙色狐狸脸、尖耳、白色脸颊、眼睛鼻子，外圈装饰和星星，下方文字“KEEP CURIOUS”。至少14个图形，组合为一个分组，整体居中，配色协调。不用图片、生图或SVG截图。可以使用Path/Polygon/Star/Ellipse等原生形状。",
    verify(v: any) {
      assert(nodes(v).length >= 15);
      assert(nodes(v).some((n) => n.tag === "Group"));
      assert(!nodes(v).some((n) => n.tag === "Image"));
      assert(text(v).includes("KEEP CURIOUS"));
      for (const n of nodes(v))
        if (n.points)
          assert(
            Array.isArray(n.points) && !n.points.some(Array.isArray),
            "Every native polygon/line must have renderable point data",
          );
    },
    edit: "保留狐狸徽章的全部原有元素，在徽章外圈新增6颗小星星，分散排列不遮挡狐狸脸；将下方文字改成“STAY CURIOUS”。保持原生可编辑分组。",
    verifyEdit(a: any, b: any) {
      assert(text(b).includes("STAY CURIOUS"));
      assert(nodes(b).length >= nodes(a).length + 6);
      const ids = new Set(nodes(b).map((n) => n.id));
      for (const n of nodes(a)) assert(ids.has(n.id));
    },
  },

  {
    id: "create",
    format: "presentation",
    title: "AI新建演示验收",
    createInChat: true,
    prompt:
      "请直接新建一份在线演示文稿，标题必须为“AI新建演示验收”，完整制作恰好3页关于个人知识管理的PPT：收集、整理、复盘。每页有标题、至少2条实质内容和讲稿备注，用原生可编辑文字与统一配色。只需在线文稿，不要导出文件，不查外网，不询问风格。",
    verify(v: any) {
      assert.equal(v.slideOrder.length, 3);
      for (const word of ["收集", "整理", "复盘"])
        assert(text(v).includes(word));
      assert(deckSlides(v).every((slide: any) => slide.notes?.trim()));
    },
    edit: "保持恰好3页和所有原生元素ID，把第3页标题改成“每周复盘”，备注增加“每周五回顾一次”。仅修改第3页。",
    verifyEdit(a: any, b: any) {
      assert.deepEqual(a.slideOrder, b.slideOrder);
      for (const i of [0, 1])
        assert.deepEqual(a.slides[a.slideOrder[i]], b.slides[b.slideOrder[i]]);
      assert(text(b).includes("每周复盘"));
      assert(text(b).includes("每周五回顾一次"));
    },
  },
];
async function job(
  sessionId: string,
  resourceId: string | undefined,
  prompt: string,
  label: string,
) {
  const id = randomUUID();
  await request(`/ai/sessions/${sessionId}/messages`, {
    id,
    text: prompt,
    modelId: "qa",
    scope: resourceId ? "document" : "all",
    ...(resourceId
      ? { currentResourceId: resourceId, references: [{ resourceId }] }
      : { references: [], skipApprovals: { create: true } }),
    skillIds: [],
    webSearch: false,
  });
  console.log(`START ${label}`);
  for (let i = 0; i < 1200; i++) {
    const state = await request(`/ai/sessions/${sessionId}`),
      current = state.jobs.find((j: any) => j.id === id);
    if (current && !["queued", "running"].includes(current.status)) {
      await writeFile(
        join(output, `${label}-job.json`),
        JSON.stringify(current, null, 2),
      );
      if (current.status !== "completed" && resourceId) {
        try {
          const partial = await readAIDocument(
            db,
            { actor: owner },
            resourceId,
          );
          await snapshot(
            resourceId,
            label + "-failed",
            partial.resource.format,
          );
        } catch (error) {
          console.log(`Failed-artifact capture: ${String(error)}`);
        }
      }
      assert.equal(
        current.status,
        "completed",
        `${label}: ${current.error || current.status}`,
      );
      assert.equal(
        current.progress?.review?.verdict,
        "pass",
        `${label}: independent review`,
      );
      console.log(`PASS ${label}`);
      return current;
    }
    await delay(1000);
  }
  throw Error("Timed out: " + label);
}
async function snapshot(resourceId: string, label: string, format: string) {
  const saved = await readAIDocument(db, { actor: owner }, resourceId);
  await writeFile(
    join(output, `${label}.json`),
    JSON.stringify(saved.value, null, 2),
  );
  const page = await context.newPage();
  try {
    await page.goto(origin + "/#/r/" + resourceId);
    await page
      .locator(format === "presentation" ? ".eppt-workspace" : ".canvas-host")
      .waitFor({ timeout: 45000 });
    await delay(1200);
    if (format === "canvas") {
      const fit = page
        .getByRole("button", {
          name: /适应画布|适应内容|显示全部|Fit canvas|Fit all/,
        })
        .first();
      if (await fit.count()) await fit.click();
      await page.locator(".canvas-app").focus();
      await page.keyboard.press("Shift+Digit1");
      await delay(500);
    }
    await page.screenshot({
      path: join(output, `${label}.png`),
      fullPage: true,
    });
    if (format === "presentation") {
      const thumbnails = page.locator(".eppt-thumbnail");
      for (let i = 0; i < (await thumbnails.count()); i++) {
        await thumbnails.nth(i).click();
        await delay(150);
        await page.screenshot({
          path: join(output, `${label}-slide-${i + 1}.png`),
        });
      }
      const file = await exportPptx(saved.value as any);
      await writeFile(
        join(output, `${label}.pptx`),
        Buffer.from(await file.blob.arrayBuffer()),
      );
      const imported = await importPptx(
        new Uint8Array(await file.blob.arrayBuffer()),
      );
      assert.equal(
        imported.document.slideOrder.length,
        (saved.value as any).slideOrder.length,
      );
    }
    const afterView = await readAIDocument(db, { actor: owner }, resourceId);
    assert.equal(
      afterView.seq,
      saved.seq,
      "Rendering/fit must not create content writes",
    );
    return saved.value;
  } finally {
    await page.close();
  }
}
try {
  const selected = (
    process.env.DOCA_QA_CASES ?? cases.map((c) => c.id).join(",")
  ).split(",");
  for (const test of cases.filter((c) => selected.includes(c.id))) {
    const result: any = { case: test.id, model, rounds: [], passed: false };
    results.push(result);
    try {
      const previousIds = new Set(
        (await db.selectFrom("resources").select("id").execute()).map(
          (row) => row.id,
        ),
      );
      let resource = (test as any).createInChat
        ? undefined
        : await request("/resources", {
            kind: "document",
            format: test.format,
            title: test.title,
          });
      const session = await request("/ai/sessions", {
        modelId: "qa",
        resourceIds: resource ? [resource.id] : [],
      });
      await job(session.id, resource?.id, test.prompt, test.id + "-generate");
      if (!resource) {
        const created = (
          await db
            .selectFrom("resources")
            .selectAll()
            .where("kind", "=", "document")
            .where("format", "=", "presentation")
            .execute()
        ).filter((row) => !previousIds.has(row.id));
        assert.equal(
          created.length,
          1,
          "Assistant must create exactly one real document",
        );
        resource = created[0]!;
      }
      const before = await snapshot(
        resource.id,
        test.id + "-generate",
        test.format,
      );
      test.verify(before);
      result.rounds.push(
        "generation saved, independently reviewed, rendered and asserted",
      );
      await job(session.id, resource.id, test.edit, test.id + "-edit");
      const after = await snapshot(resource.id, test.id + "-edit", test.format);
      test.verifyEdit(before, after);
      result.rounds.push(
        "follow-up edit saved, independently reviewed, rendered and asserted",
      );
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.log(`FAIL ${test.id}: ${result.error}`);
    }
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(
        { model, results, browserErrors: errors, modelRequests: requestNumber },
        null,
        2,
      ),
    );
  }
  console.log(
    JSON.stringify(
      {
        output,
        results: results.map((r) => ({
          case: r.case,
          passed: r.passed,
          error: r.error,
        })),
        browserErrors: errors,
        modelRequests: requestNumber,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => !r.passed) || errors.length) process.exitCode = 1;
} finally {
  await app.close();
  await Promise.allSettled(traceWrites);
  await browser.close();
  await web.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
