// Actual Doca + shipped Sheet artifact, with an isolated account/database/store.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
const root = await mkdtemp(join(tmpdir(), "doca-sheet-history-warning-"));
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
const origin = "http://127.0.0.1:39443";
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
    port: 39443,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/verification/issue-tracker-2026-10-21/sheet-history-warning",
);
await mkdir(output, { recursive: true });
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [],
  errors: string[] = [];
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

  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __sheetConsoleErrors?: Array<{ message: string; stack?: string }>;
    };
    w.__sheetConsoleErrors = [];
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      w.__sheetConsoleErrors!.push({
        message: args.map(String).join(" "),
        stack: new Error("console.error call").stack,
      });
      original(...args);
    };
  });
  const seq = async () =>
    (
      await db
        .selectFrom("document_states")
        .select("seq")
        .where("resource_id", "=", sheet.id)
        .executeTakeFirstOrThrow()
    ).seq;
  await page.goto(origin + "/#/r/" + sheet.id);
  await page.locator(".uos-editor__select-all").waitFor();
  await page
    .getByText(/(?:^| · )已保存到云端$/)
    .last()
    .waitFor({ state: "attached" });
  const before = await seq();
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
  await history.locator(".uos-editor__select-all").waitFor();
  await delay(300);
  await history
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await delay(300);
  await records
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  await delay(300);
  const consoleErrors = await page.evaluate(
    () =>
      (window as typeof window & { __sheetConsoleErrors?: unknown[] })
        .__sheetConsoleErrors ?? [],
  );
  assert.equal(await seq(), before);
  assert.deepEqual(errors, []);
  const result = {
    steps: [
      "create empty spreadsheet in isolated Doca",
      "open history and save current snapshot",
      "view snapshot and wait for native editor",
      "close snapshot and history",
    ],
    checks: ["no collaborative content writes; no page exceptions"],
    consoleErrors,
    errors,
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
