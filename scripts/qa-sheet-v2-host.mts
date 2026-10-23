// Actual Doca UI, isolated native workbook imports, original collaboration transport.
// No private runtime mutation, production document or paid provider is used.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { projectExlsxWorkbook } from "@smartdoca/sheet/model";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { createContent } from "../packages/core/src/workflows/resources.js";

const installed = JSON.parse(
  await readFile("node_modules/@smartdoca/sheet/package.json", "utf8"),
);
assert.equal(
  installed.version,
  "0.2.9",
  "Run against the actually installed official Sheet0.2.9",
);
const temporary = await mkdtemp(join(tmpdir(), "doca-sheet-v2-host-"));
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? ".local/sheet-v2-host-2026-10-22",
);
const built = process.env.DOCA_QA_BUILT_WEB === "1";
const stages = new Set(
  (process.env.DOCA_QA_STAGES ?? "clipboard,dropdown-delete,idle").split(","),
);
const port = Number(process.env.DOCA_QA_PORT ?? 39508),
  origin = `http://127.0.0.1:${port}`;
await mkdir(output, { recursive: true });
await rm(join(output, "results.json"), { force: true });
process.env.DOCA_CREDENTIAL_MASTER_KEY = randomBytes(32).toString("hex");
process.env.DOCA_FILE_STORE_ID = "local";
process.env.DOCA_FILE_STORES_JSON = JSON.stringify({
  version: 1,
  stores: { local: { provider: "local", root: join(temporary, "files") } },
});
const { createApp } = await import("../apps/server/src/app/create-app.js");
const { storageRuntime } =
  await import("../apps/server/src/adapters/storage.js");
const db = await openDatabase({ driver: "sqlite", path: ":memory:" });
const actor = {
  ...(await createUser(
    db,
    {
      login: "sheetv2qa",
      displayName: "Sheet v2 QA",
      password: "isolated-sheet-v2-host-2026",
    },
    { bootstrap: true },
  )),
  admin: 1,
};
let providerCalls = 0;
const app = await createApp(db, {
  origin,
  ...(built ? { staticDirectory: resolve("apps/web/dist") } : {}),
  storage: storageRuntime(),
  ai: {
    memory: { driver: "sqlite", url: ":memory:" },
    fetch: async () => {
      providerCalls++;
      throw Error("No models in Sheet QA");
    },
  },
});
await app.listen({ host: "127.0.0.1", port: built ? port : 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = built
  ? undefined
  : await createServer({
      configFile: resolve("apps/web/vite.config.ts"),
      cacheDir: resolve("artifacts/verification/vite-sheet-v2"),
      server: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        hmr: false,
        watch: { ignored: ["**/*"] },
        proxy: {
          "/api": { target: `http://127.0.0.1:${address.port}`, ws: true },
        },
      },
    });
await web?.listen();
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
const errors: string[] = [],
  checks: any[] = [],
  observed: Array<{ page: Page; updates: any[] }> = [];
let current: Page | undefined,
  currentGroup = "setup",
  currentResourceId: string | undefined;
const resourceIds = new Set<string>();
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const request = async (path: string, data?: unknown, method = "GET") => {
  const response = await context.request.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { origin },
    data,
  });
  assert.equal(
    response.status(),
    200,
    `${method} ${path}: ${await response.text()}`,
  );
  return response.json();
};
const until = async (predicate: () => Promise<boolean>, label: string) => {
  for (let n = 0; n < 150; n++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error(`Timed out: ${label}`);
};
const saved = (page: Page) =>
  page
    .getByText(/(?:^| · )已保存到云端$/)
    .last()
    .waitFor({ state: "attached" });
const open = async (id: string) => {
  const page = await context.newPage();
  current = page;
  currentResourceId = id;
  resourceIds.add(id);
  await page.addInitScript(() => {
    const qa = window as typeof window & {
      __qaSheetPaste?: unknown;
      __qaSheetKeys?: unknown[];
    };
    qa.__qaSheetKeys = [];
    document.addEventListener(
      "paste",
      (event) => {
        qa.__qaSheetPaste = {
          types: [...(event.clipboardData?.types ?? [])],
          text: event.clipboardData?.getData("text/plain"),
          html: event.clipboardData?.getData("text/html"),
          activeTag: document.activeElement?.tagName,
        };
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.metaKey || event.ctrlKey)
          qa.__qaSheetKeys!.push({
            key: event.key,
            meta: event.metaKey,
            ctrl: event.ctrlKey,
            active: document.activeElement?.outerHTML?.slice(0, 300),
          });
      },
      true,
    );
  });
  const updates: any[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === "update") updates.push(frame);
      } catch {}
    }),
  );
  await page.goto(`${origin}/#/r/${id}`);
  await page.locator(".uos-editor__select-all").waitFor();
  await saved(page);
  const observedPage = { page, updates };
  observed.push(observedPage);
  return observedPage;
};
const project = async (id: string) => {
  const x = await request(`/ai/resources/${id}/preview`);
  return (await projectExlsxWorkbook({
    baseline: x.surface.baseline,
    update: new Uint8Array(Buffer.from(x.surface.update, "base64")),
    checkpointSeq: 0,
  })) as any;
};
const state = async (id: string) =>
  db
    .selectFrom("document_states")
    .selectAll()
    .where("resource_id", "=", id)
    .executeTakeFirstOrThrow();
