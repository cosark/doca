// Actual Doca + shipped Sheet artifact, with an isolated account/database/store.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { captureRuntimeFingerprint } from "./qa-runtime-fingerprint.js";
const root = await mkdtemp(join(tmpdir(), "doca-sheet-gallery-"));
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
await createUser(
  db,
  {
    login: "sheetgallery",
    displayName: "Sheet QA user",
    password: "isolated-sheet-gallery-2026",
  },
  { bootstrap: true },
);
const port=Number(process.env.DOCA_QA_PORT??39442);
const origin = `http://127.0.0.1:${port}`;
const builtWeb=process.env.DOCA_QA_BUILT_WEB==="1";
const pendingHoverKeyboardClose=process.env.DOCA_QA_PENDING_HOVER_KEYBOARD_CLOSE==="1";
const packagePins=JSON.parse(await readFile("package.json","utf8")).dependencies;
const editorPackages=["@smartdoca/canvas","@smartdoca/sheet","@smartdoca/slate","@smartdoca/markdown","@smartdoca/slides"];
const packages=Object.fromEntries(await Promise.all(editorPackages.map(async name=>[name,JSON.parse(await readFile(resolve("node_modules",name,"package.json"),"utf8")).version])));
const runtimeFingerprint = await captureRuntimeFingerprint(builtWeb);
let runtimeFingerprintAfter: Awaited<ReturnType<typeof captureRuntimeFingerprint>> | undefined;
let fingerprintError: string | undefined;
const receiptScope={scope:"isolated synthetic Doca website/account/documents only",webMode:builtWeb?"production-build":"development-server",productionAccepted:false,pendingHoverKeyboardClose,packages,runtimeFingerprint,scriptSha256:createHash("sha256").update(await readFile("scripts/qa-sheet-gallery-2026-10-21.mts")).digest("hex"),fingerprintScriptSha256:createHash("sha256").update(await readFile("scripts/qa-runtime-fingerprint.ts")).digest("hex"),canvasArtifactSource:packagePins["@smartdoca/canvas"],candidateCanvasArtifact:packagePins["@smartdoca/canvas"].startsWith("file:"),sheetArtifactSource:packagePins["@smartdoca/sheet"],candidateSheetArtifact:packagePins["@smartdoca/sheet"].startsWith("file:"),...(builtWeb?{builtIndexSha256:createHash("sha256").update(await readFile("apps/web/dist/index.html")).digest("hex")}:{})};
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
    "artifacts/verification/issue-tracker-2026-10-21/sheet-browser",
);
await mkdir(output, { recursive: true });
await web?.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [],
  errors: string[] = [],
  consoleErrors: string[] = [];
