// Synthetic library/documents in an isolated database; never opens user documents.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";

const root = await mkdtemp(join(tmpdir(), "doca-tree-qa-"));
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
    login: "treeqa",
    displayName: "目录验收",
    password: "isolated-tree-qa-2026",
  },
  { bootstrap: true },
);
const origin = "http://127.0.0.1:39422";
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
    port: 39422,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/document-tree-2026-10-16",
);
await mkdir(output, { recursive: true });
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [],
  errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const request = async (path: string, data?: unknown) => {
    const response = await context.request.fetch(origin + "/api/v1" + path, {
      method: data ? "POST" : "GET",
      headers: { origin },
      data,
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await request("/auth/login", {
    login: "treeqa",
    password: "isolated-tree-qa-2026",
  });
  const library = await request("/resources", {
    title: "轻量告警系统",
    kind: "library",
    format: "rich_text",
  });
  const parent = await request("/resources", {
    title: "功能设计",
    kind: "document",
    format: "rich_text",
    libraryId: library.id,
  });
  const child = await request("/resources", {
    title: "功能讨论",
    kind: "document",
    format: "rich_text",
    libraryId: library.id,
    parentId: parent.id,
  });
  const sibling = await request("/resources", {
    title: "新需求",
    kind: "document",
    format: "spreadsheet",
    libraryId: library.id,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const row = (id: string) =>
    page.locator(`.sidebar .tree-row[data-resource-id="${id}"]`);
  const selected = async (id: string) => {
    await row(id).locator('.tree-link[aria-current="page"]').waitFor();
    assert.equal(await page.locator(".sidebar .tree-row.selected").count(), 1);
    assert.equal(
      await row(id).evaluate((el) => el.classList.contains("selected")),
      true,
    );
    const colors = await row(id).evaluate((el) => {
      const style = getComputedStyle(el),
        sidebar = getComputedStyle(el.closest(".sidebar")!);
      return {
        selected: style.backgroundColor,
        sidebar: sidebar.backgroundColor,
        marker: style.boxShadow,
      };
    });
    const rgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number);
    const a = rgb(colors.selected),
      b = rgb(colors.sidebar);
    assert(
      a.reduce((n, x, i) => n + Math.abs(x - b[i]!), 0) >= 20,
      "Current row must be visibly distinct from the sidebar",
    );
    assert.equal(colors.marker, "none", "Current row has no vertical marker");
  };
  await page.goto(origin + "/#/r/" + library.id);
  await row(parent.id).locator(".tree-link").click();
  await selected(parent.id);
  checks.push("clicking a parent document highlights exactly its row");
  await row(child.id).locator(".tree-link").click();
  await selected(child.id);
  await page.locator('.sk-editor [contenteditable="true"]').waitFor();
  await page.mouse.move(1200, 700);
  await selected(child.id);
  checks.push("nested document stays highlighted after the pointer leaves");
  await page.screenshot({ path: join(output, "selected-nested.png") });
  await page.reload();
  await selected(child.id);
  checks.push(
    "refresh expands ancestors and restores the current document highlight",
  );
  await row(sibling.id).locator(".tree-link").click();
  await selected(sibling.id);
  await page.locator(".uos-editor__select-all").waitFor();
  checks.push(
    "switching document types moves the highlight to the spreadsheet only",
  );
  await page.goBack();
  await selected(child.id);
  checks.push("browser back restores the previous document highlight");
  await row(child.id).hover();
  await selected(child.id);
  checks.push("hover keeps the selected background without a vertical marker");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const sidebar = await page.locator(".sidebar").boundingBox();
  assert(sidebar);
  await page.screenshot({
    path: join(output, "selected-sidebar-200.png"),
    clip: { ...sidebar, height: Math.min(sidebar.height, 900 - sidebar.y) },
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  assert.deepEqual(errors, []);
  checks.push("no uncaught browser errors");
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        result: "passed",
        checks,
        errors,
        screenshots: ["selected-nested.png", "selected-sidebar-200.png"],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ result: "passed", checks: checks.length, output }),
  );
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