const epoch = async (id: string) =>
  (
    await db
      .selectFrom("editor_epochs")
      .select("epoch_id")
      .where("resource_id", "=", id)
      .executeTakeFirstOrThrow()
  ).epoch_id;
const sheet = (workbook: any) => workbook.sheets[workbook.sheetOrder[0]];
const value = (workbook: any, row: number, column: number) =>
  sheet(workbook).cellData?.[row]?.[column]?.v;
const cellText = (workbook: any, row: number, column: number) => {
  const cell = sheet(workbook).cellData?.[row]?.[column];
  return cell?.p?.body
    ? String(cell.p.body.dataStream).replace(/\r\n$/, "")
    : cell?.v == null
      ? ""
      : String(cell.v);
};
const select = async (page: Page, range: string) => {
  current = page;
  await page.bringToFront();
  const input = page
    .locator(".uos-editor")
    .getByRole("textbox", { exact: true });
  await input.fill(range);
  await input.press("Enter");
};
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(output, `${name}.png`) });
  return `${name}.png`;
};
const menu = async (page: Page, name: "复制" | "剪切", row = 0, column = 0) => {
  await page.locator('canvas[id^="univer-sheet-main-canvas_"]').click({
    button: "right",
    position: { x: 48 + column * 72 + 25, y: 22 + row * 18 + 8 },
  });
  await page.getByRole("button", { name, exact: true }).click();
  await page.evaluate(() => navigator.clipboard.readText());
};
const readVisibleCell = async (
  page: Page,
  cell: string,
  row: number,
  column: number,
) => {
  await select(page, cell);
  await menu(page, "复制", row, column);
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(
    /\r?\n$/,
    "",
  );
};
const fixture = async (title: string) =>
  createContent(db).create(actor, {
    kind: "document",
    format: "spreadsheet",
    title,
    initialContent: {
      id: "fixture",
      name: title,
      appVersion: "0.25.1",
      locale: "zhCN",
      styles: { bold: { bl: 1 } },
      sheetOrder: ["records"],
      sheets: {
        records: {
          id: "records",
          name: "记录",
          rowCount: 60,
          columnCount: 26,
          defaultRowHeight: 18,
          defaultColumnWidth: 72,
          cellData: {
            0: {
              0: { v: "记录" },
              1: { v: "数量" },
              2: { v: "状态" },
              3: { v: "负责人" },
            },
            1: {
              0: { v: "任务甲" },
              1: { v: 10 },
              2: { v: "待办", s: "bold" },
              3: { v: "张三" },
              4: { v: "待办,完成", s: "bold" },
            },
            2: {
              0: { v: "任务乙" },
              1: { v: 20 },
              2: { v: "进行中", s: "bold" },
              3: { v: "旁边不可清空" },
              4: { v: "进行中", s: "bold" },
            },
            3: {
              0: { v: "任务丙" },
              1: { v: 30 },
              2: { v: "完成", s: "bold" },
              3: { v: "李四" },
            },
            4: {
              0: { v: "任务丁" },
              1: { v: 40 },
              2: { v: "待办", s: "bold" },
              3: { v: "王五" },
            },
          },
        },
      },
    },
  });
