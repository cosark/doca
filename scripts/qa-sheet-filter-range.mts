// Production Web, actual host ACK/storage, synthetic accounts and workbooks only.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Page } from "playwright-core";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";

const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/verification/sheet-filter-range-host",
);
assert(output.startsWith(resolve("artifacts") + "/"));
await mkdir(output, { recursive: true });
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: join(output, "files") } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const password = "isolated-filter-range-2026";
const owner = {
  ...(await createUser(
    db,
    { login: "filterrangeqa", displayName: "Filter range QA", password },
    { bootstrap: true },
  )),
  admin: 1,
};
const port = Number(process.env.DOCA_QA_PORT ?? 39829),
  origin = `http://127.0.0.1:${port}`;
const app = await createApp(db, {
  origin,
  staticDirectory: resolve("apps/web/dist"),
  storage: storageRuntime(),
  ai: {
    memory: { driver: "sqlite", url: ":memory:" },
    fetch: async () => {
      throw Error("No provider calls in filter QA");
    },
  },
});
await app.listen({ host: "127.0.0.1", port });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const checks: string[] = [],
  errors: string[] = [],
  clients: Array<{ page: Page; updates: unknown[]; id: string }> = [];
const pass = (label: string) => {
  checks.push(label);
  console.log("PASS " + label);
};
const until = async (predicate: () => Promise<boolean>, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
};
const request = async (path: string, data?: unknown) => {
  const r = await context.request.fetch(origin + "/api/v1" + path, {
    method: data ? "POST" : "GET",
    headers: { origin },
    data,
  });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
};
const state = async (id: string) => {
  const data = await request(`/ai/resources/${id}/preview`);
  const value = await projectExlsxWorkbook({
    baseline: data.surface.baseline,
    update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
    checkpointSeq: 0,
  });
  const row = await db
    .selectFrom("document_states")
    .innerJoin(
      "editor_epochs",
      "editor_epochs.resource_id",
      "document_states.resource_id",
    )
    .select(["document_states.seq", "editor_epochs.epoch_id"])
    .where("document_states.resource_id", "=", id)
    .executeTakeFirstOrThrow();
  const filter = JSON.parse(
    value.resources!.find((r) => r.name === "SHEET_FILTER_PLUGIN")!.data,
  ).s;
  return { ...row, value, filter };
};
const open = async (id: string) => {
  const page = await context.newPage(),
    updates: unknown[] = [];
  clients.push({ page, updates, id });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (s) =>
    s.on("framesent", ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (m.type === "update") updates.push(m);
      } catch {}
    }),
  );
  await page.goto(origin + "/#/r/" + id);
  await page.locator(".uos-editor__select-all").waitFor();
  await page
    .getByText(/(?:^| · |：|:)已保存到云端$/)
    .last()
    .waitFor({ state: "attached" });
  return { page, updates, id };
};
const fixture = async (append: boolean) => {
  const cells: Record<number, Record<number, { v: string }>> = {
    0: { 0: { v: "事项" }, 3: { v: "解决状态" } },
  };
  for (let row = 1; row <= (append ? 31 : 42); row++)
    cells[row] = {
      0: { v: "测试事项 " + row },
      3: { v: row === 40 || row === 41 ? "已解决" : "待解决" },
    };
  return createContent(db).create(owner, {
    kind: "document",
    format: "spreadsheet",
    title: "Filter QA " + randomUUID(),
    initialContent: {
      id: randomUUID(),
      name: "Filter QA",
      styles: {},
      sheetOrder: ["s"],
      sheets: {
        s: {
          id: "s",
          name: "隔离数据",
          rowCount: 100,
          columnCount: 10,
          defaultRowHeight: 26,
          defaultColumnWidth: 100,
          columnData: { 0: { w: 200 }, 3: { w: 180 } },
          cellData: cells,
        },
      },
      resources: [
        {
          name: "SHEET_FILTER_PLUGIN",
          data: JSON.stringify({
            s: {
              ref: { startRow: 0, endRow: 31, startColumn: 0, endColumn: 3 },
              filterColumns: [{ colId: 3, filters: { filters: ["待解决"] } }],
            },
          }),
        },
      ],
    },
  });
};
let current: Page | undefined;
try {
  await request("/auth/login", { login: "filterrangeqa", password });
  for (const append of [false, true]) {
    const doc = await fixture(append),
      a = await open(doc.id),
      b = await open(doc.id);
    current = a.page;
    await a.page.bringToFront();
    const before = await state(doc.id);
    assert.equal(before.filter.ref.endRow, 31);
    assert.equal(a.updates.length + b.updates.length, 0);
    if (append) {
      const nameBox = a.page
        .locator(".uos-editor")
        .getByRole("textbox", { exact: true });
      await nameBox.fill("A33");
      await nameBox.press("Enter");
      await a.page.evaluate(
        (text) => navigator.clipboard.writeText(text),
        Array.from({ length: 11 }, (_, i) => {
          const r = i + 32;
          return `追加事项 ${r}\t\t\t${r === 40 || r === 41 ? "已解决" : "待解决"}`;
        }).join("\n"),
      );
      await a.page.keyboard.press("ControlOrMeta+v");
    } else {
      const box = await a.page
        .locator('canvas[id^="univer-sheet-main-canvas_"]')
        .boundingBox();
      assert(box);
      await a.page.mouse.click(box.x + 616, box.y + 35);
      await a.page.getByRole("button", { name: "确认", exact: true }).click();
    }
    await until(
      async () => (await state(doc.id)).filter.ref.endRow === 42,
      "authored filter reaches row 43",
    );
    const committed = await state(doc.id);
    assert.equal(committed.seq, before.seq + 1);
    assert.equal(committed.epoch_id, before.epoch_id);
    assert.equal(b.updates.length, 0, "remote projection cannot echo");
    if (append)
      assert.equal(committed.value.sheets.s.cellData?.[40]?.[3]?.v, "已解决");
    await a.page
      .locator(".uos-editor")
      .getByRole("button", { name: "撤销", exact: true })
      .click();
    await until(
      async () => (await state(doc.id)).filter.ref.endRow === 31,
      "one native undo restores range",
    );
    if (append)
      assert.equal(
        (await state(doc.id)).value.sheets.s.cellData?.[40]?.[3]?.v,
        undefined,
      );
    await a.page
      .locator(".uos-editor")
      .getByRole("button", { name: "重做", exact: true })
      .click();
    await until(
      async () => (await state(doc.id)).filter.ref.endRow === 42,
      "redo restores range",
    );
    const writes = a.updates.length;
    await a.page.reload();
    await a.page.locator(".uos-editor__select-all").waitFor();
    await a.page
      .getByText(/(?:^| · |：|:)已保存到云端$/)
      .last()
      .waitFor({ state: "attached" });
    await delay(500);
    assert.equal(a.updates.length, writes, "reload cannot rewrite content");
    assert.equal((await state(doc.id)).filter.ref.endRow, 42);
    assert.equal(b.updates.length, 0);
    await a.page.screenshot({
      path: join(
        output,
        append ? "append-restored.png" : "confirm-restored.png",
      ),
    });
    pass(
      (append ? "native append" : "native confirm") +
        ": durable ACK, one transaction, peer without echo, undo/redo and reload",
    );
  }
  const initial = await Promise.all(
    clients.map(async (c) => ({
      id: c.id,
      seq: (await state(c.id)).seq,
      writes: c.updates.length,
    })),
  );
  const started = Date.now();
  await delay(61_000);
  for (let i = 0; i < clients.length; i++) {
    assert.equal(clients[i]!.updates.length, initial[i]!.writes);
    assert.equal((await state(initial[i]!.id)).seq, initial[i]!.seq);
  }
  assert.deepEqual(errors, []);
  pass(
    "four clients idle for 61 seconds without content writes or browser errors",
  );
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        idleMilliseconds: Date.now() - started,
        clients: clients.length,
        productionAccepted: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await current
    ?.screenshot({ path: join(output, "failure.png") })
    .catch(() => {});
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      { checks, errors, error: String(error), stack: (error as Error).stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await app.close();
  await db.destroy();
}
