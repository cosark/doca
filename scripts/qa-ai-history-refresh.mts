// Isolated host/browser regression: real image attachments with delayed history responses.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import {
  aiDefaults,
  saveAIConfig,
} from "../packages/core/src/modules/ai/config.js";
import { mockAI } from "../tests/ai-mock.js";
const root = await mkdtemp(join(tmpdir(), "doca-ai-image-message-"));
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
const owner = await createUser(
  db,
  {
    login: "imagemessageqa",
    displayName: "Image Message QA",
    password: "isolated-image-message-2026",
  },
  { bootstrap: true },
);
await saveAIConfig(
  db,
  {
    ...aiDefaults,
    defaultModel: "test",
    vendors: [
      {
        id: "test-vendor",
        name: "Test",
        provider: "compatible",
        baseUrl: "https://mock.invalid/v1",
        apiKey: "not-real",
        enabled: true,
      },
    ],
    models: [
      {
        id: "test",
        vendorId: "test-vendor",
        model: "mock",
        alias: "Mock",
        enabled: true,
        maxInput: 64000,
        maxOutput: 1000,
        vision: true,
        tools: true,
      },
    ],
  },
  0,
);
const origin = "http://127.0.0.1:39428";
const app = await createApp(db, {
  origin,
  storage: { ...storageRuntime(), root },
  ai: { memory: { driver: "sqlite", url: ":memory:" }, fetch: mockAI() },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    hmr: false,
    watch: { ignored: ["**/*"] },
    host: "127.0.0.1",
    port: 39428,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
await web.listen();
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/ai-history-refresh-2026-10-16",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const request = async (
    path: string,
    data?: unknown,
    method = "GET",
    headers = {},
  ) => {
    const response = await context.request.fetch(origin + "/api/v1" + path, {
      method,
      headers: { origin, ...headers },
      data,
    });
    assert(response.ok(), await response.text());
    return response.json();
  };
  await request(
    "/auth/login",
    { login: "imagemessageqa", password: "isolated-image-message-2026" },
    "POST",
  );
  const png = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "#7d4be8" },
  })
    .png()
    .toBuffer();
  const asset = await request(
    "/assets?purpose=ai_attachment&filename=message-proof.png",
    png,
    "POST",
    { "content-type": "application/octet-stream" },
  );
  const board = await createContent(db).create({ ...owner, admin: 1 }, {
    kind: "document", format: "canvas", title: "Isolated image history board",
  });
  const session = await request(
    "/ai/sessions",
    { modelId: "test", resourceIds: [board.id] },
    "POST",
  );
  const marker = "图片消息刷新验收";
  await request(
    `/ai/sessions/${session.id}/messages`,
    {
      id: randomUUID(),
      text: marker,
      modelId: "test",
      scope: "all",
      attachments: [asset.id],
    },
    "POST",
  );
  let current: any;
  for (let i = 0; i < 200; i++) {
    current = await request(`/ai/sessions/${session.id}`);
    if (
      current.jobs[0] &&
      !["queued", "running"].includes(current.jobs[0].status)
    )
      break;
    await delay(50);
  }
  assert.equal(
    current.messages.find((m: any) => m.role === "user").attachments[0].id,
    asset.id,
  );
  const page = await context.newPage();
  let loads = 0,
    mode: "snapshot" | "error" = "snapshot";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ marker }) => {
      const state = {
        seen: false,
        disappeared: false,
        events: [] as unknown[],
      };
      (window as any).__messageProbe = state;
      new MutationObserver(() => {
        const present =
          document
            .querySelector(".ai-bubble-list")
            ?.textContent?.includes(marker) ?? false;
        if (present && !state.seen) {
          state.seen = true;
          state.events.push({ type: "visible", at: performance.now() });
        }
        if (state.seen && !present) {
          state.disappeared = true;
          state.events.push({ type: "absent", at: performance.now() });
        }
      }).observe(document, { childList: true, subtree: true });
    },
    { marker },
  );
  await page.route(
    origin + `/api/v1/ai/sessions/${session.id}`,
    async (route) => {
      const n = ++loads;
      if (n === 2) {
        await delay(1400);
        await route.fulfill(
          mode === "error"
            ? { status: 403, json: { message: "late rejected snapshot" } }
            : { json: { ...current, messages: [] } },
        );
      } else {
        await delay(n > 2 ? 100 : 0);
        await route.fulfill({ json: current });
      }
    },
  );
  await page.route(
    origin + `/api/v1/ai/sessions/${session.id}/stream`,
    (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: ["queued", "running", "completed"]
          .map(
            (status) =>
              "event: job\ndata: " +
              JSON.stringify({ ...current.jobs[0], status }) +
              "\n\n",
          )
          .join(""),
      }),
  );
  const checks: unknown[] = [];
  for (const surface of ["full", "canvas"] as const) for (const scenario of ["snapshot", "error"] as const) {
    loads = 0;
    mode = scenario;
    if (scenario === "snapshot") {
      await page.goto(origin + (surface === "canvas" ? `/#/r/${board.id}` : "/#/ai") + "?session=" + session.id);
      // Hash navigation reuses the document; start a fresh observation for each surface.
      await page.reload();
    } else await page.reload();
    await page
      .locator(".ai-bubble-list")
      .getByText(marker, { exact: true })
      .waitFor();
    await delay(1800);
    const observation = await page.evaluate(
      () => (window as any).__messageProbe,
    );
    assert.equal(observation.seen, true);
    assert.equal(
      observation.disappeared,
      false,
      "A stale history response removed the sent image message",
    );
    assert.equal(
      await page
        .locator(".ai-bubble-list")
        .getByText(marker, { exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByText("late rejected snapshot", { exact: true }).count(),
      0,
    );
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll<HTMLImageElement>(
          ".ai-message-attachments img",
        ),
      ].some((image) => image.naturalWidth > 0),
    );
    await page.screenshot({ path: join(output, surface + "-" + scenario + ".png") });
    checks.push({ surface, scenario, loads, observation });
    console.log(
      "PASS " + surface + " sent image message remains visible after " +
        scenario +
        " arrives late",
    );
  }
  const after = await request(`/ai/sessions/${session.id}`);
  assert.deepEqual(
    after.messages.map((message: any) => message.id),
    current.messages.map((message: any) => message.id),
  );
  // Collapsing the canvas assistant used to unmount AIChat, cancel its pending
  // upload and discard its optimistic image/message after consuming the draft.
  const sendBoard = await createContent(db).create({ ...owner, admin: 1 }, {
    kind: "document", format: "canvas", title: "Isolated uploading board",
  });
  const sending = await context.newPage();
  sending.on("pageerror", error => errors.push(error.message));
  let releaseCreation!: () => void, releaseUpload!: () => void;
  const creationGate = new Promise<void>(resolve => { releaseCreation = resolve; });
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  let uploads = 0, sends = 0, submitted: any;
  await sending.route("**/api/v1/ai/sessions", async route => {
    if (route.request().method() === "POST") await creationGate;
    await route.continue();
  });
  await sending.route("**/api/v1/assets?*", async route => {
    if (route.request().method() === "POST") { uploads++; await uploadGate; }
    await route.continue();
  });
  await sending.route("**/api/v1/ai/sessions/*/messages", async route => {
    if (route.request().method() === "POST") { sends++; submitted = route.request().postDataJSON(); }
    await route.continue();
  });
  try {
    await sending.goto(origin + "/#/r/" + sendBoard.id);
    await sending.locator(".ai-document-trigger").click();
    const composer = sending.locator('.ai-composer [contenteditable="true"]');
    await composer.waitFor();
    await sending.getByRole("button", { name: "上传文件或图片", exact: true }).click();
    const chooser = sending.waitForEvent("filechooser");
    await sending.locator(".file-source-choice").nth(1).locator("button").first().click();
    await (await chooser).setFiles([{ name: "pending-canvas.png", mimeType: "image/png", buffer: png }]);
    await sending.locator('.ai-upload-list img[src^="blob:"]').waitFor();
    const pendingMarker = "CANVAS_COLLAPSE_UPLOAD";
    await composer.fill(pendingMarker);
    await sending.getByRole("button", { name: "发送", exact: true }).click();
    const bubble = sending.locator(".ai-user-message-text").filter({ hasText: pendingMarker });
    await bubble.waitFor();
    await sending.getByRole("button", { name: "收起 AI", exact: true }).click();
    await sending.locator(".ai-document-trigger").click();
    await bubble.waitFor();
    assert.equal(uploads, 0);
    releaseCreation();
    for (let i = 0; i < 100 && !uploads; i++) await delay(50);
    assert.equal(uploads, 1);
    await sending.getByRole("button", { name: "收起 AI", exact: true }).click();
    releaseUpload();
    for (let i = 0; i < 100 && !sends; i++) await delay(50);
    assert.equal(sends, 1, "Collapsing must not cancel the submitted image");
    await sending.locator(".ai-document-trigger").click();
    await bubble.waitFor();
    await sending.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".ai-message-attachments img")].some(image => image.naturalWidth > 0));
    assert.equal(await bubble.count(), 1);
    assert.equal(uploads, 1);
    await sending.screenshot({ path: join(output, "canvas-collapse-upload.png") });
    await sending.reload();
    await bubble.waitFor();
    await sending.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".ai-message-attachments img")].some(image => image.naturalWidth > 0));
    assert.equal(await bubble.count(), 1);
    checks.push({ scenario: "canvas-collapse-upload", uploads, sends, messageId: submitted.id });
    console.log("PASS canvas collapse during session creation and upload preserves the image, message and one submission after reload");
  } finally {
    releaseCreation(); releaseUpload(); await sending.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify({ result: "passed", checks, errors }, null, 2) + "\n",
  );
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