const dropdown = async (page: Page) => {
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await page.getByRole("menuitem", { name: "下拉列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "下拉列表", exact: true });
  await dialog.waitFor();
  return dialog;
};
const hasRule = async (page: Page, range: string, expected: boolean) => {
  await select(page, range);
  const dialog = await dropdown(page);
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "选项 1", exact: true })
      .inputValue(),
    expected ? "待办" : "",
    `${range} dropdown presence`,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
};
const rules = (workbook: any) => {
  const resource = workbook.resources?.find(
    (x: any) => x.name === "SHEET_DATA_VALIDATION_PLUGIN",
  );
  return resource ? (JSON.parse(resource.data).records ?? []) : [];
};
const covers = (workbook: any, row: number, column = 2) =>
  rules(workbook).some(
    (rule: any) =>
      ["list", "listMultiple"].includes(rule.type) &&
      rule.ranges.some(
        (r: any) =>
          r.startRow <= row &&
          row <= r.endRow &&
          r.startColumn <= column &&
          column <= r.endColumn,
      ),
  );
const run = async (group: string, work: () => Promise<unknown>) => {
  if (!stages.has(group)) return;
  currentGroup = group;
  try {
    checks.push({ group, passed: true, details: await work() });
    console.log("PASS", group);
  } catch (error) {
    checks.push({ group, passed: false, error: String(error) });
    console.error("FAIL", group, error);
    if (current) {
      await shot(current, `${group}-failure`).catch(() => {});
      await writeFile(
        join(output, `${group}-failure.html`),
        await current.content(),
      ).catch(() => {});
      await writeFile(
        join(output, `${group}-body.txt`),
        await current.locator("body").innerText(),
      ).catch(() => {});
      if (currentResourceId)
        await writeFile(
          join(output, `${group}-model.json`),
          JSON.stringify(await project(currentResourceId), null, 2),
        ).catch(() => {});
    }
  }
};
try {
  await request(
    "/auth/login",
    { login: "sheetv2qa", password: "isolated-sheet-v2-host-2026" },
    "POST",
  );
  await run("clipboard", async () => {
    const doc = await fixture("剪贴板包0.2.9网站验收"),
      a = await open(doc.id),
      b = await open(doc.id);
    const initial = await project(doc.id),
      originalEpoch = await epoch(doc.id);
    await select(a.page, "A1:D3");
    await menu(a.page, "复制");
    await writeFile(
      join(output, "clipboard-native-copy.json"),
      JSON.stringify(
        await a.page.evaluate(async () => ({
          text: await navigator.clipboard.readText(),
          types: (await navigator.clipboard.read()).map((i) => i.types),
          active: document.activeElement?.outerHTML?.slice(0, 500),
        })),
        null,
        2,
      ),
    );
    await select(a.page, "A8");
    await a.page.keyboard.press("ControlOrMeta+v");
    await delay(250);
    await writeFile(
      join(output, "clipboard-paste-event.json"),
      JSON.stringify(
        await a.page.evaluate(() => {
          const qa = window as any;
          return {
            paste: qa.__qaSheetPaste,
            keys: qa.__qaSheetKeys,
            active: document.activeElement?.outerHTML?.slice(0, 500),
          };
        }),
        null,
        2,
      ),
    );
    await until(
      async () =>
        value(await project(doc.id), 7, 0) === "记录" &&
        value(await project(doc.id), 9, 3) === "旁边不可清空",
      "ordinary native copy/paste",
    );
    await saved(a.page);
    await delay(400);
    const copiedMatrix = await project(doc.id);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++)
        assert.equal(cellText(copiedMatrix, r + 7, c), cellText(initial, r, c));
    assert.equal(
      await readVisibleCell(b.page, "A8", 7, 0),
      "记录",
      "peer copy sees actual applied cell",
    );
    await shot(b.page, "clipboard-peer-copy");
    await select(a.page, "A8:D10");
    await menu(a.page, "复制", 7);
    const copied = await project(doc.id),
      beforeRejectedCopy = await state(doc.id),
      updates = a.updates.length;
    await select(a.page, "X1");
    await a.page.keyboard.press("ControlOrMeta+v");
    const warning = a.page.getByText(
      "粘贴范围超出当前工作表，请先插入足够的行或列再粘贴",
      { exact: true },
    );
    await warning.waitFor();
    await shot(a.page, "clipboard-copy-out-of-bounds-warning");
    assert.deepEqual(await project(doc.id), copied);
    assert.deepEqual(await state(doc.id), beforeRejectedCopy);
    assert.equal(a.updates.length, updates);
    await select(a.page, "A8:D10");
    await menu(a.page, "剪切", 7);
    const beforeRejectedCut = await state(doc.id),
      cutUpdates = a.updates.length;
    await select(a.page, "X1");
    await a.page.keyboard.press("ControlOrMeta+v");
    await warning.waitFor();
    await shot(a.page, "clipboard-cut-out-of-bounds-warning");
    assert.deepEqual(await project(doc.id), copied);
    assert.deepEqual(await state(doc.id), beforeRejectedCut);
    assert.equal(a.updates.length, cutUpdates);
    await select(a.page, "A15");
    await a.page.keyboard.press("ControlOrMeta+v");
    await until(async () => {
      const x = await project(doc.id);
      return !value(x, 7, 0) && value(x, 14, 0) === "记录";
    }, "retry original cut at valid location");
    await saved(a.page);
    const cut = await project(doc.id);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        assert.equal(cellText(cut, r + 14, c), cellText(initial, r, c));
        assert.equal(cellText(cut, r + 7, c), "");
      }
    await a.page.getByRole("button", { name: "撤销", exact: true }).click();
    await until(async () => {
      const x = await project(doc.id);
      return value(x, 7, 0) === "记录" && !value(x, 14, 0);
    }, "one undo restores complete cut");
    const undone = await project(doc.id);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        assert.equal(cellText(undone, r + 7, c), cellText(initial, r, c));
        assert.equal(cellText(undone, r + 14, c), "");
      }
    await a.page.getByRole("button", { name: "重做", exact: true }).click();
    await until(
      async () => canonical(await project(doc.id)) === canonical(cut),
      "redo restores entire cut",
    );
    assert.equal(await readVisibleCell(b.page, "A15", 14, 0), "记录");
    assert.equal(b.updates.length, 0, "peer content echo");
    const beforeReload = await state(doc.id);
    await Promise.all([a.page.reload(), b.page.reload()]);
    await Promise.all([
      a.page.locator(".uos-editor__select-all").waitFor(),
      b.page.locator(".uos-editor__select-all").waitFor(),
    ]);
    await Promise.all([saved(a.page), saved(b.page)]);
    assert.equal(await readVisibleCell(b.page, "A15", 14, 0), "记录");
    assert.deepEqual(await state(doc.id), beforeReload);
    assert.deepEqual(await project(doc.id), cut);
    assert.equal(sheet(cut).rowCount, sheet(initial).rowCount);
    assert.equal(sheet(cut).columnCount, sheet(initial).columnCount);
    assert.equal(await epoch(doc.id), originalEpoch);
    await shot(b.page, "clipboard-peer-reloaded");
    return {
      copyPaste: true,
      rejectedCopyNoPartial: true,
      rejectedCutNoPartial: true,
      originalCutCacheRetry: true,
      undoRedo: true,
      peerReadViaNativeClipboard: true,
      peerEcho: b.updates.length,
      reloadWrites: 0,
      rowCount: sheet(cut).rowCount,
      columnCount: sheet(cut).columnCount,
    };
  });
  await run("dropdown-delete", async () => {
    const doc = await fixture("下拉删除包0.2.9网站验收"),
      a = await open(doc.id),
      b = await open(doc.id);
    await select(a.page, "C2:C5");
    const dialog = await dropdown(a.page);
    for (const [i, text] of ["待办", "进行中", "完成"].entries())
      await dialog
        .getByRole("textbox", { name: `选项 ${i + 1}`, exact: true })
        .fill(text);
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await until(
      async () => covers(await project(doc.id), 1),
      "native dropdown rule durable",
    );
    await select(a.page, "E2:E3");
    const multiple = await dropdown(a.page);
    await multiple.getByRole("radio", { name: "多选", exact: true }).check();
    for (const [i, text] of ["待办", "进行中", "完成"].entries())
      await multiple
        .getByRole("textbox", { name: `选项 ${i + 1}`, exact: true })
        .fill(text);
    await multiple.getByRole("button", { name: "确认", exact: true }).click();
    await multiple.waitFor({ state: "detached" });
    await until(
      async () => covers(await project(doc.id), 1, 4),
      "native multi-select rule durable",
    );
    await saved(a.page);
    const original = await project(doc.id),
      cells = canonical(sheet(original).cellData);
    await shot(a.page, "dropdown-before");
    await select(a.page, "C3:D3");
    await a.page.keyboard.press("Backspace");
    await until(
      async () => !covers(await project(doc.id), 2),
      "Backspace removes selected dropdown rule",
    );
    let changed = await project(doc.id);
    assert(covers(changed, 1) && covers(changed, 3) && covers(changed, 4));
    assert.equal(canonical(sheet(changed).cellData), cells);
    await hasRule(b.page, "C3", false);
    await hasRule(b.page, "C2", true);
    await shot(b.page, "dropdown-peer-partial-backspace");
    await a.page.getByRole("button", { name: "撤销", exact: true }).click();
    await until(
      async () => covers(await project(doc.id), 2),
      "undo restores removed part of shared rule",
    );
    await hasRule(b.page, "C3", true);
    await a.page.getByRole("button", { name: "重做", exact: true }).click();
    await until(
      async () => !covers(await project(doc.id), 2),
      "redo removes same selected part",
    );
    await select(a.page, "C4:C5");
    await a.page.keyboard.press("Delete");
    await until(
      async () =>
        !covers(await project(doc.id), 3) && !covers(await project(doc.id), 4),
      "Delete removes selected list rules",
    );
    changed = await project(doc.id);
    assert(covers(changed, 1));
    assert.equal(canonical(sheet(changed).cellData), cells);
    await hasRule(b.page, "C4", false);
    await hasRule(b.page, "C2", true);
    await select(a.page, "E2");
    await a.page.keyboard.press("Delete");
    await until(
      async () => !covers(await project(doc.id), 1, 4),
      "Delete removes selected multi-select rule",
    );
    assert(covers(await project(doc.id), 2, 4));
    assert.equal(canonical(sheet(await project(doc.id)).cellData), cells);
    await hasRule(b.page, "E2", false);
    await hasRule(b.page, "E3", true);
    await shot(b.page, "dropdown-peer-multiselect-partial");
    await select(a.page, "A1");
    await a.page.keyboard.press("Backspace");
    await until(
      async () => !value(await project(doc.id), 0, 0),
      "plain cell native clearing",
    );
    await a.page.getByRole("button", { name: "撤销", exact: true }).click();
    await until(
      async () => value(await project(doc.id), 0, 0) === "记录",
      "plain cell undo",
    );
    const inputBaseline = await state(doc.id),
      inputContent = await project(doc.id);
    await select(a.page, "C2");
    await a.page.keyboard.press("F2");
    await a.page.keyboard.press("End");
    await a.page.keyboard.press("Backspace");
    await shot(a.page, "dropdown-native-text-draft");
    await a.page
      .locator(
        '[data-u-comp="formula-bar"] span:has(> svg.univerjs-icon-close-icon)',
      )
      .first()
      .click();
    assert.deepEqual(await state(doc.id), inputBaseline);
    assert.deepEqual(await project(doc.id), inputContent);
    await select(a.page, "C3");
    const bar = await a.page
      .locator('[data-u-comp="formula-bar"]')
      .boundingBox();
    assert(bar);
    await a.page.mouse.click(bar.x + 230, bar.y + 13);
    await a.page.keyboard.press("End");
    await a.page.keyboard.press("Backspace");
    await shot(a.page, "dropdown-formula-bar-text-draft");
    await a.page.keyboard.press("Enter");
    await until(
      async () => cellText(await project(doc.id), 2, 2) === "进行",
      "actual formula-bar Backspace commit",
    );
    await a.page.getByRole("button", { name: "撤销", exact: true }).click();
    await until(
      async () => cellText(await project(doc.id), 2, 2) === "进行中",
      "formula-bar undo",
    );
    await select(a.page, "C3");
    await a.page.keyboard.press("F2");
    await a.page.keyboard.press("End");
    await a.page.keyboard.press("Backspace");
    await a.page.keyboard.press("Enter");
    await until(
      async () => cellText(await project(doc.id), 2, 2) === "进行",
      "ordinary native text Backspace commit",
    );
    await a.page.getByRole("button", { name: "撤销", exact: true }).click();
    await until(
      async () => cellText(await project(doc.id), 2, 2) === "进行中",
      "ordinary native text undo",
    );
    const baseline = await state(doc.id),
      content = await project(doc.id),
      originalEpoch = await epoch(doc.id);
    await select(a.page, "C2");
    const editDialog = await dropdown(a.page),
      option = editDialog.getByRole("textbox", { name: "选项 1", exact: true });
    await option.fill("测试");
    await option.press("End");
    await option.press("Backspace");
    assert.equal(await option.inputValue(), "测");
    await editDialog.getByRole("button", { name: "取消", exact: true }).click();
    await select(a.page, "C2");
    await a.page
      .getByRole("button", { name: "评论选中区域", exact: true })
      .click();
    const comment = a.page.getByRole("textbox", {
      name: "评论内容",
      exact: true,
    });
    await comment.fill("外部评论");
    await comment.press("End");
    await comment.press("Backspace");
    assert.equal(await comment.inputValue(), "外部评");
    await shot(a.page, "dropdown-external-comment-backspace");
    assert.deepEqual(await state(doc.id), baseline);
    assert.deepEqual(await project(doc.id), content);
    await a.page
      .getByRole("button", { name: "收起内容评论", exact: true })
      .click();
    const mode = a.page.getByRole("combobox", {
      name: "文档模式",
      exact: true,
    });
    await mode.click();
    await a.page.getByRole("option", { name: "阅读", exact: true }).click();
    await a.page
      .locator('canvas[id^="univer-sheet-main-canvas_"]')
      .click({ position: { x: 48 + 2 * 72 + 25, y: 22 + 18 + 8 } });
    await a.page.keyboard.press("Backspace");
    await a.page.keyboard.press("Delete");
    await delay(350);
    assert.deepEqual(await state(doc.id), baseline);
    assert.deepEqual(await project(doc.id), content);
    assert.equal(b.updates.length, 0);
    await shot(a.page, "dropdown-readonly-keeps-rule-value-style");
    await Promise.all([a.page.reload(), b.page.reload()]);
    await Promise.all([
      a.page.locator(".uos-editor__select-all").waitFor(),
      b.page.locator(".uos-editor__select-all").waitFor(),
    ]);
    await Promise.all([saved(a.page), saved(b.page)]);
    await hasRule(b.page, "C2", true);
    await hasRule(b.page, "C3", false);
    await hasRule(b.page, "C4", false);
    await hasRule(b.page, "E2", false);
    await hasRule(b.page, "E3", true);
    assert.deepEqual(await state(doc.id), baseline);
    assert.deepEqual(await project(doc.id), content);
    assert.equal(canonical(sheet(content).cellData), cells);
    assert.equal(await epoch(doc.id), originalEpoch);
    await shot(b.page, "dropdown-peer-reloaded");
    return {
      backspacePartialSharedRule: true,
      deletePartialSharedRule: true,
      multiSelectPartialRule: true,
      mixedPlainCellPreserved: true,
      allValuesAndStylesPreserved: true,
      undoRedo: true,
      plainCellClears: true,
      dropdownTextDraftCancelledWithoutWrite: true,
      dropdownDraftCharacterProof:
        "manual screenshot inspection; no private handle",
      ordinaryFormulaBarBackspaceCommitUndo: true,
      ordinaryNativeTextBackspaceCommitUndo: true,
      dialogInputOwnership: true,
      externalCommentOwnership: true,
      readOnly: true,
      peerRuleReadViaPublicDialog: true,
      peerEcho: b.updates.length,
      reloadWrites: 0,
    };
  });
  if (checks.every((check) => check.passed))
    await run("idle", async () => {
      assert(
        resourceIds.size > 0,
        "Idle verification needs the preceding workbook fixtures",
      );
      const before = await Promise.all(
        [...resourceIds].map(async (id) => [id, await state(id)] as const),
      );
      const counts = observed.map((entry) => entry.updates.length);
      for (let n = 1; n <= 2; n++) {
        await delay(30_000);
        console.log(`Idle observation ${n * 30}s`);
      }
      for (const [id, snapshot] of before)
        assert.deepEqual(await state(id), snapshot);
      assert.deepEqual(
        observed.map((entry) => entry.updates.length),
        counts,
      );
      return {
        seconds: 60,
        documents: resourceIds.size,
        clients: observed.length,
        contentWrites: 0,
      };
    });
  assert.equal(providerCalls, 0);
  assert.deepEqual(errors, []);
  assert(
    checks.every((check) => check.passed),
    "Some actual website checks failed",
  );
} finally {
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed:
          checks.length === stages.size &&
          checks.every((c) => c.passed) &&
          errors.length === 0,
        synthetic: true,
        actualChromeWebsite: true,
        webMode: built ? "production-build" : "development-server",
        sheetVersion: installed.version,
        privateRuntimeMutations: 0,
        paidProviderCalls: providerCalls,
        checks,
        errors,
        productionAccepted: false,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  await web?.close();
  await app.close();
  await db.destroy();
  await rm(temporary, { recursive: true, force: true });
}
