// Real host + browser acceptance using only synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import {
  createDocuments,
  restoreDocument,
  b64,
} from "../packages/core/src/modules/collaboration/documents.js";
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
const origin = "http://127.0.0.1:39428";
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
    port: 39428,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/three-editor-upgrade-2026-10-17/slides-native",
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
    if (data.resource.format === "canvas") {
      const { CanvasModel } = await import("@smartdoca/canvas/model");
      const model = CanvasModel.restore({
        codec: "aidcanvas-yjs",
        schemaVersion: 1,
        epochId: data.surface.epochId,
        update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
      });
      try {
        data.value = model.getValue();
      } finally {
        model.dispose();
      }
    }
    if (data.resource.format === "presentation") {
      const Y = await import("yjs"),
        { readDocument } = await import("@smartdoca/slides/core");
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(
          doc,
          new Uint8Array(Buffer.from(data.surface.update, "base64")),
        );
        data.value = readDocument(doc);
      } finally {
        doc.destroy();
      }
    }
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
      updates: any[] = [],
      received: any[] = [];
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        try {
          received.push(JSON.parse(String(payload)));
        } catch {}
      });
      socket.on("framesent", ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.type === "update") updates.push(frame);
        } catch {}
      });
    });
    return { page, updates, received };
  };
  const create = (format: string) =>
    request(
      "/resources",
      { title: `2026-10-17 ${format} QA`, kind: "document", format },
      "POST",
    );
  const saved = async (page: Page) =>
    page
      .getByText(/(?:^| · )已保存到云端$/)
      .last()
      .waitFor({ state: "attached" });
  const open = async (id: string, selector: string) => {
    const watched = await watch();
    diagnosticPage = watched.page;
    await watched.page.goto(origin + "/#/r/" + id);
    await watched.page.locator(selector).waitFor();
    return watched;
  };
  const mode = async (page: Page, name: string) => {
    await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const pasteFile = async (page: Page, selector: string, image = false) => {
    await page.locator(selector).evaluate(async (element, image) => {
      const data = new DataTransfer();
      let file: File;
      if (image) {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 32;
        canvas.getContext("2d")!.fillRect(0, 0, 48, 32);
        file = new File(
          [
            await new Promise<Blob>((resolve) =>
              canvas.toBlob((b) => resolve(b!)),
            ),
          ],
          "qa.png",
          { type: "image/png" },
        );
      } else
        file = new File(["Isolated canvas attachment 画布附件"], "qa.txt", {
          type: "text/plain",
        });
      data.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, image);
  };
  const resource = await create("presentation");
  const p = await open(resource.id, ".eppt-workspace");
  await p.page.bringToFront();
  const current = async () => (await preview(resource.id)).value;
  const original = await current(),
    slideId = original.slideOrder[0],
    text = Object.values(original.slides[slideId].elements).find(
      (e: any) => e.type === "text",
    ) as any;
  const select = async (element: any) => {
    const box = await p.page.locator(".eppt-slide").first().boundingBox();
    assert(box);
    const scale = box.width / original.size.width;
    await p.page.mouse.click(
      box.x + (element.transform.x + element.transform.width / 2) * scale,
      box.y + (element.transform.y + element.transform.height / 2) * scale,
    );
  };
  await select(text);
  const floating = p.page.locator(".eppt-context-toolbar");
  await floating.waitFor();
  await floating.getByRole("button", { name: "标题样式", exact: true }).click();
  await p.page
    .getByRole("menuitemradio", { name: "大标题", exact: true })
    .click();
  await floating.getByRole("button", { name: "字体", exact: true }).click();
  await p.page.getByLabel("搜索字体", { exact: true }).fill("Georgia");
  await p.page
    .getByRole("menuitemradio", { name: "Georgia", exact: true })
    .click();
  await p.page
    .locator(".eppt-insert-actions")
    .getByRole("button", { name: "格式", exact: true })
    .click();
  const spacing = p.page.getByLabel("字间距（磅）", { exact: true });
  await spacing.fill("2");
  await spacing.press("Enter");
  const inset = p.page.getByLabel("左边距", { exact: true });
  await inset.fill("18");
  await inset.press("Enter");
  await saved(p.page);
  await until(async () => {
    const value = await current();
    const el = value.slides[slideId].elements[text.id];
    return (
      el.paddingInsets?.left === 18 &&
      el.paragraphs[0].children[0].letterSpacing === 2 &&
      el.paragraphs[0].children[0].fontFamily === "Georgia"
    );
  }, "native text fields ACK");
  const transparentChip = await p.page
    .locator(".eppt-current-color.empty")
    .first()
    .boundingBox();
  assert(
    transparentChip &&
      transparentChip.width <= 28 &&
      transparentChip.height <= 28,
    "Transparent swatch must stay inside its native button",
  );
  await p.page.screenshot({ path: join(output, "text-format.png") });
  pass(
    "Slides native text presets, font search, character spacing and independent margins save through host ACK",
  );

  await p.page
    .locator(".eppt-insert-actions")
    .getByRole("button", { name: "表格", exact: true })
    .click();
  const table = p.page.locator(".eppt-table-overlay");
  await table.waitFor();
  await table.locator('button[data-r="0"][data-c="0"]').click();
  await table.evaluate((el) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "矩阵A\t矩阵B\n矩阵C\t矩阵D");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await until(
    async () => JSON.stringify(await current()).includes("矩阵D"),
    "matrix paste ACK",
  );
  const pasted = await current();
  assert(
    (await table.innerText()).includes("矩阵D"),
    "Pasted matrix must be visible",
  );
  await table.focus();
  await p.page.keyboard.press("ControlOrMeta+z");
  await until(
    async () => !JSON.stringify(await current()).includes("矩阵D"),
    "undo paste",
  );
  await p.page.keyboard.press("ControlOrMeta+Shift+z");
  await until(
    async () => JSON.stringify(await current()).includes("矩阵D"),
    "redo paste",
  );
  const column = table.locator(".eppt-table-resize-column").first();
  const boundary = await column.boundingBox();
  assert(boundary);
  await p.page.mouse.move(
    boundary.x + boundary.width / 2,
    boundary.y + boundary.height / 2,
  );
  await p.page.mouse.down();
  await p.page.mouse.move(boundary.x + 45, boundary.y + boundary.height / 2, {
    steps: 8,
  });
  await p.page.mouse.up();
  await until(
    async () => JSON.stringify(await current()).includes("columnWidths"),
    "column resize ACK",
  );
  const row = table.locator(".eppt-table-resize-row").first();
  const rb = await row.boundingBox();
  assert(rb);
  await p.page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await p.page.mouse.down();
  await p.page.mouse.move(rb.x + rb.width / 2, rb.y + 25, { steps: 8 });
  await p.page.mouse.up();
  await until(
    async () => JSON.stringify(await current()).includes("rowHeights"),
    "row resize ACK",
  );
  await saved(p.page);
  const value = await current();
  await p.page.screenshot({ path: join(output, "table-resize.png") });
  await p.page.reload();
  await p.page.locator(".eppt-workspace").waitFor();
  assert.deepEqual(await current(), value);
  pass(
    "Slides matrix clipboard, native undo/redo, row/column drag resizing and checkpoint reload",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify({ result: "passed", checks, errors }, null, 2) + "\n",
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
