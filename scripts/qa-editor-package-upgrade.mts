// Real host + browser acceptance using only synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";

const root = await mkdtemp(join(tmpdir(), "doca-editor-upgrade-"));
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
    login: "editorupgrade",
    displayName: "Editor upgrade QA",
    password: "isolated-editor-upgrade-2026",
  },
  { bootstrap: true },
);
const origin = "http://127.0.0.1:39418";
const app = await createApp(db, {
  origin,
  storage: { ...storageRuntime(), root },
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 39418,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/editor-package-upgrade-2026-10-16",
);
await mkdir(output, { recursive: true });
const checks: string[] = [],
  errors: string[] = [];
const pass = (label: string) => {
  checks.push(label);
  console.log("PASS " + label);
};
const until = async (predicate: () => Promise<boolean>, label: string) => {
  for (let n = 0; n < 100; n++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
};
let diagnosticPage: Page | undefined;
await web.listen();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
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
  const preview = async (id: string) => {
    const data = await request(`/ai/resources/${id}/preview`);
    if (data.resource.format === "spreadsheet")
      data.value = await projectExlsxWorkbook({
        baseline: data.surface.baseline,
        update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
        checkpointSeq: 0,
      });
    const state = await db
      .selectFrom("document_states")
      .select("seq")
      .where("resource_id", "=", id)
      .executeTakeFirstOrThrow();
    return { ...data, seq: state.seq };
  };
  await request(
    "/auth/login",
    { login: "editorupgrade", password: "isolated-editor-upgrade-2026" },
    "POST",
  );
  const watch = async () => {
    const page = await context.newPage(),
      updates: unknown[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) =>
      socket.on("framesent", ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.type === "update") updates.push(frame);
        } catch {}
      }),
    );
    return { page, updates };
  };
  const rich = await request(
    "/resources",
    { title: "Native rotation QA", kind: "document", format: "rich_text" },
    "POST",
  );
  const a = await watch(),
    peer = await watch();
  diagnosticPage = a.page;
  await a.page.goto(origin + "/#/r/" + rich.id);
  await peer.page.goto(origin + "/#/r/" + rich.id);
  const editor = a.page.locator('.sk-editable[contenteditable="true"]');
  await editor.waitFor();
  await peer.page.locator(".sk-editable").waitFor();
  await a.page.bringToFront();
  await editor.click();
  await a.page.keyboard.press("End");
  await a.page.keyboard.press("Enter");
  const insert = a.page
    .locator(".editor-fixed-toolbar")
    .getByRole("button", { name: "流程图", exact: true });
  if (!(await insert.isVisible()))
    await a.page.locator(".toolbar-overflow > summary").click();
  await insert.click();
  await a.page.locator(".sk-block-flowchart img").waitFor();
  await peer.page.locator(".sk-block-flowchart img").waitFor();
  await a.page
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  await a.page
    .locator(".sk-block-flowchart")
    .getByRole("button", { name: "编辑流程图", exact: true })
    .click();
  const dialog = a.page.locator(".sk-diagram-dialog");
  await dialog.waitFor();
  const node = dialog.locator(".sk-x6-canvas .x6-node").first();
  await node.click();
  const nodeId = await node.getAttribute("data-cell-id");
  assert(nodeId);
  await dialog.getByRole("tab", { name: "排列", exact: true }).click();
  await dialog.getByLabel("旋转角度（°）", { exact: true }).fill("30");
  await dialog.getByLabel("旋转角度（°）", { exact: true }).press("Control+s");
  await a.page.screenshot({ path: join(output, "rotation-editor.png") });
  console.log("Saved a focused native rotation draft with Control+S");
  await a.page.bringToFront();
  await dialog.waitFor({ state: "hidden" });
  await until(
    async () =>
      (await preview(rich.id)).value.some(
        (block: any) =>
          block.type === "flowchart" &&
          block.nodes.some((n: any) => n.id === nodeId && n.angle === 30),
      ),
    "rotation commit",
  );
  await a.page
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  await peer.page.bringToFront();
  await peer.page
    .locator(".sk-block-flowchart")
    .getByRole("button", { name: "编辑流程图", exact: true })
    .click();
  const peerDialog = peer.page.locator(".sk-diagram-dialog");
  await peerDialog
    .locator(`.sk-x6-canvas .x6-node[data-cell-id="${nodeId}"]`)
    .click();
  await peerDialog.getByRole("tab", { name: "排列", exact: true }).click();
  assert.equal(
    await peerDialog.getByLabel("旋转角度（°）", { exact: true }).inputValue(),
    "30",
  );
  // Cancel closes view state without introducing a second diagram commit.
  await peerDialog
    .getByRole("button", { name: "关闭图示编辑器", exact: true })
    .click();
  await peerDialog.waitFor({ state: "detached" });
  assert.equal(peer.updates.length, 0, "Remote rotation echoed a write");
  pass(
    "native rotation persists through host ACK and reaches a same-user peer without echo",
  );
  await a.page.bringToFront();
  await a.page.reload();
  await editor.waitFor();
  await a.page
    .locator(".sk-block-flowchart")
    .getByRole("button", { name: "编辑流程图", exact: true })
    .click();
  await dialog
    .locator(`.sk-x6-canvas .x6-node[data-cell-id="${nodeId}"]`)
    .click();
  await dialog.getByRole("tab", { name: "排列", exact: true }).click();
  assert.equal(
    await dialog.getByLabel("旋转角度（°）", { exact: true }).inputValue(),
    "30",
  );
  const paperWidth = await dialog
    .locator(".sk-draw-paper")
    .evaluate((el) => el.getBoundingClientRect().width);
  await dialog.getByLabel("左", { exact: true }).fill("2000");
  await dialog.getByLabel("左", { exact: true }).press("Enter");
  await until(
    async () =>
      (await dialog
        .locator(".sk-draw-paper")
        .evaluate((el) => el.getBoundingClientRect().width)) > paperWidth,
    "native paper expands with moved node",
  );
  await dialog.getByLabel("旋转角度（°）", { exact: true }).fill("45");
  await dialog.getByLabel("旋转角度（°）", { exact: true }).press("Meta+s");
  await dialog.waitFor({ state: "detached" });
  await until(
    async () =>
      (await preview(rich.id)).value.some(
        (block: any) =>
          block.type === "flowchart" &&
          block.nodes.some(
            (n: any) => n.id === nodeId && n.angle === 45 && n.x === 2000,
          ),
      ),
    "Meta+S commits the focused draft",
  );
  pass(
    "reload retains rotation; native paper expands and Meta+S commits focused drafts",
  );

  await editor.locator(".sk-block-paragraph").last().click();
  await a.page.keyboard.press("End");
  await a.page.keyboard.press("Enter");
  const image = await sharp({
    create: { width: 160, height: 90, channels: 3, background: "#3b82f6" },
  })
    .png()
    .toBuffer();
  await a.page
    .locator('.editor-fixed-toolbar input[type="file"]')
    .setInputFiles({
      name: "isolated-image.png",
      mimeType: "image/png",
      buffer: image,
    });
  await a.page.locator(".sk-image img").waitFor();
  await until(
    async () =>
      (await preview(rich.id)).value.some(
        (block: any) => block.type === "image" && block.path,
      ),
    "image upload",
  );
  await a.page
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  const figure = a.page.locator(".sk-image");
  await editor.locator(".sk-block-paragraph").first().click();
  await figure.locator("img").click();
  assert.equal(await a.page.locator(".sk-media-lightbox").count(), 0);
  await figure.locator("img").click();
  await a.page.locator(".sk-media-lightbox").waitFor();
  await a.page.keyboard.press("Escape");
  await a.page.locator(".sk-media-lightbox").waitFor({ state: "detached" });
  await editor.locator(".sk-block-paragraph").first().click();
  await figure.locator("img").click();
  assert.equal(await a.page.locator(".sk-media-lightbox").count(), 0);
  pass(
    "host-authorized image selects first, previews second and resets selection after an outside click",
  );
  await a.page.screenshot({ path: join(output, "rich-host.png") });

  const sheet = await request(
    "/resources",
    { title: "Select-all QA", kind: "document", format: "spreadsheet" },
    "POST",
  );
  const s = await watch();
  diagnosticPage = s.page;
  await s.page.goto(origin + "/#/r/" + sheet.id);
  const corner = s.page.locator(".uos-editor__select-all");
  await corner.waitFor();
  const original = await preview(sheet.id),
    first = original.value.sheetOrder[0];
  assert.equal(original.value.sheets[first].defaultRowHeight, 19.8);
  assert.equal(original.value.sheets[first].defaultColumnWidth, 79.2);
  const box = await corner.boundingBox();
  assert(box);
  await s.page.mouse.dblclick(box.x + box.width + 36, box.y + box.height + 9);
  await s.page.keyboard.insertText("表格升级验收");
  await s.page.keyboard.press("Enter");
  await until(
    async () =>
      JSON.stringify(
        (await preview(sheet.id)).value.sheets[first].cellData,
      ).includes("表格升级验收"),
    "native cell edit",
  );
  await s.page
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  const sheetBefore = await preview(sheet.id),
    sheetWrites = s.updates.length;
  await corner.click();
  // A huge ALL selection would stall this interaction/statistics pass.
  await s.page
    .getByRole("combobox", { name: "文档模式", exact: true })
    .click({ timeout: 5000 });
  await s.page.getByRole("option", { name: "阅读", exact: true }).click();
  await corner.click();
  await s.page.setViewportSize({ width: 1440, height: 900 });
  await s.page.screenshot({
    path: join(output, "sheet-readonly-select-all.png"),
  });
  await s.page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await s.page.getByRole("option", { name: "编辑", exact: true }).click();
  assert.deepEqual((await preview(sheet.id)).value, sheetBefore.value);
  assert.equal(s.updates.length, sheetWrites);
  pass(
    "native select-all remains responsive in edit/readonly mode and keeps worksheet content unchanged",
  );
  await s.page.reload();
  await corner.waitFor();
  assert.deepEqual((await preview(sheet.id)).value, sheetBefore.value);
  pass("new 19.8/79.2 dimensions and edited cells survive host reload");
  const richBefore = await preview(rich.id),
    idleSheet = await preview(sheet.id);
  const counts = [a.updates.length, peer.updates.length, s.updates.length];
  await corner.click();
  await a.page.locator(".sk-diagram-figure").click();
  for (let n = 0; n < 2; n++) {
    await delay(30_000);
    console.log("Idle observation " + (n + 1) * 30 + " seconds");
  }
  assert.deepEqual(
    [a.updates.length, peer.updates.length, s.updates.length],
    counts,
  );
  assert.equal((await preview(rich.id)).seq, richBefore.seq);
  assert.equal((await preview(sheet.id)).seq, idleSheet.seq);
  assert.deepEqual(errors, []);
  pass(
    "60 seconds of idle, selection and resize produces zero rich-text/spreadsheet writes or peer echo",
  );
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      { result: "passed", checks, errors, idleSeconds: 60 },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  await diagnosticPage
    ?.screenshot({ path: join(output, "browser-failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      { result: "failed", checks, errors, failure: String(error) },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
