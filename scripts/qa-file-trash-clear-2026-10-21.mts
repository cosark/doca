// Actual Doca + file-trash-clear UI, with an isolated account/database/store.
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
const root = await mkdtemp(join(tmpdir(), "doca-file-trash-clear-"));
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
    login: "filetrashqa",
    displayName: "Trash QA user",
    password: "isolated-file-trash-2026",
  },
  { bootstrap: true },
);
await createUser(
  db,
  {
    login: "filetrashother",
    displayName: "Other Trash QA",
    password: "isolated-file-trash-2026",
  },
  { actor: { ...owner, admin: 1 } },
);
const origin = "http://127.0.0.1:39445";
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
    port: 39445,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/verification/issue-tracker-2026-10-21/file-trash-browser",
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
    { login: "filetrashqa", password: "isolated-file-trash-2026" },
    "POST",
  );

  const upload = async (name: string, parentId?: string, ctx = context) => {
    const response = await ctx.request.post(
      origin +
        `/api/v1/files/items?filename=${encodeURIComponent(name)}${parentId ? `&parentType=folder&parentId=${parentId}` : ""}`,
      {
        headers: { origin, "content-type": "application/octet-stream" },
        data: Buffer.from("isolated " + name),
      },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const outer = await request(
      "/files/folders",
      { name: "Trash outer QA", parentId: null },
      "POST",
    ),
    inner = await request(
      "/files/folders",
      { name: "Trash inner QA", parentId: outer.id },
      "POST",
    );
  const outerFile = await upload("outer.txt", outer.id),
    innerFile = await upload("inner.txt", inner.id),
    restored = await upload("restore-during-confirm.txt"),
    active = await upload("active-kept.txt");
  await request(`/files/folders/${outer.id}`, { version: 1 }, "DELETE");
  await request(`/files/items/${restored.id}`, { version: 1 }, "DELETE");
  const other = await browser.newContext();
  const otherResponse = await other.request.post(
    origin + "/api/v1/auth/login",
    {
      headers: { origin },
      data: { login: "filetrashother", password: "isolated-file-trash-2026" },
    },
  );
  assert.equal(otherResponse.status(), 200);
  const foreign = await upload("foreign-trash.txt", undefined, other);
  const foreignDeleted = await other.request.delete(
    origin + `/api/v1/files/items/${foreign.id}`,
    { headers: { origin }, data: { version: 1 } },
  );
  assert.equal(foreignDeleted.status(), 200);
  const doc = await request(
    "/resources",
    {
      title: "Document trash must remain QA",
      kind: "document",
      format: "rich_text",
    },
    "POST",
  );
  await request(`/resources/${doc.id}/trash`, { version: doc.version }, "POST");
  const initial = await request("/files/trash");
  assert.equal(initial.files.length, 3);
  assert.equal(initial.folders.length, 2);
  const snapshot = async () => ({
    files: await db
      .selectFrom("file_items")
      .selectAll()
      .orderBy("id")
      .execute(),
    folders: await db
      .selectFrom("file_folders")
      .selectAll()
      .orderBy("id")
      .execute(),
    doc: await db
      .selectFrom("resources")
      .selectAll()
      .where("id", "=", doc.id)
      .executeTakeFirstOrThrow(),
  });
  const before = await snapshot();
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/#/trash");
  const section = page.locator(".file-trash-section"),
    button = section.getByRole("button", {
      name: "清空文件回收站",
      exact: true,
    });
  await until(
    async () => (await section.locator(".file-trash-list > div").count()) === 5,
    "files and two nested folders listed",
  );
  await page
    .getByText("Document trash must remain QA", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "initial-trash.png") });
  const dialog = page.getByRole("dialog", {
    name: "清空文件回收站",
    exact: true,
  });
  await button.click();
  await dialog.waitFor();
  assert(
    (await dialog.locator(".warning").textContent())?.includes(
      "3 个文件和 2 个文件夹",
    ),
  );
  await page.screenshot({ path: join(output, "clear-confirmation.png") });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(await snapshot(), before);
  pass(
    "file clear confirmation covers all three files and both nested folders; Cancel preserves every row and the document trash",
  );
  await button.click();
  await dialog.waitFor();
  const restoreEntry = initial.files.find(
    (file: { id: string }) => file.id === restored.id,
  );
  assert(restoreEntry);
  await request(
    "/files/trash/restore",
    { kind: "file", id: restored.id, version: restoreEntry.version },
    "POST",
  );
  const afterRestore = await snapshot();
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/files/trash/clear") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "永久清空", exact: true }).click();
  const stale = await staleResponse;
  assert.equal(stale.status(), 409);
  const staleBody = await stale.text();
  assert.equal(
    JSON.parse(JSON.parse(staleBody).message).code,
    "file_trash_changed",
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "文件回收站已变化" })
    .waitFor();
  await until(
    async () => (await section.locator(".file-trash-list > div").count()) === 4,
    "stale confirmation refreshes remaining trash",
  );
  assert.deepEqual(await snapshot(), afterRestore);
  await page.screenshot({
    path: join(output, "stale-confirmation-rejected.png"),
  });
  pass(
    "restoring an item while confirmation is open makes the fingerprint stale: real UI receives 409 and shows the error with no partial purge",
  );
  await button.click();
  await dialog.waitFor();
  assert(
    (await dialog.locator(".warning").textContent())?.includes(
      "2 个文件和 2 个文件夹",
    ),
  );
  const clearResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/files/trash/clear") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "永久清空", exact: true }).click();
  const clear = await clearResponse;
  assert.equal(clear.status(), 200);
  assert.deepEqual(await clear.json(), {
    ok: true,
    fileCount: 2,
    folderCount: 2,
  });
  await section.locator(".file-trash-empty").waitFor();
  assert.equal(await button.isDisabled(), true);
  const after = await snapshot();
  assert.deepEqual(
    after.files.map((file) => file.id).sort(),
    [active.id, restored.id, foreign.id].sort(),
  );
  assert.equal(after.folders.length, 0);
  assert.deepEqual(after.doc, before.doc);
  assert(after.doc.deleted_at);
  for (const file of after.files) {
    const retained = afterRestore.files.find((row) => row.id === file.id);
    assert.deepEqual(file, retained);
  }
  await page
    .getByText("Document trash must remain QA", { exact: true })
    .waitFor();
  const content = await context.request.get(
    origin + `/api/v1/files/items/${active.id}/content`,
  );
  assert.equal(content.status(), 200);
  const restoredContent = await context.request.get(
    origin + `/api/v1/files/items/${restored.id}/content`,
  );
  assert.equal(restoredContent.status(), 200);
  const foreignTrash = await other.request.get(origin + "/api/v1/files/trash");
  assert.deepEqual(
    (await foreignTrash.json()).files.map((file: { id: string }) => file.id),
    [foreign.id],
  );
  await page.screenshot({
    path: join(output, "files-cleared-document-kept.png"),
  });
  pass(
    "a new confirmation clears every remaining file and nested folder while active/restored files, other-account trash and the independent document trash remain intact",
  );

  // Reproduce the adjacent single-folder purge path through its public UI.
  // A child can be restored while its parent remains in the recycle bin.
  const guardedFolder = await request(
    "/files/folders", { name: "Single folder purge QA", parentId: null }, "POST",
  );
  const guardedChild = await upload("single-folder-restored.txt", guardedFolder.id);
  await request(`/files/folders/${guardedFolder.id}`, { version: 1 }, "DELETE");
  const guardedTrash = await request("/files/trash");
  const guardedEntry = guardedTrash.files.find((file: { id: string }) => file.id === guardedChild.id);
  assert(guardedEntry);
  await request("/files/trash/restore", { kind: "file", id: guardedChild.id, version: guardedEntry.version }, "POST");
  await page.reload();
  const singleButton = section.getByRole("button", { name: "永久删除Single folder purge QA", exact: true });
  await singleButton.waitFor();
  const guardedBefore = await snapshot();
  const singleDialog = page.getByRole("dialog", { name: "永久删除", exact: true });
  await singleButton.click();
  await singleDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(await snapshot(), guardedBefore);
  await singleButton.click();
  const refusedPurge = page.waitForResponse(response => response.url().endsWith("/api/v1/files/trash/purge") && response.request().method() === "POST");
  await singleDialog.getByRole("button", { name: "永久删除", exact: true }).click();
  const refused = await refusedPurge;
  assert.equal(refused.status(), 409, await refused.text());
  await page.getByRole("alert").filter({ hasText: "仍有未删除或其他用户的内容" }).waitFor();
  assert.deepEqual(await snapshot(), guardedBefore);
  await page.screenshot({ path: join(output, "single-folder-restored-child-protected.png") });
  pass("single-folder permanent-delete Cancel preserves all rows; confirming a folder with a restored child returns 409 in the real UI without any partial deletion");

  const currentFolder = guardedBefore.folders.find(folder => folder.id === guardedFolder.id);
  assert(currentFolder?.deleted_at);
  await request("/files/trash/restore", { kind: "folder", id: guardedFolder.id, version: currentFolder.version }, "POST");
  await request(`/files/folders/${guardedFolder.id}`, { version: currentFolder.version + 1 }, "DELETE");
  await page.reload();
  await singleButton.click();
  const acceptedPurge = page.waitForResponse(response => response.url().endsWith("/api/v1/files/trash/purge") && response.request().method() === "POST");
  await singleDialog.getByRole("button", { name: "永久删除", exact: true }).click();
  assert.equal((await acceptedPurge).status(), 200);
  await section.locator(".file-trash-empty").waitFor();
  assert.deepEqual(await snapshot(), after);
  await page.screenshot({ path: join(output, "single-folder-purge-completed.png") });
  pass("after the parent is restored and its whole folder is explicitly trashed again, the same single-folder UI purges only that deleted folder and child, preserving all previously retained rows");
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        checks,
        errors,
        staleStatus: stale.status(),
        staleBody,
        clearedFileIds: [outerFile.id, innerFile.id],
        clearedFolderIds: [outer.id, inner.id],
        retainedDocumentId: doc.id,
      },
      null,
      2,
    ),
  );
  await rm(join(output, "failure.png"), { force: true });
  await rm(join(output, "failure.txt"), { force: true });
  await other.close();
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  await writeFile(join(output, "failure.txt"), String(error));
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
