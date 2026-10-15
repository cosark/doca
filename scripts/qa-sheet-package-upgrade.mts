// Real host + browser acceptance using only synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";

const root = await mkdtemp(join(tmpdir(), "doca-sheet-upgrade-"));
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
const origin = "http://127.0.0.1:39420";
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
    port: 39420,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve("artifacts/sheet-upgrade-2026-10-15");
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
  const sheet = await request(
    "/resources",
    {
      title: "Sheet 0.2.2 hyperlink QA",
      kind: "document",
      format: "spreadsheet",
    },
    "POST",
  );
  const a = await watch(),
    peer = await watch();
  diagnosticPage = a.page;
  for (const tab of [a, peer]) {
    await tab.page.goto(origin + "/#/r/" + sheet.id);
    await tab.page.locator(".uos-editor__select-all").waitFor();
    await tab.page
      .getByText("已保存到云端", { exact: true })
      .waitFor({ state: "attached" });
  }
  const select = async (cell = "A1") => {
    const name = a.page
      .locator(".uos-editor")
      .getByRole("textbox", { exact: true });
    await name.fill(cell);
    await name.press("Enter");
  };
  const button = (name: string) =>
    a.page.getByRole("button", { name, exact: true });
  const linkDialog = () =>
    a.page.getByRole("dialog", { name: "插入超链接", exact: true });
  const openLink = async () => {
    await button("插入").click();
    await a.page.getByRole("menuitem", { name: "超链接", exact: true }).click();
    await linkDialog()
      .getByRole("button", { name: "取消", exact: true })
      .waitFor();
  };
  await a.page.bringToFront();
  const initial = await preview(sheet.id),
    writes = a.updates.length;
  for (const method of ["cancel", "close", "escape", "outside"]) {
    await select();
    await openLink();
    await a.page
      .getByRole("textbox", { name: "链接显示文字", exact: true })
      .fill("不得保存的草稿");
    await a.page
      .getByRole("textbox", { name: "链接地址", exact: true })
      .fill("https://example.com/cancel");
    if (method === "cancel") await button("取消").click();
    else if (method === "close") await button("关闭工具栏菜单").click();
    else if (method === "escape")
      await a.page
        .getByRole("textbox", { name: "链接地址", exact: true })
        .press("Escape");
    else await a.page.locator(".document-title-edit").click();
    await linkDialog().waitFor({ state: "hidden" });
    await a.page.keyboard.press("Escape");
    await select("A2");
    assert.deepEqual((await preview(sheet.id)).value, initial.value);
    assert.equal(a.updates.length, writes);
    assert.equal(peer.updates.length, 0);
    pass(
      method +
        " closes the hyperlink dialog without a content write or peer echo",
    );
  }
  await select();
  await openLink();
  await a.page
    .getByRole("textbox", { name: "链接显示文字", exact: true })
    .fill("验收链接");
  await a.page
    .getByRole("textbox", { name: "链接地址", exact: true })
    .fill("https://example.com/qa");
  await button("插入链接").click();
  await a.page.keyboard.press("Enter");
  await until(
    async () =>
      JSON.stringify((await preview(sheet.id)).value).includes(
        "https://example.com/qa",
      ),
    "hyperlink durable save",
  );
  await a.page
    .getByText("已保存到云端", { exact: true })
    .waitFor({ state: "attached" });
  const linked = await preview(sheet.id);
  assert.equal(peer.updates.length, 0);
  pass(
    "confirmed hyperlink saves through the host durable ACK without remote echo",
  );
  await button("撤销").click();
  await until(
    async () =>
      !JSON.stringify((await preview(sheet.id)).value).includes(
        "https://example.com/qa",
      ),
    "hyperlink undo",
  );
  await button("重做").click();
  await until(
    async () =>
      JSON.stringify((await preview(sheet.id)).value).includes(
        "https://example.com/qa",
      ),
    "hyperlink redo",
  );
  pass("hyperlink insertion supports native undo and redo");
  await a.page.reload();
  await a.page.locator(".uos-editor__select-all").waitFor();
  assert.deepEqual((await preview(sheet.id)).value, linked.value);
  pass("saved hyperlink survives host reload");
  await a.page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await a.page.getByRole("option", { name: "阅读", exact: true }).click();
  assert(
    (await button("插入").count()) === 0 ||
      (await button("插入").isDisabled()),
  );
  const idle = await preview(sheet.id),
    counts = [a.updates.length, peer.updates.length];
  await a.page.locator(".uos-editor__select-all").click();
  await a.page.setViewportSize({ width: 1280, height: 900 });
  await a.page.screenshot({ path: join(output, "sheet-readonly.png") });
  for (let n = 0; n < 2; n++) {
    await delay(30_000);
    console.log("Idle observation " + (n + 1) * 30 + " seconds");
  }
  assert.equal((await preview(sheet.id)).seq, idle.seq);
  assert.deepEqual([a.updates.length, peer.updates.length], counts);
  assert.deepEqual(errors, []);
  pass(
    "readonly, selection, resize and 60 seconds idle produce zero content updates",
  );
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      {
        result: "passed",
        sheetVersion: "0.2.2",
        checks,
        errors,
        idleSeconds: 60,
      },
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
