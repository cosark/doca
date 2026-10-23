// Synthetic documents and an isolated in-memory database; never user content.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { createEditorDocument } from "@smartdoca/slate/headless";
import { openTestDatabase } from "../tests/database.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { restoreDocument } from "../packages/core/src/modules/collaboration/documents.js";
import { restoreMarkdown } from "../packages/core/src/modules/documents/codecs/markdown.js";

const output = resolve(
  process.argv[2] ?? "artifacts/verification/document-title",
);
assert(output.startsWith(resolve("artifacts") + "/"));
const runtime = join(output, "runtime");
await mkdir(runtime, { recursive: true });
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: runtime } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
await createUser(
  db,
  {
    login: "title-qa",
    displayName: "标题验收",
    password: "isolated-title-2026",
  },
  { bootstrap: true },
);
const origin = "http://127.0.0.1:39789";
const app = await createApp(db, {
  origin,
  storage: storageRuntime(),
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: 0 });
const apiAddress = app.server.address();
assert(apiAddress && typeof apiAddress !== "string");
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 39789,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiAddress.port}`, ws: true },
    },
  },
});
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [],
  errors: string[] = [];
let diagnosticPage: Page | undefined;
const pass = (message: string) => {
  checks.push(message);
  console.log("PASS " + message);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
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
    { login: "title-qa", password: "isolated-title-2026" },
    "POST",
  );
  for (const format of ["rich_text", "markdown"] as const) {
    const resource = await request(
      "/resources",
      {
        kind: "document",
        format,
        title: "原始标题",
        ...(format === "markdown"
          ? { markdown: "## 原始标题\n\n正文 **保留加粗**。" }
          : {
              initialContent: createEditorDocument([
                {
                  id: randomUUID(),
                  type: "paragraph",
                  title: "h1",
                  align: "center",
                  lineHeight: 1.8,
                  children: [
                    {
                      text: "原始标题",
                      bold: true,
                      italic: true,
                      fontSize: 32,
                      color: "#c2410c",
                      fontFamily: "serif",
                    },
                  ],
                },
                {
                  id: randomUUID(),
                  type: "paragraph",
                  children: [{ text: "正文保留。", bold: true }],
                },
              ]),
            }),
      },
      "POST",
    );
    const pages = [await context.newPage(), await context.newPage()] as const;
    diagnosticPage = pages[0];
    const frames: unknown[] = [];
    for (const page of pages) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("websocket", (socket) =>
        socket.on("framesent", ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            if (message.type === "update") frames.push(message);
          } catch {}
        }),
      );
      await page.goto(`${origin}/#/r/${resource.id}`);
      await page.locator(".document-title-edit").waitFor();
      await page
        .locator(
          format === "rich_text" ? '[data-slate-editor="true"]' : ".cm-content",
        )
        .first()
        .waitFor();
    }
    const [page, peer] = pages;
    const snapshot = async () => {
      if (format === "markdown") {
        const loaded = await restoreMarkdown(db, resource.id);
        try {
          return {
            content: loaded.doc.getText("markdown").toString(),
            seq: loaded.state!.seq,
          };
        } finally {
          loaded.destroy();
        }
      }
      const loaded = await restoreDocument(db, resource.id);
      try {
        return { content: loaded.runtime.getValue(), seq: loaded.state!.seq };
      } finally {
        loaded.destroy();
      }
    };
    const visualStyle = () =>
      page
        .locator('[data-slate-editor="true"]')
        .first()
        .evaluate((editor) => {
          const block = editor.querySelector<HTMLElement>(
            '[data-slate-node="element"]',
          )!;
          const leaf = block.querySelector<HTMLElement>("[data-slate-string]")!;
          const b = getComputedStyle(block),
            t = getComputedStyle(leaf);
          return {
            tag: block.tagName,
            align: b.textAlign,
            lineHeight: b.lineHeight,
            font: t.fontFamily,
            size: t.fontSize,
            color: t.color,
            weight: t.fontWeight,
            italic: t.fontStyle,
          };
        });
    const before = await snapshot();
    const styleBefore = format === "rich_text" ? await visualStyle() : null;
    await page.screenshot({ path: join(output, `${format}-before.png`) });
    await page.locator(".document-title-edit").click();
    const input = page.getByRole("textbox", {
      name: "修改文档标题",
      exact: true,
    });
    await input.fill("更新后的文档标题");
    await page.locator(".title-icon-picker > summary").click();
    await page.getByRole("button", { name: "🚀", exact: true }).click();
    assert.equal(await input.inputValue(), "更新后的文档标题");
    await page.screenshot({ path: join(output, `${format}-editing.png`) });
    await input.press("Enter");
    for (const current of pages) {
      await current
        .locator(".document-title-edit")
        .filter({ hasText: "🚀 更新后的文档标题" })
        .waitFor();
      await current.waitForFunction((kind) => {
        const editor = document.querySelector(
          kind === "rich_text" ? '[data-slate-editor="true"]' : ".cm-content",
        );
        return editor?.textContent?.includes("🚀 更新后的文档标题");
      }, format);
    }
    const after = await snapshot();
    assert.equal(after.seq, before.seq + 1);
    if (format === "rich_text") {
      const original = before.content as any[],
        current = after.content as any[];
      assert.deepEqual(current, [
        {
          ...original[0],
          children: [
            { ...original[0].children[0], text: "🚀 更新后的文档标题" },
          ],
        },
        ...original.slice(1),
      ]);
      assert.deepEqual(await visualStyle(), styleBefore);
    } else
      assert.equal(
        after.content,
        "## 🚀 更新后的文档标题\n\n正文 **保留加粗**。",
      );
    pass(
      `${format}: click, name/icon edit, Enter save, same-user peer sync, unchanged heading/body style`,
    );
    await page.screenshot({ path: join(output, `${format}-after.png`) });
    await page.locator(".document-title-edit").click();
    await input.fill("取消的草稿");
    await input.press("Escape");
    assert.deepEqual(await snapshot(), after);
    pass(`${format}: Escape cancels without content writes`);
    await page.locator(".document-title-edit").click();
    await input.fill("失败后保留草稿");
    const patchUrl = `${origin}/api/v1/resources/${resource.id}`;
    await page.route(patchUrl, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ message: "验收保存失败" }),
          })
        : route.continue(),
    );
    await input.press("Enter");
    await page.getByText("验收保存失败", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "失败后保留草稿");
    assert.deepEqual(await snapshot(), after);
    await page.unroute(patchUrl);
    await input.fill("失焦保存标题");
    await page
      .locator(".document-topbar-actions")
      .click({ position: { x: 2, y: 2 } });
    await page
      .locator(".document-title-edit")
      .filter({ hasText: "🚀 失焦保存标题" })
      .waitFor();
    pass(`${format}: save failure retains draft, blur retry saves`);
    await page.reload();
    await page
      .locator(".document-title-edit")
      .filter({ hasText: "🚀 失焦保存标题" })
      .waitFor();
    await page
      .locator(
        format === "rich_text" ? '[data-slate-editor="true"]' : ".cm-content",
      )
      .first()
      .waitFor();
    if (format === "rich_text")
      assert.deepEqual(await visualStyle(), styleBefore);
    await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
    await page.getByRole("option", { name: "阅读", exact: true }).click();
    await page.locator(".document-title-edit").waitFor({ state: "detached" });
    pass(
      `${format}: refresh preserves title/style; reading mode disables title edits`,
    );
    // Editing a header must never echo its server-side content change into an outbox.
    assert.equal(
      frames.length,
      0,
      `${format}: unexpected local content update`,
    );
    for (const current of pages) await current.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed())
    await diagnosticPage
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  await web.close();
  await app.close();
  await db.destroy();
  await rm(runtime, { recursive: true, force: true });
}