const started = Date.now();
let stage = "setup";
const stages: { stage: string; elapsedMs: number }[] = [];
const errorDetails: { name: string; message: string; stack?: string; stage: string; elapsedMs: number; url: string; completedChecks: string[] }[] = [];
const consoleErrorDetails: { message: string; location: unknown; stage: string; elapsedMs: number }[] = [];
const enterStage = (name: string) => {
  stage = name;
  stages.push({ stage, elapsedMs: Date.now() - started });
  console.log("STAGE " + stage);
};
let page: Page | undefined;
const until = async (check: () => Promise<boolean>, name: string) => {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw Error("Timed out: " + name);
};
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS " + name);
};
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
    { login: "sheetgallery", password: "isolated-sheet-gallery-2026" },
    "POST",
  );
  const sheet = await request(
    "/resources",
    { title: "Sheet gallery QA", kind: "document", format: "spreadsheet" },
    "POST",
  );
  const seq = async () =>
    (
      await db
        .selectFrom("document_states")
        .select("seq")
        .where("resource_id", "=", sheet.id)
        .executeTakeFirstOrThrow()
    ).seq;
  const project = async () => {
    const data = await request(`/ai/resources/${sheet.id}/preview`);
    const { projectExlsxWorkbook } = await import("@smartdoca/sheet/model");
    return projectExlsxWorkbook({
      baseline: data.surface.baseline,
      update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
      checkpointSeq: 0,
    });
  };
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => {
    errors.push(error.message);
    const detail = { name: error.name, message: error.message, stack: error.stack, stage, elapsedMs: Date.now() - started, url: page!.url(), completedChecks: [...checks] };
    errorDetails.push(detail);
    console.error("BROWSER ERROR " + JSON.stringify(detail));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
      consoleErrorDetails.push({ message: message.text(), location: message.location(), stage, elapsedMs: Date.now() - started });
    }
  });
  const updates: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === "update") updates.push(frame);
      } catch {}
    }),
  );
  const select = async (range: string) => {
    const input = page!
      .locator(".uos-editor")
      .getByRole("textbox", { exact: true });
    await input.fill(range);
    await input.press("Enter");
  };
  const saved = async () => {
    await page!
      .getByText(/(?:^| · )已保存到云端$/)
      .last()
      .waitFor({ state: "attached" });
  };
  const insertImages = async (names: string[]) => {
    await page!.getByRole("button", { name: "插入", exact: true }).click();
    await page!
      .getByRole("menuitem", { name: "单元格内图片", exact: true })
      .click();
    const dialog = page!.getByRole("dialog", {
      name: "插入内联图片",
      exact: true,
    });
    const sharp = (await import("sharp")).default;
    await dialog.getByLabel("选择内联图片", { exact: true }).setInputFiles(
      await Promise.all(
        names.map(async (name, index) => ({
          name,
          mimeType: "image/png",
          buffer: await sharp({
            create: {
              width: 48,
              height: 32,
              channels: 4,
              background: index ? "#e5484d" : "#3370ff",
            },
          })
            .png()
            .toBuffer(),
        })),
      ),
    );
    await dialog.getByRole("button", { name: "插入完成", exact: true }).click();
  };
  enterStage("mount-live-sheet");
  await page.goto(origin + "/#/r/" + sheet.id);
  await page.locator(".uos-editor__select-all").waitFor();
  await saved();
  enterStage("insert-live-images-and-resize-column");
  await select("D1");
  await insertImages(["sheet-first.png", "sheet-second.png"]);
  await page.keyboard.press("Enter");
  await saved();
  await until(
    async () => JSON.stringify(await project()).includes("sheet-second.png"),
    "two native inline images are saved",
  );
  const grid = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  const box = await grid.boundingBox();
  assert(box);
  // Widen D through its visible header boundary so both 48-pixel images fit.
  await page.mouse.move(box.x + 48 + 4 * 87.12, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 48 + 4 * 87.12 + 120, box.y + 10, { steps: 8 });
  await page.mouse.up();
  await saved();
  await select("D1");
  await page.keyboard.press("Escape");
  await page.screenshot({ animations:"disabled", path: join(output, "before-click.png") });
  enterStage("live-image-gallery");
  const beforePreview = await seq(),
    beforeUpdates = updates.length;
  await grid.click({ position: { x: 48 + 3 * 87.12 + 12, y: 22 + 12 } });
  assert.equal(await page.locator(".document-image-preview").count(), 0);
  await delay(700);
  await grid.click({ position: { x: 48 + 3 * 87.12 + 12, y: 22 + 12 } });
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 2",
  );
  await page.keyboard.press("Escape");
  await grid.click({ position: { x: 48 + 3 * 87.12 + 60, y: 22 + 12 } });
  await delay(700);
  await grid.click({ position: { x: 48 + 3 * 87.12 + 60, y: 22 + 12 } });
  await page
    .getByRole("dialog", { name: "sheet-second.png", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "2 / 2",
  );
  await page.screenshot({ animations:"disabled", path: join(output, "same-cell-second-image.png") });
  await page.keyboard.press("Escape");
  assert.equal(await seq(), beforePreview);
  assert.equal(updates.length, beforeUpdates);
  pass(
    "first click selects and second previews; second image in the same cell opens the exact native drawing occurrence without content updates",
  );
  enterStage("native-draft-preview-and-cancel");
  await select("D1");
  await grid.focus();
  await page.keyboard.press("F2");
  await delay(250);
  await page.keyboard.press("End");
  await page.keyboard.type(" pending draft");
  const draftSeq = await seq(),
    draftUpdates = updates.length;
  await page.screenshot({
    path: join(output, "native-draft-before-preview.png"),
  });
  const draftCanvas = page.locator("#univer-doc-main-canvas").last();
  await draftCanvas.click({ position: { x: 12, y: 12 } });
  await delay(700);
  await draftCanvas.click({ position: { x: 12, y: 12 } });
  await page.locator(".document-image-preview").waitFor();
  await page.keyboard.press("Escape");
  await delay(150);
  assert.equal(await seq(), draftSeq);
  assert.equal(updates.length, draftUpdates);
  await page.keyboard.press("Escape");
  assert(!JSON.stringify(await project()).includes("pending draft"));
  pass(
    "opening and closing a draft image preview does not submit or replace the native cell draft; Escape still cancels it",
  );
  // A second native draft continues after the modal, proving that typed text was
  // retained rather than merely checking that the server stayed unchanged.
  enterStage("native-draft-preview-continue-and-commit");
  await select("D1");
  await grid.focus();
  await page.keyboard.press("F2");
  await delay(250);
  await page.keyboard.press("End");
  await page.keyboard.type(" retained draft");
  const retainedSeq = await seq();
  await page
    .locator("#univer-doc-main-canvas")
    .last()
    .click({ position: { x: 12, y: 12 } });
  await delay(700);
  await page
    .locator("#univer-doc-main-canvas")
    .last()
    .click({ position: { x: 12, y: 12 } });
  await page.locator(".document-image-preview").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await seq(), retainedSeq);
  await delay(200);
  for (let step = 0; step < 40; step++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" continued");
  await page.keyboard.press("Enter");
  await saved();
  await until(async () => {
    const value = JSON.stringify(await project());
    return (
      value.includes("retained draft") &&
      value.includes("continued") &&
      value.includes("sheet-first.png") &&
      value.includes("sheet-second.png")
    );
  }, "native draft survives host focus and can continue after closing");
  pass(
    "native draft text and both images survive the host modal, continue editing and commit only on explicit Enter",
  );
  enterStage("insert-image-on-second-worksheet");
  await page.getByRole("button", { name: "新增工作表", exact: true }).click();
  await saved();
  await select("A1");
  await insertImages(["sheet-other.png"]);
  await page.keyboard.press("Enter");
  await saved();
  await until(
    async () => JSON.stringify(await project()).includes("sheet-other.png"),
    "image on another worksheet saved",
  );
  await page.getByText("Sheet1", { exact: true }).click();
  await delay(300);
  const baselineSeq = await seq(),
    baselineUpdates = updates.length;
  const openFirst = async (target = grid, readonly = false) => {
    await target.click({ position: { x: 48 + 3 * 87.12 + 12, y: 22 + 12 } });
    if (!readonly) {
      await delay(700);
      await target.click({ position: { x: 48 + 3 * 87.12 + 12, y: 22 + 12 } });
    }
    await page!.locator(".document-image-preview").waitFor();
  };
  const allThree = async () => {
    assert.equal(
      await page!.locator(".document-image-preview-position").textContent(),
      "1 / 3",
    );
    await page!.keyboard.press("ArrowRight");
    await page!.keyboard.press("ArrowRight");
    await page!
      .getByRole("dialog", { name: "sheet-other.png", exact: true })
      .waitFor();
  };
  enterStage("cross-worksheet-live-gallery");
  await openFirst();
  await allThree();
  await page.screenshot({ animations:"disabled", path: join(output, "cross-sheet-gallery.png") });
  await page.keyboard.press("Escape");
  enterStage("switch-readonly-and-gallery");
  await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await page.getByRole("option", { name: "阅读", exact: true }).click();
  await delay(250);
  await openFirst(grid, true);
  await allThree();
  await page.screenshot({ animations:"disabled", path: join(output, "readonly-gallery.png") });
  await page.keyboard.press("Escape");
  enterStage("open-history-records-and-preview");
  await page.getByRole("button", { name: "查看历史记录", exact: true }).click();
  const records = page.getByRole("dialog", { name: "历史记录", exact: true });
  await records
    .getByRole("button", { name: "保存当前快照", exact: true })
    .click();
  await records
    .getByRole("button", { name: "查看", exact: true })
    .first()
    .click();
  const history = page.locator(".version-preview-dialog");
  await history.locator('canvas[id^="univer-sheet-main-canvas_"]').waitFor();
  await delay(300);
  enterStage("history-image-gallery");
  await openFirst(
    history.locator('canvas[id^="univer-sheet-main-canvas_"]'),
    true,
  );
  await allThree();
  await page.screenshot({ animations:"disabled", path: join(output, "history-gallery.png") });
  await page.keyboard.press("Escape");
  enterStage("close-history-preview");
  const closeHistory = history.getByRole("button", { name: "关闭", exact: true }).last();
  if (pendingHoverKeyboardClose) {
    // Real pointer movement followed by keyboard closure keeps the last native
    // hover pending during disposal, without injecting editor state or events.
    await closeHistory.focus();
    const historyGrid = await history.locator('canvas[id^="univer-sheet-main-canvas_"]').boundingBox();
    assert(historyGrid);
    await page.mouse.move(historyGrid.x + 48 + 2 * 87.12 + 12, historyGrid.y + 22 + 12);
    await page.keyboard.press("Enter");
  } else {
    await closeHistory.click();
  }
  enterStage("close-history-records");
  await records
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  assert.equal(await seq(), baselineSeq);
  assert.equal(updates.length, baselineUpdates);
  pass(
    "the full document gallery crosses worksheets in active, readonly and history surfaces without content writes",
  );
  enterStage("trash-sheet-on-server");
  const detail = await request(`/resources/${sheet.id}`);
  await request(
    `/resources/${sheet.id}/trash`,
    { version: detail.resource.version },
    "POST",
  );
  enterStage("leave-live-sheet-for-trash-route");
  await page.goto(origin + "/#/trash");
  enterStage("mount-trash-sheet-preview");
  await page.getByText("Sheet gallery QA", { exact: true }).click();
  const trash = page.locator(".trash-preview");
  await trash.locator('canvas[id^="univer-sheet-main-canvas_"]').waitFor();
  await delay(300);
  enterStage("trash-image-gallery");
  await openFirst(
    trash.locator('canvas[id^="univer-sheet-main-canvas_"]'),
    true,
  );
  await allThree();
  await until(
    async () =>
      (
        await page!
          .locator(".document-image-preview-viewport img")
          .getAttribute("src")
      )?.includes("?trashPreview=1") ?? false,
    "trash asset flag retained",
  );
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.includes("?trashPreview=1&download=1"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "trash-gallery.png") });
  await page.keyboard.press("Escape");
  assert.equal(await seq(), baselineSeq);
  pass(
    "recycle-bin Sheet preview retains all worksheet images and original asset preview/download authorization flags without writes",
  );

  enterStage("final-browser-error-assertions");
  runtimeFingerprintAfter = await captureRuntimeFingerprint(builtWeb);
  assert.deepEqual(runtimeFingerprintAfter, runtimeFingerprint, "packages, full Web build or lockfile changed during gallery QA");
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ result:"passed", ...receiptScope, runtimeFingerprintAfter, checks, errors, errorDetails, consoleErrors, consoleErrorDetails, stages }, null, 2),
  );
  await rm(join(output, "failure.png"), { force: true });
  await rm(join(output, "failure.txt"), { force: true });
} catch (error) {
  if (!runtimeFingerprintAfter) runtimeFingerprintAfter = await captureRuntimeFingerprint(builtWeb).catch(failure => { fingerprintError = String(failure); return undefined; });
  await page?.screenshot({ animations:"disabled", path: join(output, "failure.png") }).catch(() => {});
  await writeFile(join(output, "failure.txt"), String(error));
  await writeFile(join(output,"results.json"),JSON.stringify({result:"failed",...receiptScope,runtimeFingerprintAfter,fingerprintError,checks,errors,errorDetails,consoleErrors,consoleErrorDetails,stages,error:String(error),failureStack:error instanceof Error?error.stack:undefined},null,2)+"\n");
  throw error;
} finally {
  await browser.close();
  await web?.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
