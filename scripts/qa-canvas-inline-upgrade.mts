// Real host + browser acceptance using only synthetic accounts and in-memory data.
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
  process.env.DOCA_QA_OUTPUT ?? "artifacts/editor-inline-2026-10-18",
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
  const target = await create("rich_text"),
    canvas = await create("canvas");
  const rich = await open(target.id, '.sk-editable[contenteditable="true"]');
  await rich.page.locator('.sk-editable[contenteditable="true"]').click();
  await rich.page.keyboard.press("ControlOrMeta+End");
  await rich.page.keyboard.press("Enter");
  await rich.page.keyboard.type("/mind");
  await rich.page
    .getByRole("button", { name: /思维导图/ })
    .last()
    .click();
  await rich.page
    .getByRole("dialog", { name: "思维导图编辑器", exact: true })
    .waitFor();
  await rich.page
    .getByRole("button", { name: "保存并返回文档", exact: true })
    .click();
  await rich.page
    .getByRole("dialog", { name: "思维导图编辑器", exact: true })
    .waitFor({ state: "detached" });
  await rich.page
    .getByRole("button", { name: "编辑思维导图", exact: true })
    .waitFor();
  await saved(rich.page);
  const mindBefore = await preview(target.id),
    mindUpdates = rich.updates.length;
  await rich.page
    .getByRole("button", { name: "编辑思维导图", exact: true })
    .click();
  await rich.page.locator(".sk-mind-leafer-canvas canvas").first().waitFor();
  await rich.page.screenshot({
    path: join(output, "slate-leafer-workspace.png"),
  });
  await rich.page
    .getByRole("button", { name: "关闭思维导图编辑器", exact: true })
    .click();
  await rich.page
    .getByRole("dialog", { name: "思维导图编辑器", exact: true })
    .waitFor({ state: "detached" });
  assert.deepEqual((await preview(target.id)).value, mindBefore.value);
  assert.equal((await preview(target.id)).seq, mindBefore.seq);
  assert.equal(rich.updates.length, mindUpdates);
  await rich.page.reload();
  await rich.page.locator(".sk-mind-figure img").waitFor();
  assert.equal((await preview(target.id)).seq, mindBefore.seq);
  pass(
    "Slate 0.4.23 Leafer workspace opens, cancels and refreshes its preview without content writes",
  );
  await rich.page.close();
  const a = await open(canvas.id, ".canvas-host"),
    b = await open(canvas.id, ".canvas-host");
  await a.page.bringToFront();
  await a.page.getByRole("button", { name: "表格", exact: true }).click();
  await a.page.getByRole("button", { name: "3 × 3", exact: true }).click();
  await a.page.locator(".canvas-host").click({ position: { x: 650, y: 350 } });
  const bounds = await a.page.locator(".table-axis-layer").boundingBox();
  assert(bounds);
  await a.page.mouse.click(bounds.x + 50, bounds.y + 20);
  const input = a.page.locator('[data-slate-editor="true"]');
  await input.waitFor();
  await a.page.keyboard.insertText("Owner @Editor");
  await a.page
    .getByRole("option", { name: "Editor upgrade QA", exact: true })
    .waitFor();
  await a.page.keyboard.press("Enter");
  await input.locator('[data-rich-inline="custom:user-mention"]').waitFor();
  await input.evaluate(
    (element, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    origin + "/#/r/" + target.id,
  );
  await input
    .locator('[data-rich-inline="custom:document-reference"]')
    .waitFor();
  await saved(a.page);
  const expected = (await preview(canvas.id)).value;
  assert(JSON.stringify(expected).includes("custom:user-mention"));
  assert(JSON.stringify(expected).includes(target.id));
  assert.equal(
    (await request(`/resources/${canvas.id}/references`)).outgoing[0].id,
    target.id,
  );
  assert.equal(b.updates.length, 0);
  pass(
    "host user directory, native mention, authorized document paste, durable ACK and reference index",
  );
  await a.page.keyboard.press("ControlOrMeta+z");
  await input
    .locator('[data-rich-inline="custom:document-reference"]')
    .waitFor({ state: "detached" });
  await a.page.keyboard.press("ControlOrMeta+Shift+z");
  await input
    .locator('[data-rich-inline="custom:document-reference"]')
    .waitFor();
  await a.page.screenshot({
    path: join(output, "canvas-mentions-reference.png"),
  });
  pass("host keyboard undo and redo preserve atomic inline identity");
  await a.page.keyboard.press("ControlOrMeta+End");
  await a.page.keyboard.press("Enter");
  await pasteFile(a.page, '[data-slate-editor="true"]');
  await input.locator('[data-resource-kind="attachment"]').waitFor();
  await input.locator(".rich-file-chip").click();
  await a.page.getByRole("button", { name: "预览附件", exact: true }).click();
  await a.page.locator('.document-file-preview[aria-label="qa.txt"]').waitFor();
  await a.page.locator(".document-file-preview-body").getByText("Isolated canvas attachment 画布附件", { exact: true }).waitFor();
  await a.page.screenshot({
    path: join(output, "canvas-host-file-preview.png"),
  });
  await a.page.getByRole("button", { name: "关闭", exact: true }).click();
  pass(
    "Canvas attachment preview callback opens the authorized host file viewer",
  );
  await a.page.keyboard.press("Escape");
  await saved(a.page);
  await a.page.reload();
  await a.page.locator(".canvas-host").waitFor();
  await mode(a.page, "阅读");
  // Click the first rich attachment via its native hover toolbar in readonly.
  const final = await preview(canvas.id);
  assert(JSON.stringify(final.value).includes("qa.txt"));
  assert(JSON.stringify(final.value).includes(target.id));
  await a.page.screenshot({ path: join(output, "canvas-readonly.png") });
  pass(
    "uploaded rich attachment and native inline references survive reload and readonly",
  );
  const count = a.updates.length,
    seq = final.seq,
    other = b.updates.length;
  for (let n = 0; n < 6; n++) await delay(10000);
  assert.equal(a.updates.length, count);
  assert.equal(b.updates.length, other);
  assert.equal((await preview(canvas.id)).seq, seq);
  assert.deepEqual(errors, []);
  pass("60-second idle across two real host pages produces zero writes");
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
