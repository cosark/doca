// Real Doca browser checks with synthetic documents, a temporary store and in-memory SQLite.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { createEditor } from "slate";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { restoreDocument } from "../packages/core/src/modules/collaboration/documents.js";
import { captureRichSelection } from "../apps/web/src/features/comments/rich-selection-anchor.js";

const root = await mkdtemp(join(tmpdir(), "doca-host-issues-"));
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
const actor = {
  ...(await createUser(
    db,
    {
      login: "hostissues",
      displayName: "Host issues QA",
      password: "isolated-host-issues-2026",
    },
    { bootstrap: true },
  )),
  admin: 1,
};
const port=Number(process.env.DOCA_QA_PORT??39441);
const origin = `http://127.0.0.1:${port}`;
const builtWeb=process.env.DOCA_QA_BUILT_WEB==="1";
const packagePins=JSON.parse(await readFile("package.json","utf8")).dependencies;
const editorPackages=["@smartdoca/canvas","@smartdoca/sheet","@smartdoca/slate","@smartdoca/markdown","@smartdoca/slides"];
const packages=Object.fromEntries(await Promise.all(editorPackages.map(async name=>[name,JSON.parse(await readFile(resolve("node_modules",name,"package.json"),"utf8")).version])));
const receiptScope={scope:"isolated synthetic Doca website/account/documents only",webMode:builtWeb?"production-build":"development-server",productionAccepted:false,packages,canvasArtifactSource:packagePins["@smartdoca/canvas"],candidateCanvasArtifact:packagePins["@smartdoca/canvas"].startsWith("file:"),...(builtWeb?{builtIndexSha256:createHash("sha256").update(await readFile("apps/web/dist/index.html")).digest("hex")}:{})};
const app = await createApp(db, {
  origin,
  ...(builtWeb ? { staticDirectory: resolve("apps/web/dist") } : {}),
  storage: { ...storageRuntime(), root },
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: builtWeb ? port : 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = builtWeb ? undefined : await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(root,"vite-cache"),
  server: {
    host: "127.0.0.1",
    port,
    hmr: false,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/verification/issue-tracker-2026-10-21/host-browser",
);
await mkdir(output, { recursive: true });
const checks: string[] = [],
  errors: string[] = [];
const pass = (message: string) => {
  checks.push(message);
  console.log("PASS " + message);
};
const until = async (check: () => Promise<boolean>, message: string) => {
  for (let index = 0; index < 150; index++) {
    if (await check()) return;
    await delay(100);
  }
  throw Error("Timed out: " + message);
};
let page: Page | undefined;
await web?.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const request = async (path: string, data?: unknown, method = "GET") => {
    const response = await context.request.fetch(origin + "/api/v1" + path, {
      method,
      headers: { origin },
      data,
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await request(
    "/auth/login",
    { login: "hostissues", password: "isolated-host-issues-2026" },
    "POST",
  );
  const content = createContent(db);
  const paragraphs = Array.from({ length: 420 }, (_, index) => ({
    id: `qa-paragraph-${index}`,
    type: "paragraph",
    children: [{ text: `Comment anchor ${index + 1}` }],
  }));
  const rich = await content.create(actor, {
    kind: "document",
    format: "rich_text",
    title: "Host comments QA",
    initialContent: { schemaVersion: 2, children: paragraphs },
  });
  const loaded = await restoreDocument(db, rich.id);
  const commentBody = (text: string) => ({
    version: 1 as const,
    blocks: [
      {
        type: "paragraph" as const,
        children: [{ type: "text" as const, text }],
      },
    ],
  });
  try {
    const editor = createEditor();
    editor.children = loaded.runtime.getValue();
    for (let index = 0; index < 420; index++) {
      const anchor = captureRichSelection(editor, loaded.runtime, {
        anchor: { path: [index, 0], offset: 0 },
        focus: { path: [index, 0], offset: 7 },
      });
      await content.comment(
        actor,
        rich.id,
        commentBody(`Thread message ${index + 1}`),
        null,
        JSON.stringify(anchor),
      );
    }
  } finally {
    loaded.destroy();
  }
  const first = await content.detail(actor, rich.id);
  assert(first.commentsNextCursor);
  for (let index = 0; index < 6; index++)
    await content.comment(
      actor,
      rich.id,
      commentBody(`Reply message ${index + 1}`),
      first.comments[0]!.id,
    );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  const updates: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === "update") updates.push(frame);
      } catch {}
    }),
  );
  let pageOneRequests = 0,
    heldFinalPage = false,
    heldRestartPage = false;
  let releaseFinalPage = () => {},
    releaseRestartPage = () => {};
  const finalPageGate = new Promise<void>((resolve) => {
    releaseFinalPage = resolve;
  });
  const restartPageGate = new Promise<void>((resolve) => {
    releaseRestartPage = resolve;
  });
  let finalCursor = "";
  await page.route(
    `**/api/v1/resources/${rich.id}/comments?cursor=*`,
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const firstBody = data.items[0]?.body;
      if (firstBody === "Thread message 201") {
        pageOneRequests++;
        if (pageOneRequests > 1 && !heldRestartPage) {
          heldRestartPage = true;
          await restartPageGate;
        }
      }
      if (firstBody === "Thread message 401" && !heldFinalPage) {
        heldFinalPage = true;
        finalCursor = new URL(route.request().url()).searchParams.get(
          "cursor",
        )!;
        await finalPageGate;
      }
      await route.fulfill({ response });
    },
  );
  await page.goto(origin + "/#/r/" + rich.id);
  await page.locator('[contenteditable="true"]').first().waitFor();
  await until(async () => heldFinalPage, "last comment page is pending");
  // A normal product action refreshes detail while the later cursor is pending.
  await page.getByRole("button", { name: "点赞", exact: true }).click();
  await until(
    async () =>
      heldRestartPage &&
      (await page!.locator(".selection-thread:not(.draft)").count()) === 200,
    "detail refresh resets to the initial comment page",
  );
  const staleResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).searchParams.get("cursor") === finalCursor,
  );
  releaseFinalPage();
  await staleResponse;
  await delay(200);
  assert.equal(
    await page.locator(".selection-thread:not(.draft)").count(),
    200,
    "stale later page must not skip the missing middle page",
  );
  releaseRestartPage();
  await until(
    async () =>
      (await page!.locator(".selection-thread:not(.draft)").count()) === 420,
    "automatic server pagination and all comment cards",
  );
  await page
    .getByText("Reply message 6", { exact: true })
    .waitFor({ state: "attached" });
  assert.equal(
    await page
      .getByRole("button", { name: /加载更多|更多回复|加载后续/ })
      .count(),
    0,
  );
  const seqBefore = await db
    .selectFrom("document_states")
    .select("seq")
    .where("resource_id", "=", rich.id)
    .executeTakeFirstOrThrow();
  await page.locator(".main-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page
    .getByText("Thread message 420", { exact: true })
    .waitFor({ state: "attached" });
  assert.equal(updates.length, 0);
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", rich.id)
      .executeTakeFirstOrThrow(),
    seqBefore,
  );
  await page.screenshot({ animations:"disabled", path: join(output, "comments-auto-pages.png") });
  pass(
    "420 anchored comments plus six replies load automatically; a delayed final page after detail refresh cannot skip the middle page, and scrolling produces no content updates",
  );
  const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
  assert(
    favicon?.includes("rich_text") || favicon?.startsWith("data:image/svg+xml"),
  );
  pass("document without an emoji uses its rich-text type favicon");

  const mediaDoc = await content.create(actor, {
    kind: "document",
    format: "rich_text",
    title: "Mixed media QA",
    initialContent: {
      schemaVersion: 2,
      children: [
        {
          id: "media-title",
          type: "paragraph",
          children: [{ text: "Mixed media QA" }],
        },
        {
          id: "media-flow",
          type: "flowchart",
          nodes: [
            { id: "s", label: "开始", x: 0, y: 0 },
            { id: "e", label: "交付", x: 240, y: 0 },
          ],
          edges: [{ id: "edge", source: "s", target: "e" }],
          children: [{ text: "" }],
        },
        {
          id: "media-mind",
          type: "mindmap",
          mindData: { nodeData: { id: "root", topic: "项目计划" } },
          children: [{ text: "" }],
        },
        {
          id: "media-end",
          type: "paragraph",
          children: [{ text: "Uploaded photos" }],
        },
      ],
    },
  });
  await page.goto(origin + "/#/r/" + mediaDoc.id);
  await page.locator('.sk-editable[contenteditable="true"]').waitFor();
  const sharpMedia = (await import("sharp")).default;
  for (const name of ["rich-first.png", "rich-second.png"]) {
    await page.locator(".sk-block-paragraph").last().click();
    await page.keyboard.press("End");
    await page
      .locator('.editor-fixed-toolbar input[type="file"]')
      .setInputFiles({
        name,
        mimeType: "image/png",
        buffer: await sharpMedia({
          create: {
            width: 160,
            height: 100,
            channels: 4,
            background: "#8752cc",
          },
        })
          .png()
          .toBuffer(),
      });
    await until(
      async () =>
        JSON.stringify(
          (await request(`/ai/resources/${mediaDoc.id}/preview`)).value,
        ).includes(name),
      name + " persisted",
    );
  }
  await page
    .getByRole("button", { name: "放大查看流程图", exact: true })
    .click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 4",
  );
  const richImage = page.locator(".document-image-preview-viewport img");
  await until(
    async () =>
      (await richImage.getAttribute("src"))?.startsWith("data:image/svg+xml") ??
      false,
    "flowchart SVG is lazily resolved",
  );
  assert.equal(
    await page
      .locator(".document-image-preview a[download]")
      .getAttribute("href"),
    await richImage.getAttribute("src"),
  );
  const svgBox = await richImage.boundingBox();
  assert(svgBox);
  await page.mouse.move(svgBox.x + 20, svgBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(svgBox.x + 120, svgBox.y + 60, { steps: 8 });
  await page.mouse.up();
  assert(
    (await richImage.getAttribute("style"))?.includes("translate(100px, 40px)"),
  );
  await page.getByRole("button", { name: "复制图片", exact: true }).click();
  await until(
    async () =>
      page!.evaluate(async () => {
        try {
          return (
            (await navigator.clipboard.read())[0]?.types.includes(
              "image/png",
            ) ?? false
          );
        } catch {
          return false;
        }
      }),
    "generated SVG copies to the clipboard as PNG",
  );
  await page.keyboard.press("ArrowRight");
  await until(
    async () =>
      (await richImage.getAttribute("src"))?.startsWith("data:image/svg+xml") ??
      false,
    "mind map SVG is lazily resolved",
  );
  await page.keyboard.press("ArrowRight");
  await until(
    async () =>
      (await richImage.getAttribute("src"))?.includes("/api/v1/assets/") ??
      false,
    "photo uses host asset URL",
  );
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.endsWith("?download=1"),
  );
  await page.keyboard.press("Escape");
  const mediaSeq = await db
    .selectFrom("document_states")
    .select("seq")
    .where("resource_id", "=", mediaDoc.id)
    .executeTakeFirstOrThrow();
  await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await page.getByRole("option", { name: "阅读", exact: true }).click();
  await page.locator(".sk-block-flowchart img").click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 4",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "查看历史记录", exact: true }).click();
  const mediaRecords = page.getByRole("dialog", {
    name: "历史记录",
    exact: true,
  });
  await mediaRecords
    .getByRole("button", { name: "保存当前快照", exact: true })
    .click();
  await mediaRecords
    .getByRole("button", { name: "查看", exact: true })
    .first()
    .click();
  const mediaHistory = page.locator(".version-preview-dialog");
  await mediaHistory.locator(".sk-block-flowchart img").click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 4",
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await until(
    async () =>
      (await richImage.getAttribute("src"))?.includes("/api/v1/assets/") ??
      false,
    "history photo uses host asset URL",
  );
  await page.screenshot({ animations:"disabled", path: join(output, "rich-history-gallery.png") });
  await page.keyboard.press("Escape");
  await mediaHistory
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await mediaRecords
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", mediaDoc.id)
      .executeTakeFirstOrThrow(),
    mediaSeq,
  );
  const currentMedia = await request(`/resources/${mediaDoc.id}`);
  await request(
    `/resources/${mediaDoc.id}/trash`,
    { version: currentMedia.resource.version },
    "POST",
  );
  await page.goto(origin + "/#/trash");
  await page.getByText("Mixed media QA", { exact: true }).click();
  const mediaTrash = page.locator(".trash-preview");
  await mediaTrash.locator(".sk-block-flowchart img").click();
  await page.locator(".document-image-preview").waitFor();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await until(
    async () =>
      (await richImage.getAttribute("src"))?.includes("?trashPreview=1") ??
      false,
    "trash photo retains its access flag",
  );
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.includes("?trashPreview=1&download=1"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "rich-trash-gallery.png") });
  await page.keyboard.press("Escape");
  pass(
    "Slate 0.4.24 mixed flowchart/mind-map/two-photo gallery pans and navigates in active, readonly, history and trash surfaces; generated SVGs retain direct downloads and photos retain host ACL URLs without content writes",
  );

  const markdownDoc = await request(
    "/resources",
    { title: "Markdown gallery QA", kind: "document", format: "markdown" },
    "POST",
  );
  const markdownAssets: string[] = [];
  for (const name of ["markdown-first.png", "markdown-second.png"]) {
    const response = await context.request.post(
      origin +
        `/api/v1/assets?purpose=attachment&resourceId=${markdownDoc.id}&filename=${name}`,
      {
        headers: { origin, "content-type": "application/octet-stream" },
        data: await sharpMedia({
          create: {
            width: 160,
            height: 100,
            channels: 4,
            background: "#2d9d78",
          },
        })
          .png()
          .toBuffer(),
      },
    );
    assert.equal(response.status(), 201, await response.text());
    markdownAssets.push((await response.json()).id);
  }
  const markdownValue = [
    "# Markdown gallery QA",
    "$E=mc^2$",
    `![First photo](${markdownAssets[0]})`,
    `![Second photo](${markdownAssets[1]})`,
    `![First photo again](${markdownAssets[0]})`,
    "```mermaid\nflowchart LR\nA[开始] --> B[完成]\n```",
  ].join("\n\n");
  await page.goto(origin + "/#/r/" + markdownDoc.id);
  const markdownInput = page.locator('.cm-content[contenteditable="true"]');
  await markdownInput.waitFor();
  await markdownInput.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    markdownValue,
  );
  await page.keyboard.press("ControlOrMeta+v");
  await until(
    async () =>
      (
        await request(`/ai/resources/${markdownDoc.id}/preview`)
      ).markdown?.includes("First photo again") ?? false,
    "Markdown native paste persists",
  );
  await page.getByTitle("仅预览", { exact: true }).click();
  await page.locator('[data-exmd-preview-kind="mermaid"] svg').waitFor();
  await page.locator(".preview-pane .katex").waitFor();
  const markdownFirst = page
    .locator('.preview-pane [data-exmd-preview-kind="image"]')
    .first();
  await markdownFirst.click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 4",
  );
  const markdownImage = page.locator(".document-image-preview-viewport img");
  await until(
    async () =>
      (await markdownImage.getAttribute("src"))?.includes(markdownAssets[0]!) ??
      false,
    "Markdown original image uses host asset path",
  );
  const markdownBox = await markdownImage.boundingBox();
  assert(markdownBox);
  await page.mouse.move(markdownBox.x + 20, markdownBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(markdownBox.x + 100, markdownBox.y + 55, { steps: 8 });
  await page.mouse.up();
  assert(
    (await markdownImage.getAttribute("style"))?.includes(
      "translate(80px, 35px)",
    ),
  );
  await page.keyboard.press("ArrowRight");
  await until(
    async () =>
      (await markdownImage.getAttribute("src"))?.includes(markdownAssets[1]!) ??
      false,
    "Markdown next image",
  );
  await page.mouse.move(800, 500);
  await page.mouse.wheel(120, 0);
  await until(
    async () =>
      (await page!
        .locator(".document-image-preview-position")
        .textContent()) === "3 / 4",
    "Markdown repeated occurrence remains a separate gallery item",
  );
  await page.keyboard.press("ArrowRight");
  await until(
    async () =>
      (await markdownImage.getAttribute("src"))?.startsWith(
        "data:image/svg+xml",
      ) ?? false,
    "Mermaid uses generated SVG",
  );
  assert.equal(
    await page
      .locator(".document-image-preview a[download]")
      .getAttribute("href"),
    await markdownImage.getAttribute("src"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "markdown-mixed-gallery.png") });
  await page.keyboard.press("Escape");
  const markdownSeq = await db
    .selectFrom("document_states")
    .select("seq")
    .where("resource_id", "=", markdownDoc.id)
    .executeTakeFirstOrThrow();
  await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await page.getByRole("option", { name: "阅读", exact: true }).click();
  await markdownFirst.click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 4",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "查看历史记录", exact: true }).click();
  const markdownRecords = page.getByRole("dialog", {
    name: "历史记录",
    exact: true,
  });
  await markdownRecords
    .getByRole("button", { name: "保存当前快照", exact: true })
    .click();
  await markdownRecords
    .getByRole("button", { name: "查看", exact: true })
    .first()
    .click();
  const markdownHistory = page.locator(".version-preview-dialog");
  await markdownHistory
    .locator('[data-exmd-preview-kind="image"]')
    .first()
    .click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 4",
  );
  await page.keyboard.press("Escape");
  await markdownHistory
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await markdownRecords
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", markdownDoc.id)
      .executeTakeFirstOrThrow(),
    markdownSeq,
  );
  const currentMarkdown = await request(`/resources/${markdownDoc.id}`);
  await request(
    `/resources/${markdownDoc.id}/trash`,
    { version: currentMarkdown.resource.version },
    "POST",
  );
  await page.goto(origin + "/#/trash");
  await page.getByText("Markdown gallery QA", { exact: true }).click();
  const markdownTrash = page.locator(".trash-preview");
  await markdownTrash
    .locator('[data-exmd-preview-kind="image"]')
    .first()
    .click();
  await page.locator(".document-image-preview").waitFor();
  await until(
    async () =>
      (await markdownImage.getAttribute("src"))?.includes("?trashPreview=1") ??
      false,
    "Markdown trash keeps its access flag",
  );
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.includes("?trashPreview=1&download=1"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "markdown-trash-gallery.png") });
  await page.keyboard.press("Escape");
  pass(
    "Markdown 0.4.4 host Preview wrapper forwards the complete image/repeated-occurrence/Mermaid gallery in active, readonly, history and trash; pan, keys, horizontal wheel, KaTeX and access flags survive without content writes",
  );

  const folder = await request(
    "/files/folders",
    { name: "Bulk QA", parentId: null },
    "POST",
  );
  for (let index = 0; index < 3; index++) {
    const response = await context.request.post(
      origin +
        `/api/v1/files/items?parentType=folder&parentId=${folder.id}&filename=${index}.txt`,
      {
        headers: { origin, "content-type": "application/octet-stream" },
        data: Buffer.from(`isolated ${index}`),
      },
    );
    assert.equal(response.status(), 200, await response.text());
  }
  await page.goto(origin + "/#/files");
  await page
    .getByRole("button", { name: /Bulk QA/ })
    .last()
    .dblclick();
  await page.locator(".files-view-switch button").nth(1).click();
  await until(
    async () => (await page!.locator(".file-entry").count()) === 3,
    "folder listing",
  );
  await page.getByRole("button", { name: "全选", exact: true }).click();
  assert.equal(await page.locator(".file-entry.selected").count(), 3);
  await page
    .getByRole("button", { name: /移到回收站/ })
    .first()
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "移到回收站",
    exact: true,
  });
  await confirmation.waitFor();
  assert.equal(
    (await request(`/files?parentType=folder&parentId=${folder.id}`)).files
      .length,
    3,
  );
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: /移到回收站/ })
    .first()
    .click();
  await confirmation.getByRole("button", { name: "确定", exact: true }).click();
  await until(
    async () =>
      (await request(`/files?parentType=folder&parentId=${folder.id}`)).files
        .length === 0,
    "all selected files moved to trash",
  );
  assert.equal(
    await db
      .selectFrom("file_items")
      .select("id")
      .where("parent_type", "=", "folder")
      .where("parent_id", "=", folder.id)
      .where("deleted_at", "is not", null)
      .execute()
      .then((rows) => rows.length),
    3,
  );
  await page.screenshot({ animations:"disabled", path: join(output, "files-bulk-trash.png") });
  pass(
    "visible select-all and batch trash cover the entire folder; cancellation preserves files, confirmation soft-deletes all three with retained storage",
  );

  const canvas = await request(
    "/resources",
    { title: "Host gallery QA", kind: "document", format: "canvas" },
    "POST",
  );
  await page.goto(origin + "/#/r/" + canvas.id);
  await page.locator(".canvas-host").waitFor();
  const sharp = (await import("sharp")).default;
  for (const [name, color] of [
    ["first.png", "#3370ff"],
    ["second.png", "#e5484d"],
  ]) {
    await page
      .locator(
        '.board-tools input[type="file"][accept="image/*"], input[type="file"][accept="image/*"]',
      )
      .first()
      .setInputFiles({
        name,
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 160, height: 100, channels: 4, background: color },
        })
          .png()
          .toBuffer(),
      });
    await until(async () => {
      const data = await request(`/ai/resources/${canvas.id}/preview`);
      const { CanvasModel } = await import("@smartdoca/canvas/model");
      const model = CanvasModel.restore({
        codec: "aidcanvas-yjs",
        schemaVersion: 1,
        epochId: data.surface.epochId,
        update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
      });
      try {
        return JSON.stringify(model.getValue()).includes(name);
      } finally {
        model.dispose();
      }
    }, name + " upload");
  }
  await page.reload();
  await page.locator(".canvas-host").waitFor();
  const gallerySeq = await db
    .selectFrom("document_states")
    .select("seq")
    .where("resource_id", "=", canvas.id)
    .executeTakeFirstOrThrow();
  const galleryUpdates = updates.length;
  const canvasHost = page.locator(".canvas-host"),
    box = await canvasHost.boundingBox();
  assert(box);
  const center = { x: box.width / 2, y: box.height / 2 };
  await canvasHost.click({ position: center });
  await canvasHost.click({ position: center });
  await page.locator(".document-image-preview").waitFor();
  const count = page.locator(".document-image-preview-position");
  assert.equal(await count.textContent(), "2 / 2");
  await page.getByRole("button", { name: "上一张图片", exact: true }).click();
  await page.getByRole("dialog", { name: "first.png", exact: true }).waitFor();
  const image = page.locator(".document-image-preview-viewport img");
  const imageBox = await image.boundingBox();
  assert(imageBox);
  await page.mouse.move(imageBox.x + 50, imageBox.y + 50);
  await page.mouse.down();
  await page.mouse.move(imageBox.x + 150, imageBox.y + 90, { steps: 8 });
  await page.mouse.up();
  assert(
    (await image.getAttribute("style"))?.includes("translate(100px, 40px)"),
  );
  await page.keyboard.press("ArrowRight");
  await page.getByRole("dialog", { name: "second.png", exact: true }).waitFor();
  assert((await image.getAttribute("style"))?.includes("translate(0px, 0px)"));
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("dialog", { name: "first.png", exact: true }).waitFor();
  await page.mouse.wheel(120, 0);
  await page.getByRole("dialog", { name: "second.png", exact: true }).waitFor();
  await page.screenshot({ animations:"disabled", path: join(output, "canvas-image-gallery.png") });
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", canvas.id)
      .executeTakeFirstOrThrow(),
    gallerySeq,
  );
  assert.equal(updates.length, galleryUpdates);
  pass(
    "Canvas gallery contains both authorized uploaded images, supports previous/next keys and horizontal wheel, and resets a dragged image's pan on navigation",
  );
  await page.keyboard.press("Escape");
  const openCanvasReadonly = async (
    scope: import("playwright-core").Locator,
  ) => {
    const host = scope.locator(".canvas-host"),
      bounds = await host.boundingBox();
    assert(bounds);
    await host.click({
      position: { x: Math.min(center.x,bounds.width-10), y: Math.min(center.y,bounds.height-10) },
    });
    if (!(await page!.locator(".document-image-preview").count())) {
      await delay(500);
      await host.click({
        position: { x: Math.min(center.x,bounds.width-10), y: Math.min(center.y,bounds.height-10) },
      });
    }
    await page!.locator(".document-image-preview").waitFor();
    assert.equal(await count.textContent(), "2 / 2");
    await page!.keyboard.press("ArrowLeft");
    await page!
      .getByRole("dialog", { name: "first.png", exact: true })
      .waitFor();
  };
  await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await page.getByRole("option", { name: "阅读", exact: true }).click();
  await delay(200);
  await openCanvasReadonly(page.locator(".canvas-document"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "查看历史记录", exact: true }).click();
  const canvasRecords = page.getByRole("dialog", {
    name: "历史记录",
    exact: true,
  });
  await canvasRecords
    .getByRole("button", { name: "保存当前快照", exact: true })
    .click();
  await canvasRecords
    .getByRole("button", { name: "查看", exact: true })
    .first()
    .click();
  const canvasHistory = page.locator(".version-preview-dialog");
  await canvasHistory.locator(".canvas-host").waitFor();
  await delay(200);
  await openCanvasReadonly(canvasHistory);
  await page.screenshot({ animations:"disabled", path: join(output, "canvas-history-gallery.png") });
  await page.keyboard.press("Escape");
  await canvasHistory
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await canvasRecords
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", canvas.id)
      .executeTakeFirstOrThrow(),
    gallerySeq,
  );
  assert.equal(updates.length, galleryUpdates);
  const canvasDetail = await request(`/resources/${canvas.id}`);
  await request(
    `/resources/${canvas.id}/trash`,
    { version: canvasDetail.resource.version },
    "POST",
  );
  await page.goto(origin + "/#/trash");
  await page.getByText("Host gallery QA", { exact: true }).click();
  const canvasTrash = page.locator(".trash-preview");
  await canvasTrash.locator(".canvas-host").waitFor();
  await delay(200);
  await openCanvasReadonly(canvasTrash);
  await until(
    async () =>
      (await image.getAttribute("src"))?.includes("?trashPreview=1") ?? false,
    "Canvas trash access flag",
  );
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.includes("?trashPreview=1&download=1"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "canvas-trash-gallery.png") });
  assert.deepEqual(
    await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", canvas.id)
      .executeTakeFirstOrThrow(),
    gallerySeq,
  );
  pass(
    "Canvas gallery works in readonly, history and recycle-bin surfaces with original host asset flags and zero content writes",
  );

  assert.deepEqual(errors, []);
  await rm(join(output, "failure.png"), { force: true });
  await rm(join(output, "failure.txt"), { force: true });
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ result:"passed", ...receiptScope, checks, errors }, null, 2),
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ animations:"disabled", path: join(output, "failure.png") })
      .catch(() => {});
  await writeFile(join(output, "failure.txt"), String(error));
  await writeFile(join(output,"results.json"),JSON.stringify({result:"failed",...receiptScope,checks,errors,error:String(error)},null,2)+"\n");
  throw error;
} finally {
  await browser.close();
  await web?.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
