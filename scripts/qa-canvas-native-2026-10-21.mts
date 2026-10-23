// Real host + browser acceptance using only synthetic accounts and in-memory data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { captureRuntimeFingerprint } from "./qa-runtime-fingerprint.js";
import { installBuiltCanvasProbe } from "./qa-canvas-built-probe.js";

const root = await mkdtemp(join(tmpdir(), "doca-canvas-native-"));
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
const account = await createUser(
  db,
  {
    login: "canvasnativeqa",
    displayName: "Canvas native QA",
    password: "isolated-canvas-native-2026",
  },
  { bootstrap: true },
);
const mentionUser = await createUser(
  db,
  {
    login: "canvasnativepeer",
    displayName: "Canvas QA peer",
    password: "isolated-canvas-peer-2026",
  },
  { actor: { ...account, admin: 1 } },
);
const port = Number(process.env.DOCA_QA_PORT ?? 39446);
const keyboardDiagnostic = process.env.DOCA_QA_KEYBOARD_DIAGNOSTIC === "1";
const origin = `http://127.0.0.1:${port}`;
const builtWeb = process.env.DOCA_QA_BUILT_WEB === "1";
const runtimeBefore = await captureRuntimeFingerprint(builtWeb);
if (process.env.DOCA_QA_EXPECT_INDEX_SHA256) assert.equal(runtimeBefore.builtIndexSha256, process.env.DOCA_QA_EXPECT_INDEX_SHA256);
const app = await createApp(db, {
  origin,
  ...(builtWeb ? { staticDirectory: resolve("apps/web/dist") } : {}),
  storage: { ...storageRuntime(), root },
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: builtWeb ? port : 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const canvasRequire = createRequire(import.meta.resolve("@smartdoca/canvas"));
const engineEntry = join(
  dirname(canvasRequire.resolve("leafer-ui")),
  "web.esm.min.js",
);
const web = builtWeb ? undefined : await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(root, "vite-cache"),
  optimizeDeps: { include: ["leafer-ui"] },
  plugins: [
    {
      name: "qa-canvas-engine-readback",
      resolveId(id) {
        if (id === "/__qa/canvas-engine.js") return "\0qa-canvas-engine";
      },
      load(id) {
        if (id === "\0qa-canvas-engine")
          return 'export {Leafer} from "leafer-ui";';
      },
    },
  ],
  resolve: { alias: { "leafer-ui": engineEntry } },
  server: {
    host: "127.0.0.1",
    port,
    hmr: false,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
const output = resolve(
  process.env.DOCA_QA_OUTPUT ??
    "artifacts/verification/issue-tracker-2026-10-21/canvas-native-browser" +
      (process.argv.includes("--stages=preflight") ? "/preflight" : ""),
);
const canvasPackage = JSON.parse(
  await readFile(
    resolve("node_modules/@smartdoca/canvas/package.json"),
    "utf8",
  ),
);
const packageVersions = { "@smartdoca/canvas": canvasPackage.version };
if (!process.argv.includes("--stages=preflight")) {
  assert.equal(
    canvasPackage.version,
    process.env.DOCA_QA_CANVAS_VERSION ?? "0.5.9",
    "Final native acceptance must use the audited new official npm artifact",
  );
}
await mkdir(output, { recursive: true });
const checks: any[] = [],
  errors: string[] = [];
const pass = (label: string) => {
  checks.push({ label, result: "passed" });
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
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  if (builtWeb) await installBuiltCanvasProbe(context, origin + "/__qa/canvas-engine.js");
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
    if (data.resource.format === "spreadsheet") {
      const { projectExlsxWorkbook } = await import("@smartdoca/sheet/model");
      data.value = await projectExlsxWorkbook({
        baseline: data.surface.baseline,
        update: new Uint8Array(Buffer.from(data.surface.update, "base64")),
        checkpointSeq: 0,
      });
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
    { login: "canvasnativeqa", password: "isolated-canvas-native-2026" },
    "POST",
  );
  const watch = async () => {
    const page = await context.newPage(),
      updates: any[] = [],
      cursors: any[] = [],
      received: any[] = [];
    page.setDefaultTimeout(12000);
    if (keyboardDiagnostic) await page.addInitScript({ content: `(() => {
      const describe = el => el instanceof Element ? { tag: el.tagName, className: el.getAttribute('class'), ariaLabel: el.getAttribute('aria-label'), title: el.getAttribute('title'), role: el.getAttribute('role'), tabIndex: el.tabIndex, insideCanvas: !!el.closest('.canvas-app') } : null;
      window.__qaCanvasKeyboardEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'focusin', 'focusout', 'keydown', 'keyup']) document.addEventListener(type, event => {
        const record = { type, time: performance.now(), key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, defaultPrevented: event.defaultPrevented, target: describe(event.target), active: describe(document.activeElement), path: event.composedPath().slice(0, 6).map(describe) };
        window.__qaCanvasKeyboardEvents.push(record);
        if (window.__qaCanvasKeyboardEvents.length > 200) window.__qaCanvasKeyboardEvents.shift();
      }, { capture: true, passive: true });
    })();` });
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
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
          if (frame.type === "cursor") cursors.push(frame);
        } catch {}
      });
    });
    return { page, updates, cursors, received };
  };
  const create = (format: string) =>
    request(
      "/resources",
      { title: `Canvas native ${format} QA`, kind: "document", format },
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
  const dismissFeedback = async (page: Page) => {
    const dismiss = page.locator(".feedback-stack").getByRole("button", { name: "关闭提示", exact: true });
    while (await dismiss.count()) await dismiss.first().click();
  };
  const mode = async (page: Page, name: string) => {
    await dismissFeedback(page);
    await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };

  const { createDocuments, b64, unb64 } =
    await import("../packages/core/src/modules/collaboration/documents.js");
  const { CanvasModel } = await import("@smartdoca/canvas/model");
  const fixtures = JSON.parse(
    await readFile(
      "tests/fixtures/issue-tracker-2026-10-21/canvas-native.json",
      "utf8",
    ),
  ).cases;
  const docs = createDocuments(db),
    protocol = { protocolVersion: 1, codec: "aidcanvas-yjs", schemaVersion: 1 },
    actor = { ...account, admin: 1 };
  const a = await watch(),
    b = await watch();
  let resetBeforeStage = false;
  const allDocIds: string[] = [];
  const names = (nodes: any[]): any[] =>
    nodes.flatMap((node) => [node, ...names(node.children ?? [])]);
  const find = (value: any, id: string) =>
    names(value.scene.children).find((node) => node.id === id);
  const node = (value: any, id: string) => {
    const found = find(value, id);
    assert(found, "Missing " + id);
    return found;
  };
  const seed = async (caseName: string) => {
    if (resetBeforeStage) {
      // Different resource hashes normally keep one SPA alive. After a failed
      // stage, start fresh documents so a crashed editor cannot poison the next.
      await Promise.all([
        a.page.goto("about:blank"),
        b.page.goto("about:blank"),
      ]);
      resetBeforeStage = false;
    }
    const resource = await create("canvas");
    allDocIds.push(resource.id);
    const init = await docs.exchange(actor, resource.id, protocol),
      model = CanvasModel.restore({
        codec: "aidcanvas-yjs",
        schemaVersion: 1,
        epochId: init.epochId!,
        update: unb64(init.update),
      });
    try {
      for (const value of fixtures[caseName]) model.add(value);
      await docs.exchange(actor, resource.id, {
        ...protocol,
        epochId: init.epochId,
        messageId: crypto.randomUUID(),
        update: b64(model.checkpoint().update),
      });
    } finally {
      model.dispose();
    }
    for (const watched of [a, b]) {
      await watched.page.goto(origin + "/#/r/" + resource.id);
      await watched.page.locator(".canvas-host").waitFor();
      if (
        (
          await watched.page
            .getByRole("combobox", { name: "文档模式", exact: true })
            .textContent()
        )?.includes("阅读")
      ) {
        await mode(watched.page, "编辑");
      }
      await saved(watched.page);
    }
    await a.page.bringToFront();
    diagnosticPage = a.page;
    return resource.id;
  };
  const xy = async (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => {
    return page.evaluate<{ x: number; y: number }>(`(async()=>{
      const {Leafer}=await import("/__qa/canvas-engine.js");
      const app=Leafer.list.list.find(item=>item.isApp);
      if(!app)throw Error("CANVAS_ENGINE_NOT_READY");
      const p=app.tree.getClientPointByWorld(app.tree.getWorldPoint({x:${x},y:${y}}));
      return {x:p.x,y:p.y};
    })()`);
  };
  const click = async (page: Page, x: number, y: number, options: any = {}) => {
    const p = await xy(page, x, y);
    await page.mouse.click(p.x, p.y, options);
  };
  const drag = async (
    page: Page,
    from: { x: number; y: number },
    dx: number,
    dy: number,
    release = true,
  ) => {
    const p = await xy(page, from.x, from.y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 12 });
    if (release) await page.mouse.up();
  };
  // Test-only readback of the installed engine's public instance registry. No
  // mutation/selection helper or product bridge is installed in the host.
  const runtime = async (page: Page, id?: string): Promise<any> =>
    page.evaluate(`(async (id)=>{
      const {Leafer}=await import("/__qa/canvas-engine.js");
      const app=Leafer.list.list.find(item=>item.isApp);
      if(!app)throw Error("CANVAS_ENGINE_NOT_READY");
      const read=item=>({id:item.id,tag:item.tag,name:item.name,x:item.x,y:item.y,width:item.width,height:item.height,path:item.path,fill:item.fill,stroke:item.stroke,strokeWidth:item.strokeWidth,dashPattern:item.dashPattern,text:item.text,textAlign:item.textAlign,verticalAlign:item.verticalAlign,data:item.data,skipJSON:item.skipJSON,children:item.children?.map(read)});
      const flatten=nodes=>nodes.flatMap(n=>[n,...flatten(n.children??[])]);
      const scene=app.tree.children.map(read),found=id?flatten(scene).find(n=>n.id===id):undefined;
      return {selection:app.editor.list.map(n=>n.id),nodes:scene,found};
    })(${JSON.stringify(id ?? null)})`);
  const selected = async (page: Page, id: string) => {
    await until(
      async () =>
        JSON.stringify((await runtime(page)).selection) ===
        JSON.stringify([id]),
      "native selection " + id,
    );
  };
  const peer = async (id: string, expected: any) => {
    await until(async () => {
      const actual = (await runtime(b.page, id)).found;
      return (
        actual &&
        Object.entries(expected).every(
          ([key, value]) =>
            JSON.stringify(actual[key]) === JSON.stringify(value),
        )
      );
    }, "peer native geometry " + id);
    assert.equal(b.updates.length, 0, "remote echo");
  };
  const unchanged = async (id: string, before: any, count: number) => {
    const after = await preview(id);
    if (after.seq !== before.seq || JSON.stringify(after.value) !== JSON.stringify(before.value))
      await writeFile(join(output, "failure-last-unchanged.json"), JSON.stringify({
        before,
        after,
        localUpdates: a.updates.length - count,
        peerUpdates: b.updates.length,
      }, null, 2));
    assert.equal(after.seq, before.seq);
    assert.deepEqual(after.value, before.value);
    assert.equal(a.updates.length, count);
    assert.equal(b.updates.length, 0);
  };
  const captureKeyboardDiagnostic = async (page: Page, label: string) => {
    if (!keyboardDiagnostic) return;
    const state = await page.evaluate(`(() => { const el = document.activeElement; return { url: location.href, documentHasFocus: document.hasFocus(), visibilityState: document.visibilityState, active: el ? { tag: el.tagName, className: el.getAttribute('class'), ariaLabel: el.getAttribute('aria-label'), title: el.getAttribute('title'), insideCanvas: !!el.closest('.canvas-app'), html: el.outerHTML.slice(0, 1000) } : null, events: window.__qaCanvasKeyboardEvents ?? [] }; })()`);
    await writeFile(join(output, label + "-keyboard.json"), JSON.stringify(state, null, 2));
  };
  const undoRedo = async (id: string, before: any, after: any, steps = 1) => {
    await captureKeyboardDiagnostic(a.page, id + "-before-undo");
    for (let step = 0; step < steps; step++)
      await a.page.keyboard.press("ControlOrMeta+z");
    await captureKeyboardDiagnostic(a.page, id + "-after-undo-keys");
    await until(
      async () =>
        JSON.stringify((await preview(id)).value) ===
        JSON.stringify(before.value),
      "native undo",
    );
    await a.page.mouse.move(1300, 800);
    await delay(350);
    for (let step = 0; step < steps; step++)
      await a.page.keyboard.press("ControlOrMeta+Shift+z");
    await until(
      async () =>
        JSON.stringify((await preview(id)).value) ===
        JSON.stringify(after.value),
      "native redo after idle",
    );
  };
  const reload = async (id: string, value: any) => {
    await a.page.reload();
    await a.page.locator(".canvas-host").waitFor();
    await saved(a.page);
    assert.deepEqual((await preview(id)).value, value);
  };
  const downloadCanvas = async (page: Page, format: string, basename = "canvas-download") => {
    // SVG warnings remain until dismissed and can overlap the host's export
    // menu. Dismiss prior feedback through its real button before a new action;
    // this download's own warning remains available to the export assertions.
    await dismissFeedback(page);
    await page.getByLabel("文档信息与更多操作", { exact: true }).click();
    const submenu = page.locator("#document-export-slot .document-submenu");
    await submenu.locator("summary").click();
    const pending = page.waitForEvent("download");
    await submenu.getByRole("button", { name: format.toUpperCase() + " 图片", exact: true }).click();
    const file = await pending;
    const path = join(output, basename + "." + format);
    await file.saveAs(path);
    await page.keyboard.press("Escape");
    // Dismiss through a view-only control; two rapid blank-canvas clicks can
    // legitimately create a text object, independently of an export.
    await page.getByRole("button", { name: "选择 (V / 1)", exact: true }).click();
    return readFile(path);
  };
  const stages = new Set(
    (
      process.argv.find((arg) => arg.startsWith("--stages="))?.slice(9) ??
      "legacy,multi,containers,line,ports,table,note,label,keys,dense,remote,lists,export,menu,mention,idle"
    ).split(","),
  );
  const run = async (
    name: string,
    rows: number[],
    work: () => Promise<void>,
  ) => {
    if (!stages.has(name)) return;
    try {
      await work();
      await rm(join(output, "failure-" + name + ".png"), { force: true });
      await rm(join(output, "failure-" + name + ".txt"), { force: true });
      await rm(join(output, "failure-" + name + "-runtime.json"), { force: true });
      checks.push({ stage: name, rows, result: "passed" });
      console.log("PASS", name, rows.join(","));
    } catch (error) {
      resetBeforeStage = true;
      checks.push({
        stage: name,
        rows,
        result: "failed",
        error: String(error),
      });
      console.error("FAIL", name, error);
      await a.page.mouse.up().catch(() => {});
      await a.page.keyboard.up("Shift").catch(() => {});
      await a.page
        .screenshot({ path: join(output, "failure-" + name + ".png") })
        .catch(() => {});
      await runtime(a.page)
        .then((state) =>
          writeFile(
            join(output, "failure-" + name + "-runtime.json"),
            JSON.stringify(state, null, 2),
          ),
        )
        .catch(() => {});
      await captureKeyboardDiagnostic(a.page, "failure-" + name).catch(() => {});
      await writeFile(join(output, "failure-" + name + ".txt"), String(error));
    }
    await writeFile(
      join(output, "results.json"),
      JSON.stringify(
        { canvasVersion: packageVersions["@smartdoca/canvas"], checks, errors },
        null,
        2,
      ),
    );
  };
  await run("preflight", [], async () => {
    const id = await seed("legacy"),
      before = await preview(id),
      view = (await runtime(a.page, "legacy-diagram")).found;
    assert(view && view.width === 420);
    assert.equal(
      view.children.find((n: any) => n.id === "legacy-body").width,
      420,
    );
    assert.equal(a.updates.length, 0);
    assert.equal(b.updates.length, 0);
    assert.deepEqual((await preview(id)).value, before.value);
    const point = await xy(a.page, 350, 240);
    assert(Number.isFinite(point.x) && Number.isFinite(point.y));
    await a.page.mouse.click(point.x, point.y);
    await selected(a.page, "legacy-diagram");
    assert.equal(a.updates.length, 0);
    console.log(
      "Installed engine readback and isolated fixture preflight only",
      packageVersions["@smartdoca/canvas"],
    );
  });
  await run("legacy", [27, 38, 39], async () => {
    const id = await seed("legacy"),
      before = await preview(id),
      count = a.updates.length;
    await click(a.page, 350, 240);
    await selected(a.page, "legacy-diagram");
    const view = (await runtime(a.page, "legacy-diagram")).found;
    assert.equal(view.fill, "transparent");
    assert(!view.children.some((child: any) => child.name === "frame-title"));
    assert.equal(
      view.children.find((child: any) => child.id === "legacy-body").width,
      420,
    );
    assert.equal(
      view.children.find((child: any) => child.id === "legacy-body").height,
      240,
    );
    assert.equal(
      view.children.find((child: any) => child.id === "legacy-text").width,
      392,
    );
    assert.equal(
      await a.page
        .locator('[data-node-id="legacy-diagram"].graph-port')
        .count(),
      12,
    );
    await a.page.setViewportSize({ width: 1480, height: 920 });
    await delay(100);
    await unchanged(id, before, count);
    await a.page.screenshot({ path: join(output, "legacy-view-only.png") });
    await drag(a.page, { x: 580, y: 360 }, 100, 80);
    await until(
      async () => node((await preview(id)).value, "legacy-diagram").width > 420,
      "legacy explicit resize",
    );
    const after = await preview(id),
      resized = node(after.value, "legacy-diagram");
    assert.equal(node(after.value, "legacy-body").width, resized.width);
    assert.equal(node(after.value, "legacy-text").width, resized.width - 28);
    await peer("legacy-diagram", {
      width: resized.width,
      height: resized.height,
    });
    await undoRedo(id, before, after);
    await reload(id, after.value);
    await a.page.setViewportSize({ width: 1600, height: 1000 });
    const databaseId = await seed("legacy-database"), databaseBefore = await preview(databaseId), databaseCount = a.updates.length;
    const databaseView = (await runtime(a.page, "legacy-db-table")).found;
    assert.equal(databaseView.fill, "transparent");
    assert(!databaseView.children.some((child: any) => child.name === "frame-title"));
    assert.equal(databaseView.children.find((child: any) => child.id === "legacy-db-body").width, 420);
    await unchanged(databaseId, databaseBefore, databaseCount);
    // The original generated title stays stored; display suppression is not a
    // scene migration or a baseline rewrite.
    assert.equal(node(databaseBefore.value, "legacy-db-title").text, "Frame");
    await click(a.page, 350, 220);
    await selected(a.page, "legacy-db-table");
    await drag(a.page, { x: 580, y: 360 }, 100, 60);
    await until(async () => node((await preview(databaseId)).value, "legacy-db-table").width > 420, "database wrapper native resize");
    const databaseResized = await preview(databaseId), databaseFrame = node(databaseResized.value, "legacy-db-table");
    assert.equal(node(databaseResized.value, "legacy-db-body").width, databaseFrame.width);
    assert.equal(node(databaseResized.value, "legacy-db-text").width, databaseFrame.width - 28);
    await peer("legacy-db-table", { width: databaseFrame.width, height: databaseFrame.height });
    await undoRedo(databaseId, databaseBefore, databaseResized);
    const at = await xy(a.page, databaseFrame.x + databaseFrame.width / 2, databaseFrame.y + 70);
    await a.page.mouse.dblclick(at.x, at.y);
    const editor = a.page.locator(".canvas-plain-text-editor");
    await editor.waitFor();
    await editor.fill("video_books\nid (primary key)\ndata\nowner_id\nreviewed_column");
    await a.page.keyboard.press("Escape");
    await until(async () => node((await preview(databaseId)).value, "legacy-db-text").text.includes("reviewed_column"), "database diagram continued native edit");
    const databaseEdited = await preview(databaseId);
    await peer("legacy-db-text", { text: node(databaseEdited.value, "legacy-db-text").text });
    assert.equal(node(databaseEdited.value, "legacy-db-title").text, "Frame");
    await reload(databaseId, databaseEdited.value);
    const beforeExport = await preview(databaseId), exportCount = a.updates.length;
    const databaseSvg = (await downloadCanvas(a.page, "svg", "legacy-database-export")).toString("utf8");
    await unchanged(databaseId, beforeExport, exportCount);
    await a.page.screenshot({ path: join(output, "legacy-database-continued-export.png") });
    assert(databaseSvg.includes("video_books") && databaseSvg.includes("reviewed_column"));
    const outerFill = await a.page.evaluate((svg) => new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("g > path")?.getAttribute("fill"), databaseSvg);
    checks.push({ metric: "continued legacy database export", originalGeneratedTitleRetainedInModel: node(beforeExport.value, "legacy-db-title").text === "Frame", generatedTitleInSvg: />Frame<\/tspan>/.test(databaseSvg), outerFill });
    assert(!/>Frame<\/tspan>/.test(databaseSvg), "generated Frame title must stay suppressed in exported legacy diagram");
    assert(["transparent", "none"].includes(outerFill ?? ""), "exported legacy wrapper must match its transparent live view");
  });
  await run("multi", [43, 39], async () => {
    const id = await seed("diagrams");
    // Keep both clicks away from the editable label and native resize handles.
    await click(a.page, 515, 310);
    await a.page.keyboard.down("Shift");
    await click(a.page, 975, 510);
    await a.page.keyboard.up("Shift");
    await until(
      async () => (await runtime(a.page)).selection.length === 2,
      "two diagram selection",
    );
    const bar = a.page.locator(".selection-actions");
    await bar.getByRole("combobox", { name: "线宽", exact: true }).click();
    await a.page.getByRole("option", { name: "6", exact: true }).click();
    await until(async () => {
      const value = (await preview(id)).value;
      return ["qa-first-body", "qa-second-body"].every(
        (key) => node(value, key).strokeWidth === 6,
      );
    }, "both diagram outline widths");
    const beforeDash = await preview(id);
    await bar.getByRole("button", { name: "线条样式", exact: true }).click();
    await a.page.getByRole("button", { name: "虚线", exact: true }).click();
    await until(async () => {
      const value = (await preview(id)).value;
      return ["qa-first-body", "qa-second-body"].every(
        (key) => JSON.stringify(node(value, key).dashPattern) === "[8,5]",
      );
    }, "both diagram dash patterns");
    const after = await preview(id);
    for (const key of ["qa-first-body", "qa-second-body"])
      await peer(key, { strokeWidth: 6, dashPattern: [8, 5] });
    await a.page.keyboard.press("Escape");
    await a.page.locator(".canvas-app").focus();
    await undoRedo(id, beforeDash, after);
    await reload(id, after.value);
    await a.page.screenshot({ path: join(output, "two-diagram-outline.png") });
  });
  await run("containers", [15, 38], async () => {
    const id = await seed("containers");
    for (const [key, start, delta] of [
      ["qa-phone", { x: 198, y: 250 }, { x: 50, y: 40 }],
      ["qa-web", { x: 642, y: 210 }, { x: 45, y: 55 }],
    ] as const) {
      const before = await preview(id),
        original = node(before.value, key);
      await click(a.page, start.x, start.y);
      await selected(a.page, key);
      await unchanged(id, before, a.updates.length);
      // A selected Frame's outline is its resize target. Start this movement
      // gesture from an unselected border, as the native container UI intends.
      await a.page.getByRole("button", { name: "手型工具 (H / Space)", exact: true }).click();
      await a.page.getByRole("button", { name: "选择 (V / 1)", exact: true }).click();
      assert.deepEqual((await runtime(a.page)).selection, []);
      await drag(a.page, start, delta.x, delta.y);
      await until(
        async () => node((await preview(id)).value, key).x !== original.x,
        "container border moves parent " + key,
      );
      const after = await preview(id),
        moved = node(after.value, key);
      checks.push({ metric: "container native move", key, start, delta,
        before: { x: original.x, y: original.y, width: original.width, height: original.height },
        after: { x: moved.x, y: moved.y, width: moved.width, height: moved.height } });
      assert(Math.abs(moved.x - original.x - delta.x) < 1);
      assert(Math.abs(moved.y - original.y - delta.y) < 1);
      assert.equal(moved.width, original.width);
      assert.equal(moved.height, original.height);
      for (const contentId of key === "qa-phone"
        ? ["qa-phone-content"]
        : ["qa-nested", "qa-nested-content"]) {
        const childBefore = node(before.value, contentId),
          childAfter = node(after.value, contentId);
        assert.equal(childAfter.x, childBefore.x);
        assert.equal(childAfter.y, childBefore.y);
      }
      await peer(key, { x: moved.x, y: moved.y });
    }
    const beforeNested = await preview(id),
      web = node(beforeNested.value, "qa-web"),
      nested = node(beforeNested.value, "qa-nested");
    const at = {
      x: web.x + nested.x + 18,
      y: web.y + nested.y + 42,
    };
    await click(a.page, at.x, at.y);
    await selected(a.page, "qa-nested");
    await a.page.getByRole("button", { name: "手型工具 (H / Space)", exact: true }).click();
    await a.page.getByRole("button", { name: "选择 (V / 1)", exact: true }).click();
    await drag(a.page, at, 45, 25);
    await until(
      async () => node((await preview(id)).value, "qa-nested").x !== nested.x,
      "nested border drag",
    );
    const final = await preview(id);
    assert.equal(node(final.value, "qa-web").x, web.x);
    assert.equal(
      node(final.value, "qa-nested-content").x,
      node(beforeNested.value, "qa-nested-content").x,
    );
    await peer("qa-nested", {
      x: node(final.value, "qa-nested").x,
      y: node(final.value, "qa-nested").y,
    });
    await reload(id, final.value);
    await a.page.screenshot({
      path: join(output, "container-borders-nested-follow.png"),
    });
    const phone = node(final.value, "qa-phone"), viewBefore = await preview(id), viewUpdates = a.updates.length;
    const samples = [
      { side: "left", x: phone.x + 4, y: phone.y + phone.height / 2 },
      { side: "right", x: phone.x + phone.width - 4, y: phone.y + phone.height / 2 },
      { side: "top", x: phone.x + phone.width / 2, y: phone.y + 3 },
      { side: "bottom", x: phone.x + phone.width / 2, y: phone.y + phone.height - 3 },
    ];
    const sharp = (await import("sharp")).default;
    const live = await sharp(await a.page.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const png = await sharp(await downloadCanvas(a.page, "png", "container-phone")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const svg = (await downloadCanvas(a.page, "svg", "container-phone")).toString("utf8");
    const svgView = await a.page.evaluate(source => {
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      return { box: doc.documentElement.getAttribute("viewBox")!.split(/[ ,]+/).map(Number),
        evenOddPaths: doc.querySelectorAll('path[fill-rule="evenodd"]').length };
    }, svg);
    assert(svgView.evenOddPaths > 0, "Phone SVG contains its derived even-odd bezel");
    const darkPixels = (data: Buffer, info: { width: number; height: number; channels: number }, x: number, y: number) => {
      let dark = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= info.width || py >= info.height) continue;
        const at = (py * info.width + px) * info.channels;
        const rgb = [data[at]!, data[at + 1]!, data[at + 2]!];
        if (Math.max(...rgb) < 160 && Math.max(...rgb) - Math.min(...rgb) < 45 && data[at + 3]! > 200) dark++;
      }
      return dark;
    };
    const pixelEvidence = [];
    for (const sample of samples) {
      const screen = await xy(a.page, sample.x, sample.y);
      const liveDark = darkPixels(live.data, live.info, screen.x, screen.y);
      const pngDark = darkPixels(png.data, png.info,
        (sample.x - svgView.box[0]!) * png.info.width / svgView.box[2]!,
        (sample.y - svgView.box[1]!) * png.info.height / svgView.box[3]!);
      pixelEvidence.push({ ...sample, screen, liveDark, pngDark });
      assert(liveDark > 0 && pngDark > 0, `Phone ${sample.side} bezel is actually painted in host and PNG`);
    }
    checks.push({ metric: "host Phone visible bezel and PNG/SVG", pixelEvidence, svgView });
    await unchanged(id, viewBefore, viewUpdates);
    await mode(b.page, "阅读");
    const unchangedBefore = await preview(id),
      updates = a.updates.length;
    await drag(b.page, { x: 185, y: 353 }, 60, 50);
    await delay(200);
    await unchanged(id, unchangedBefore, updates);
    await mode(b.page, "编辑");
  });
  await run("line", [30, 38, 39], async () => {
    const id = await seed("line"),
      before = await preview(id),
      count = a.updates.length;
    await drag(a.page, { x: 420, y: 294 }, 96, -48, false);
    const painted = names((await runtime(a.page)).nodes).filter(
      (n: any) => n.name === "connector-drag-preview",
    );
    assert.equal(painted.length, 1);
    assert.notEqual(painted[0].path, node(before.value, "qa-unbound").path);
    assert.equal(
      await a.page.locator(".graph-gesture-preview path").count(),
      0,
    );
    await unchanged(id, before, count);
    assert.deepEqual((await runtime(b.page, "qa-unbound")).found.data.from, {
      x: 300,
      y: 240,
    });
    await a.page.screenshot({
      path: join(output, "line-entire-live-preview.png"),
    });
    await a.page.mouse.up();
    await until(
      async () => (await preview(id)).seq === before.seq + 1,
      "line release one durable transaction",
    );
    const after = await preview(id),
      line = node(after.value, "qa-unbound");
    assert.deepEqual(line.data.from, { x: 396, y: 192 });
    assert.deepEqual(line.data.to, { x: 796, y: 372 });
    assert.equal(a.updates.length, count + 1);
    await peer("qa-unbound", { data: line.data });
    await undoRedo(id, before, after);
    const current = await preview(id),
      updates = a.updates.length;
    await drag(a.page, { x: 516, y: 246 }, 70, 35, false);
    await a.page.keyboard.press("Escape");
    await a.page.mouse.up();
    await delay(200);
    await unchanged(id, current, updates);
    await reload(id, after.value);
  });
  await run("ports", [24, 31], async () => {
    const id = await seed("ports"),
      before = await preview(id),
      count = a.updates.length;
    await click(a.page, 410, 260);
    await selected(a.page, "qa-source");
    const ports = a.page.locator('.graph-port[data-node-id="qa-source"]');
    assert.equal(await ports.count(), 12);
    const anchors = await ports.evaluateAll((items) =>
      items.map((item) =>
        [
          item.getAttribute("data-port-x"),
          item.getAttribute("data-port-y"),
        ].join(","),
      ),
    );
    assert.equal(new Set(anchors).size, 12);
    const port = a.page.locator(
      '.graph-port[data-node-id="qa-source"][data-port-x="1"][data-port-y="0.5"]',
    );
    await port.click();
    await delay(250);
    await unchanged(id, before, count);
    const clickBox = await port.boundingBox();
    assert(clickBox);
    const clickPoint = { x: clickBox.x + clickBox.width / 2, y: clickBox.y + clickBox.height / 2 };
    await a.page.mouse.move(clickPoint.x, clickPoint.y);
    await a.page.mouse.down();
    await a.page.mouse.move(clickPoint.x + 1, clickPoint.y + 1);
    await a.page.mouse.up();
    assert.equal(await a.page.locator(".graph-gesture-preview path").count(), 0);
    await unchanged(id, before, count);
    await a.page.mouse.move(clickPoint.x, clickPoint.y);
    await a.page.mouse.down();
    await a.page.mouse.move(clickPoint.x + 40, clickPoint.y + 30, { steps: 6 });
    assert((await a.page.locator(".graph-gesture-preview path").count()) > 0);
    await unchanged(id, before, count);
    await a.page.keyboard.press("Escape");
    await a.page.mouse.up();
    await unchanged(id, before, count);
    assert.equal(
      names((await preview(id)).value.scene.children).filter(
        (n) => n.data?.kind === "connector",
      ).length,
      0,
    );
    await a.page.keyboard.press("Escape");
    await click(a.page, 410, 260);
    const bounds = await port.boundingBox();
    assert(bounds);
    const target = await xy(a.page, 760, 260);
    await a.page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await a.page.mouse.down();
    await a.page.mouse.move(target.x, target.y, { steps: 15 });
    await a.page.mouse.up();
    await until(
      async () =>
        names((await preview(id)).value.scene.children).some(
          (n) => n.data?.kind === "connector",
        ),
      "port drag creates connector",
    );
    const after = await preview(id),
      line = names(after.value.scene.children).find(
        (n) => n.data?.kind === "connector",
      );
    assert.equal(line.data.sourceId, "qa-source");
    assert.equal(line.data.targetId, "qa-target");
    assert.equal(after.seq, before.seq + 1);
    await peer(line.id, { data: line.data });
    // Test quarter ports independently: each gesture must preserve both exact
    // endpoint anchors rather than snapping every edge to the side midpoint.
    let final = after;
    for (const fraction of [0.25, 0.75]) {
      await a.page.keyboard.press("Escape");
      await click(a.page, 410, 260);
      const from = a.page.locator(
          `.graph-port[data-node-id="qa-source"][data-port-x="1"][data-port-y="${fraction}"]`,
        ),
        fromBox = await from.boundingBox();
      assert(fromBox);
      const to = await xy(a.page, 760, 200 + fraction * 120),
        previous = final;
      await a.page.mouse.move(
        fromBox.x + fromBox.width / 2,
        fromBox.y + fromBox.height / 2,
      );
      await a.page.mouse.down();
      await a.page.mouse.move(to.x, to.y, { steps: 16 });
      await a.page.mouse.up();
      await until(
        async () => (await preview(id)).seq === previous.seq + 1,
        "quarter port single transaction",
      );
      final = await preview(id);
      const previousIds = new Set(
          names(previous.value.scene.children).map((item) => item.id),
        ),
        edge = names(final.value.scene.children).find(
          (item) =>
            item.data?.kind === "connector" && !previousIds.has(item.id),
        );
      assert(edge);
      assert.deepEqual(edge.data.sourceAnchor, { x: 1, y: fraction });
      assert.deepEqual(edge.data.targetAnchor, { x: 0, y: fraction });
      await peer(edge.id, { data: edge.data });
    }
    assert.equal(a.updates.length, count + 3);
    await reload(id, final.value);
    await a.page.screenshot({
      path: join(output, "port-click-versus-drag.png"),
    });
    for (const shape of ["ellipse", "diamond"]) {
      const shapeId = await seed("ports-" + shape);
      await click(a.page, 410, 260);
      await selected(a.page, "qa-source");
      const outlinePorts = a.page.locator('.graph-port[data-node-id="qa-source"]');
      const checkOutline = async (frame: any, scenario: string) => {
        const center = await xy(a.page, frame.x + frame.width / 2, frame.y + frame.height / 2);
        const right = await xy(a.page, frame.x + frame.width, frame.y + frame.height / 2);
        const bottom = await xy(a.page, frame.x + frame.width / 2, frame.y + frame.height);
        const boxes = await outlinePorts.evaluateAll((items) => items.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }));
        assert.equal(boxes.length, 12);
        const norms = boxes.map((point) => {
          const x = (point.x - center.x) / (right.x - center.x), y = (point.y - center.y) / (bottom.y - center.y);
          return shape === "ellipse" ? x * x + y * y : Math.abs(x) + Math.abs(y);
        });
        assert(norms.every((norm) => Math.abs(norm - 1) < 0.035), `${shape} ports must follow the visible outline ${scenario}`);
        checks.push({ metric: "curved outline ports", shape, scenario, normalizedOutlineDistances: norms });
      };
      const shapeBefore = await preview(shapeId), shapeCount = a.updates.length;
      await checkOutline(node(shapeBefore.value, "qa-source"), "before resize");
      await unchanged(shapeId, shapeBefore, shapeCount);
      await drag(a.page, { x: 520, y: 320 }, 60, 40);
      await until(async () => node((await preview(shapeId)).value, "qa-source").width > 220, `${shape} native resize`);
      const shapeAfter = await preview(shapeId), resized = node(shapeAfter.value, "qa-source");
      await checkOutline(resized, "after resize");
      await peer("qa-source", { width: resized.width, height: resized.height });
      await undoRedo(shapeId, shapeBefore, shapeAfter);
      await reload(shapeId, shapeAfter.value);
    }
  });
  await run("table", [32, 38, 39, 41], async () => {
    const id = await seed("table");
    await click(a.page, 465, 245);
    const handle = a.page.locator(".rich-object-move-handle");
    await handle.waitFor();
    const first = await handle.boundingBox();
    assert(first);
    const before = await preview(id),
      count = a.updates.length;
    const corner = await xy(a.page, 460, 240), handleOffset = { x: corner.x - first.x, y: corner.y - first.y };
    const verifyHandleCorner = async (scenario: string) => {
      const corner = await xy(a.page, 460, 240), box = await handle.boundingBox();
      assert(box);
      assert(Math.abs(corner.x - box.x - handleOffset.x) < 2 && Math.abs(corner.y - box.y - handleOffset.y) < 2, `table handle follows the actual top-left corner ${scenario}`);
      checks.push({ metric: "table handle corner", scenario, corner, handle: box });
      return box;
    };
    await handle.hover();
    await a.page.mouse.wheel(80, 0);
    await delay(200);
    const panned = await handle.boundingBox();
    assert(panned);
    assert(Math.abs(panned.x - first.x) > 30);
    await verifyHandleCorner("horizontal viewport pan");
    await a.page.mouse.wheel(-80, 0);
    await delay(200);
    await unchanged(id, before, count);
    for (let zoom = 0; zoom < 2; zoom++) await a.page.getByRole("button", { name: "放大", exact: true }).click();
    await delay(100);
    await verifyHandleCorner("zoomed");
    for (let zoom = 0; zoom < 2; zoom++) await a.page.getByRole("button", { name: "缩小", exact: true }).click();
    await a.page.locator(".canvas-host").hover({ position: { x: 1200, y: 700 } });
    // The native wheel handler caps each packet; move the actual table corner
    // out of view with several real packets rather than assuming one large delta.
    let panPackets = 0;
    while ((await xy(a.page, 460, 240)).x >= -50 && panPackets < 24) {
      await a.page.mouse.wheel(150, 0);
      await delay(100);
      panPackets++;
    }
    const offscreenHandle = await verifyHandleCorner("table corner outside viewport");
    assert(offscreenHandle.x < 0, "handle must not clamp to the viewport's upper-left edge");
    for (let step = 0; step < panPackets; step++) {
      await a.page.mouse.wheel(-150, 0);
      await delay(100);
    }
    await unchanged(id, before, count);
    const box = await handle.boundingBox();
    assert(box);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const move = async () => {
      await a.page.mouse.move(start.x, start.y);
      await a.page.mouse.down();
      await a.page.mouse.move(start.x + 180, start.y + 140, { steps: 12 });
    };
    await move();
    const painted = names((await runtime(a.page)).nodes).filter(
      (n: any) => n.name === "object-drag-preview",
    );
    const table = painted.find((n) => n.data?.kind === "table"),
      line = painted.find((n) => n.data?.kind === "connector");
    assert(table);
    assert(Math.abs(table.x - 640) < 1 && Math.abs(table.y - 380) < 1);
    assert(names(table.children).some((n) => n.text === "项目"));
    assert(line && line.path !== node(before.value, "qa-table-line").path);
    assert.equal(await a.page.locator(".rich-object-drag-preview").count(), 0);
    await unchanged(id, before, count);
    await a.page.screenshot({
      path: join(output, "table-entire-live-preview.png"),
    });
    await a.page.keyboard.press("Escape");
    await a.page.mouse.up();
    await unchanged(id, before, count);
    await move();
    await a.page.mouse.up();
    await until(
      async () => (await preview(id)).seq === before.seq + 1,
      "table release one transaction",
    );
    const after = await preview(id),
      moved = node(after.value, "qa-table");
    assert(Math.abs(moved.x - 640) < 1 && Math.abs(moved.y - 380) < 1);
    assert.equal(a.updates.length, count + 1);
    await peer("qa-table", { x: moved.x, y: moved.y });
    await undoRedo(id, before, after);
    await reload(id, after.value);
  });
  await run("note", [52, 39], async () => {
    const id = await seed("note");
    await click(a.page, 520, 350);
    await selected(a.page, "qa-note");
    const before = await preview(id);
    await a.page
      .locator(".selection-actions")
      .getByRole("button", { name: "文本对齐", exact: true })
      .click();
    const menu = a.page.getByRole("menu", { name: "文本对齐", exact: true });
    await menu.getByRole("button", { name: "左对齐", exact: true }).click();
    await menu.getByRole("button", { name: "顶部对齐", exact: true }).click();
    await until(async () => {
      const label = node((await preview(id)).value, "qa-note-label");
      return label.textAlign === "left" && label.verticalAlign === "top";
    }, "both alignment commands durably committed");
    const after = await preview(id);
    assert.equal(
      (await runtime(a.page, "qa-note-label")).found.textAlign,
      "left",
    );
    assert.equal(
      (await runtime(a.page, "qa-note-label")).found.verticalAlign,
      "top",
    );
    await a.page.keyboard.press("Escape");
    await a.page.locator(".canvas-app").focus();
    await undoRedo(id, before, after, after.seq - before.seq);
    await click(a.page, 520, 350);
    const editor = a.page.locator("[data-slate-editor]");
    if (!(await editor.count())) {
      await delay(500);
      await click(a.page, 520, 350);
    }
    await editor.waitFor();
    assert.equal(
      await editor.evaluate((el) => getComputedStyle(el).textAlign),
      "left",
    );
    await a.page.keyboard.insertText("Alignment QA");
    await a.page.keyboard.press("Escape");
    await until(
      async () =>
        JSON.stringify((await preview(id)).value).includes("Alignment QA"),
      "aligned empty note native text commit",
    );
    const final = await preview(id);
    await peer("qa-note-label", {
      text: "Alignment QA",
      textAlign: "left",
      verticalAlign: "top",
    });
    await reload(id, final.value);
    await a.page.screenshot({ path: join(output, "empty-note-left-top.png") });
    for (const width of [760, 390]) {
      await a.page.setViewportSize({ width, height: 720 });
      await a.page.locator(".canvas-app").focus();
      await a.page.keyboard.press("Shift+Digit1");
      await delay(150);
      await click(a.page, 350, 220);
      await selected(a.page, "qa-note");
      await a.page.locator(".selection-actions").getByRole("button", { name: "文本对齐", exact: true }).click();
      const narrowMenu = a.page.getByRole("menu", { name: "文本对齐", exact: true });
      await narrowMenu.getByRole("button", { name: "居中", exact: true }).click();
      await narrowMenu.getByRole("button", { name: "垂直居中", exact: true }).click();
      await until(async () => {
        const label = node((await preview(id)).value, "qa-note-label");
        return label.textAlign === "center" && label.verticalAlign === "middle";
      }, "narrow note centered before explicit left/top");
      const centered = await preview(id);
      for (const label of ["左对齐", "顶部对齐"]) {
        const button = narrowMenu.getByRole("button", { name: label, exact: true });
        assert(await button.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }), `${width}px alignment action is visible and really receives pointer events`);
        await button.click();
      }
      await until(async () => {
        const label = node((await preview(id)).value, "qa-note-label");
        return label.textAlign === "left" && label.verticalAlign === "top";
      }, "narrow note explicit left/top");
      const aligned = await preview(id);
      await a.page.screenshot({ path: join(output, `note-left-top-menu-${width}.png`) });
      await a.page.keyboard.press("Escape");
      await a.page.locator(".canvas-app").focus();
      await undoRedo(id, centered, aligned, aligned.seq - centered.seq);
      await peer("qa-note-label", { text: "Alignment QA", textAlign: "left", verticalAlign: "top" });
      await reload(id, aligned.value);
      await a.page.locator(".canvas-app").focus();
      await a.page.keyboard.press("Shift+Digit1");
      await delay(150);
      assert.equal((await runtime(a.page, "qa-note-label")).found.textAlign, "left");
      assert.equal((await runtime(a.page, "qa-note-label")).found.verticalAlign, "top");
      checks.push({ metric: "narrow note left/top", viewportWidth: width, undoSteps: aligned.seq - centered.seq, textRetained: true });
      await a.page.screenshot({ path: join(output, `note-left-top-reloaded-${width}.png`) });
    }
    await a.page.setViewportSize({ width: 1600, height: 1000 });
  });
  await run("label", [25, 28], async () => {
    const id = await seed("label"),
      before = await preview(id),
      count = a.updates.length;
    await click(a.page, 500, 310);
    await delay(550);
    const at = await xy(a.page, 500, 310);
    await a.page.mouse.dblclick(at.x, at.y);
    const input = a.page.locator(".canvas-plain-text-editor");
    await input.waitFor();
    assert.equal(
      await input.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await a.page.evaluate(() => window.getSelection()?.toString()),
      "Label selection sample",
    );
    for (const key of ["Control+a", "Meta+a"]) {
      await a.page.keyboard.press("ArrowRight");
      await a.page.keyboard.press(key);
      assert.equal(
        await a.page.evaluate(() => window.getSelection()?.toString()),
        "Label selection sample",
      );
      assert.equal((await runtime(a.page)).selection.length, 1);
    }
    await unchanged(id, before, count);
    await a.page.screenshot({
      path: join(output, "diagram-label-select-all.png"),
    });
    await a.page.keyboard.insertText("Updated diagram label");
    await a.page.keyboard.press("Escape");
    await until(
      async () =>
        node((await preview(id)).value, "qa-label-node-label").text ===
        "Updated diagram label",
      "plain label edit commits",
    );
    const after = await preview(id);
    await peer("qa-label-node-label", { text: "Updated diagram label" });
    await reload(id, after.value);
    await mode(b.page, "阅读");
    const readonly = await preview(id),
      updates = a.updates.length;
    const point = await xy(b.page, 500, 310);
    await b.page.mouse.dblclick(point.x, point.y);
    assert.equal(
      await b.page
        .locator(".canvas-plain-text-editor,[data-slate-editor]")
        .count(),
      0,
    );
    await unchanged(id, readonly, updates);
    const emptyId = await seed("empty-label"), emptyBefore = await preview(emptyId), emptyCount = a.updates.length;
    const enterEmptyLabel = async () => {
      const point = await xy(a.page, 500, 310);
      await a.page.mouse.dblclick(point.x, point.y);
      await a.page.locator(".canvas-plain-text-editor").waitFor();
    };
    const measureCaret = async (label: string) => {
      const expected = await xy(a.page, 500, 310);
      const actual = await a.page.locator(".canvas-plain-text-editor").evaluate((element) => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
        return { x: box.x, y: box.y, width: box.width, height: box.height, paddingTop: parseFloat(style.paddingTop), lineHeight, display: style.display,
          lineCenterY: box.y + parseFloat(style.borderTopWidth || "0") + parseFloat(style.paddingTop) + lineHeight / 2 };
      });
      checks.push({ metric: "empty native label caret", scenario: label, expectedCenter: expected, actual });
      assert.equal(actual.display, "block");
      assert(Math.abs(actual.lineCenterY - expected.y) < 4, "empty caret line must share the native label's vertical center");
      return actual;
    };
    await click(a.page, 500, 310);
    await delay(550);
    await enterEmptyLabel();
    await measureCaret("100 percent");
    await a.page.screenshot({ path: join(output, "empty-label-caret-centered.png") });
    await a.page.keyboard.press("Escape");
    await a.page.getByRole("button", { name: "放大", exact: true }).click();
    await a.page.getByRole("button", { name: "放大", exact: true }).click();
    await a.page.locator(".canvas-host").hover({ position: { x: 1000, y: 700 } });
    await a.page.mouse.wheel(80, 40);
    await delay(150);
    await enterEmptyLabel();
    const beforeTyping = await measureCaret("zoomed and panned");
    await unchanged(emptyId, emptyBefore, emptyCount);
    await a.page.keyboard.insertText("Caret QA");
    const glyph = await a.page.locator(".canvas-plain-text-editor").evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    assert(glyph.height > 0 && Math.abs(glyph.y + glyph.height / 2 - beforeTyping.lineCenterY) < 5, "typed text must use the empty caret's same line");
    await a.page.screenshot({ path: join(output, "empty-label-real-text-zoom-pan.png") });
    await a.page.keyboard.press("Escape");
    await until(async () => node((await preview(emptyId)).value, "qa-label-node-label").text === "Caret QA", "empty label actual input commit");
    const typed = await preview(emptyId);
    await peer("qa-label-node-label", { text: "Caret QA", verticalAlign: "middle" });
    await reload(emptyId, typed.value);
    await mode(b.page, "阅读");
    assert.equal((await runtime(b.page, "qa-label-node-label")).found.verticalAlign, "middle");
  });
  await run("keys", [13, 25], async () => {
    const id = await seed("diagrams"),
      before = await preview(id),
      count = a.updates.length;
    await a.page.locator(".canvas-app").focus();
    await a.page.keyboard.press("a");
    assert(
      (
        await a.page.locator(".canvas-stage").getAttribute("data-active-tool")
      )?.startsWith("connector:"),
    );
    await a.page.keyboard.press("Escape");
    for (const key of ["Control+a", "Meta+a"]) {
      await a.page.keyboard.press(key);
      assert.deepEqual(
        new Set((await runtime(a.page)).selection),
        new Set(["qa-first", "qa-second"]),
      );
      await a.page.keyboard.press("Escape");
    }
    // Escape closes active tools/popovers but is not a selection-clear command.
    await click(a.page, 1300, 750);
    assert.deepEqual((await runtime(a.page)).selection, []);
    await a.page.keyboard.press("Control+Meta+a");
    assert.deepEqual((await runtime(a.page)).selection, []);
    assert.equal(
      await a.page.locator(".canvas-stage").getAttribute("data-active-tool"),
      "init",
    );
    await unchanged(id, before, count);
    await click(a.page, 515, 310);
    await selected(a.page, "qa-first");
    const beforeCopy = await preview(id), originalIds = new Set(names(beforeCopy.value.scene.children).map((item) => item.id));
    await a.page.locator(".selection-actions").getByRole("button", { name: "复制", exact: true }).click();
    await until(async () => (await preview(id)).value.scene.children.length === 3, "native diagram copy creates one new root");
    const copied = await preview(id), copiedRoot = copied.value.scene.children.find((item: any) => !originalIds.has(item.id));
    assert(copiedRoot);
    const copyIds = names([copiedRoot]).map((item) => item.id);
    assert(copyIds.every((copyId) => !originalIds.has(copyId)));
    assert.equal(new Set(names(copied.value.scene.children).map((item) => item.id)).size, originalIds.size + copyIds.length);
    await peer(copiedRoot.id, { x: copiedRoot.x, y: copiedRoot.y });
    await a.page.locator(".canvas-app").focus();
    await undoRedo(id, beforeCopy, copied);
    await click(a.page, copiedRoot.x + copiedRoot.width - 5, copiedRoot.y + copiedRoot.height - 10);
    await selected(a.page, copiedRoot.id);
    await a.page.locator(".canvas-app").focus();
    await a.page.keyboard.press("Delete");
    await until(async () => (await preview(id)).value.scene.children.length === 2, "native copied root delete");
    const deleted = await preview(id);
    assert.deepEqual(new Set(names(deleted.value.scene.children).map((item) => item.id)), originalIds);
    await undoRedo(id, copied, deleted);
    await a.page.keyboard.press("ControlOrMeta+z");
    await until(async () => JSON.stringify((await preview(id)).value) === JSON.stringify(copied.value), "native copy/delete chain restores original copy identities");
    await peer(copiedRoot.id, { x: copiedRoot.x, y: copiedRoot.y });
    await reload(id, copied.value);
    checks.push({ metric: "native copied ID lifecycle", originalIds: [...originalIds], copiedIds: copyIds, copyDeleteUndoRedoReload: true });
    await a.page.screenshot({ path: join(output, "copied-native-ids-undo-redo.png") });
  });
  await run("dense", [14, 41], async () => {
    const id = await seed("dense"),
      before = await preview(id),
      count = a.updates.length;
    await click(a.page, 515, 310);
    const framePromise = a.page.evaluate(`new Promise(resolve=>{
      const gaps=[];let last=performance.now(),start=last;
      const tick=now=>{gaps.push(now-last);last=now;if(now-start<3500)requestAnimationFrame(tick);else{gaps.sort((a,b)=>a-b);resolve({samples:gaps.length,p50:gaps[Math.floor(gaps.length*.5)],p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1)});}};
      requestAnimationFrame(tick);
    })`).catch((error) => ({ error: String(error) }));
    const positions: number[] = [];
    for (let step = 0; step < 18; step++) {
      const handles = a.page.locator('.graph-port[data-node-id="qa-source"]');
      let pointer: { x: number; y: number };
      if (step % 3 === 0 && (await handles.count())) {
        await handles.nth(step % 12).hover();
        const box = await handles.nth(step % 12).boundingBox();
        assert(box);
        pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      } else {
        pointer = await xy(a.page, 500 + (step % 5) * 45, 420 + (step % 3) * 32);
        await a.page.mouse.move(pointer.x, pointer.y);
      }
      const first = await xy(a.page, 300, 200);
      await a.page.mouse.wheel(step < 9 ? 24 : -24, 0);
      await delay(120);
      const next = await xy(a.page, 300, 200);
      checks.push({
        metric: "dense wheel packet",
        step,
        fromX: first.x,
        toX: next.x,
        target: await a.page.evaluate((point) => ({
          active: document.activeElement?.tagName,
          target: document.elementFromPoint(point.x, point.y)?.closest("button,.graph-port,.leafer-app-view,.selection-actions")?.className,
        }), pointer),
      });
      assert(
        Math.abs(next.x - first.x) > 10,
        "horizontal wheel must continue across hover hit targets",
      );
      positions.push(next.x);
    }
    const frameTimes = await framePromise;
    await unchanged(id, before, count);
    checks.push({
      metric: "dense horizontal wheel",
      elementCount: fixtures.dense.length,
      positions,
      frameTimes,
      note: "Observed headless Chrome frame gaps; not a hardware-independent FPS guarantee",
    });
    await a.page.screenshot({
      path: join(output, "dense-horizontal-wheel.png"),
    });
  });
  await run("remote", [], async () => {
    const id = await seed("diagrams"),
      before = await preview(id),
      count = a.updates.length;
    await b.page.bringToFront();
    await b.page.getByRole("button", { name: "放大", exact: true }).click();
    await b.page.getByRole("button", { name: "放大", exact: true }).click();
    await b.page
      .locator(".canvas-host")
      .hover({ position: { x: 600, y: 400 } });
    await b.page.mouse.wheel(130, 65);
    await delay(300);
    await a.page.bringToFront();
    await click(a.page, 410, 260);
    const senderPoint = await xy(a.page, 460, 285);
    await a.page.mouse.move(senderPoint.x, senderPoint.y, { steps: 5 });
    const expected = await xy(b.page, 460, 285),
      pointer = b.page.locator('[data-remote-pointer="true"]').first();
    await pointer.waitFor();
    await until(async () => {
      const box = await pointer.boundingBox();
      return Boolean(
        box &&
        Math.abs(box.x - expected.x) < 3 &&
        Math.abs(box.y - expected.y) < 3,
      );
    }, "remote cursor matches recipient zoom and pan transform");
    const actual = await pointer.boundingBox();
    assert(
      a.cursors.some(
        (frame) =>
          frame.selection?.cursor ||
          frame.selection?.presence?.cursor ||
          JSON.stringify(frame).includes("cursor"),
      ),
    );
    checks.push({
      metric: "remote pointer",
      senderScene: { x: 460, y: 285 },
      expectedClient: expected,
      actualClient: actual,
      latestCursor: a.cursors.at(-1),
    });
    await b.page.screenshot({
      path: join(output, "remote-cursor-zoom-pan.png"),
    });
    await mode(b.page, "阅读");
    assert.equal(await b.page.locator("[data-remote-pointer]").count(), 0);
    await unchanged(id, before, count);
    await mode(b.page, "编辑");
  });
  await run("lists", [29], async () => {
    const id = await seed("lists"),
      before = await preview(id),
      count = a.updates.length;
    await click(a.page, 520, 350);
    await delay(550);
    await click(a.page, 520, 350);
    const editor = a.page.locator("[data-slate-editor]");
    await editor.waitFor();
    assert.deepEqual(
      await editor.locator(".rich-list-marker").allTextContents(),
      ["5.", "a.", "A.", "b.", "6.", "1."],
    );
    const geometry = await editor
      .locator('[data-rich-block="number"]')
      .evaluateAll((items) =>
        items.map((item) => {
          const marker = item
              .querySelector(".rich-list-marker")!
              .getBoundingClientRect(),
            content = item
              .querySelector(".rich-list-content")!
              .getBoundingClientRect();
          return {
            markerX: marker.x,
            markerY: marker.y,
            markerRight: marker.right,
            contentX: content.x,
            contentY: content.y,
            indent: getComputedStyle(item).marginLeft,
          };
        }),
      );
    assert(
      geometry.every(
        (row) =>
          row.contentX > row.markerRight &&
          Math.abs(row.contentY - row.markerY) < 2,
      ),
    );
    assert.equal(geometry[1]!.indent, "22px");
    assert.equal(geometry[2]!.indent, "44px");
    checks.push({ metric: "native note ordered-list geometry", geometry });
    await a.page.screenshot({
      path: join(output, "note-ordered-list-editing.png"),
    });
    await a.page.keyboard.press("Escape");
    await unchanged(id, before, count);
    await reload(id, before.value);
    await a.page.screenshot({
      path: join(output, "note-ordered-list-native.png"),
    });
    const sourceId = await seed("lists-source"), sourceBefore = await preview(sourceId), sourceCount = a.updates.length;
    await click(a.page, 500, 350);
    await delay(550);
    await click(a.page, 500, 350);
    const sourceEditor = a.page.locator("[data-slate-editor]");
    await sourceEditor.waitFor();
    assert.deepEqual(await sourceEditor.locator(".rich-list-marker").allTextContents(), Array.from({ length: 10 }, (_, index) => `${index + 1}.`));
    const sourceGeometry = await sourceEditor.locator('[data-rich-block="number"]').evaluateAll((items) => items.map((item) => {
      const marker = item.querySelector(".rich-list-marker")!, content = item.querySelector(".rich-list-content")!;
      const markerRange = document.createRange(); markerRange.selectNodeContents(marker);
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let first = walker.nextNode();
      while (first && !first.textContent?.trim()) first = walker.nextNode();
      if (!first) throw new Error("List content has no visible text");
      const textRange = document.createRange(); textRange.setStart(first, 0); textRange.setEnd(first, 1);
      const prefix = markerRange.getBoundingClientRect(), glyph = textRange.getBoundingClientRect(), box = content.getBoundingClientRect();
      return { marker: { x: prefix.x, y: prefix.y, right: prefix.right, height: prefix.height }, firstGlyph: { x: glyph.x, y: glyph.y, height: glyph.height }, content: { x: box.x, y: box.y, height: box.height }, markerSize: getComputedStyle(marker).fontSize };
    }));
    for (const row of sourceGeometry) {
      assert(row.firstGlyph.x > row.marker.right, "list text must clear its number");
      assert(Math.abs(row.marker.y - row.firstGlyph.y) < 4, "number and first Chinese text glyph share their first baseline");
    }
    assert(sourceGeometry[3]!.content.height > sourceGeometry[3]!.firstGlyph.height * 1.8, "source-like Chinese list really wraps to multiple lines");
    // Native list rows reserve each marker's intrinsic width. Row29 concerns
    // first-line vertical alignment, including Chinese text and wrapped rows.
    checks.push({ metric: "number9/10 intrinsic marker widths", contentOffset:
      sourceGeometry[9]!.content.x - sourceGeometry[8]!.content.x,
      note: "Recorded horizontal offset; current row layout does not promise a shared gutter" });
    for (const key of ["Control+a", "Meta+a"]) {
      await a.page.keyboard.press(key);
      assert(await sourceEditor.evaluate((element) => {
        const selection = getSelection();
        return Boolean(selection?.anchorNode && selection.focusNode && element.contains(selection.anchorNode) && element.contains(selection.focusNode) && selection.toString().includes("反向代理") && selection.toString().includes("第十项"));
      }), "rich select-all remains inside the native note editor");
      assert.equal((await runtime(a.page)).selection.length, 1);
      await a.page.keyboard.press("ArrowRight");
    }
    checks.push({ metric: "source-like Chinese list1-10, wrapped text and mixed size", sourceGeometry });
    await a.page.screenshot({ path: join(output, "note-source-like-list-editing.png") });
    await a.page.keyboard.press("Escape");
    await unchanged(sourceId, sourceBefore, sourceCount);
    await reload(sourceId, sourceBefore.value);
    await a.page.screenshot({ path: join(output, "note-source-like-list-native.png") });
  });
  await run("export", [36], async () => {
    const id = await seed("label"),
      before = await preview(id),
      count = a.updates.length;
    const download = async (format: string) => {
      const toolBefore = await a.page.locator(".canvas-stage").getAttribute("data-active-tool");
      await a.page.getByLabel("文档信息与更多操作", { exact: true }).click();
      const submenu = a.page.locator("#document-export-slot .document-submenu");
      await submenu.locator("summary").click();
      const pending = a.page.waitForEvent("download");
      await submenu
        .getByRole("button", {
          name: format.toUpperCase() + " 图片",
          exact: true,
        })
        .click();
      const file = await pending;
      const path = join(output, "canvas-download." + format);
      await file.saveAs(path);
      await a.page.keyboard.press("Escape");
      checks.push({ metric: "export tool state", format, toolBefore,
        toolAfter: await a.page.locator(".canvas-stage").getAttribute("data-active-tool") });
      // Dismiss the host menu through a view-only control. A blank-canvas click
      // can legitimately insert content when an insertion tool is still active.
      await a.page.getByRole("button", { name: "选择 (V / 1)", exact: true }).click();
      return readFile(path);
    };
    const png = await download("png");
    const afterPng = await preview(id);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
    assert.equal(
      await a.page
        .getByText(/SVG 未嵌入字体|FONT_NOT_EMBEDDED_SYSTEM_FALLBACK/)
        .count(),
      0,
    );
    const svg = (await download("svg")).toString("utf8");
    await writeFile(join(output, "export-projection.json"), JSON.stringify({
      before,
      afterPng,
      afterSvg: await preview(id),
      localUpdates: a.updates.length - count,
    }, null, 2));
    assert(svg.includes("<svg") && svg.includes("Label selection sample"));
    await a.page
      .getByText(
        "SVG 未嵌入字体，其他设备可能使用替代字体，文字外观可能不同。",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await a.page
        .getByText("FONT_NOT_EMBEDDED_SYSTEM_FALLBACK", { exact: true })
        .count(),
      0,
    );
    await unchanged(id, before, count);
    checks.push({
      metric: "download",
      pngBytes: png.length,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      svgBytes: Buffer.byteLength(svg),
    });
    await a.page.screenshot({
      path: join(output, "svg-font-fallback-warning.png"),
    });
  });
  await run("menu", [37], async () => {
    const id = await seed("diagrams"),
      before = await preview(id),
      count = a.updates.length;
    const choose = async (role: string, name: string) => {
      const option = a.page.getByRole(role as any, { name, exact: true });
      if (!(await option.isVisible()))
        await a.page
          .getByRole("button", { name: "主菜单", exact: true })
          .click();
      await option.click();
    };
    await choose("menuitemradio", "点阵");
    assert.equal(
      await a.page.locator(".canvas-stage").getAttribute("data-grid-pattern"),
      "dots",
    );
    await choose("menuitemradio", "网格");
    assert.equal(
      await a.page.locator(".canvas-stage").getAttribute("data-grid-pattern"),
      "lines",
    );
    await choose("menuitemradio", "背景色 #edf3ff");
    assert.equal(
      await a.page
        .locator(".canvas-app")
        .evaluate((element) =>
          getComputedStyle(element)
            .getPropertyValue("--aidcanvas-background")
            .trim(),
        ),
      "#edf3ff",
    );
    await choose("menuitemcheckbox", "小地图");
    await a.page.locator(".board-minimap").waitFor();
    await choose("menuitemcheckbox", "思维导图大纲");
    await a.page.locator(".board-outline").waitFor();
    await a.page.keyboard.press("Escape");
    await a.page.screenshot({ path: join(output, "native-view-menu.png") });
    await unchanged(id, before, count);
  });
  await run("mention", [40], async () => {
    const id = await seed("note"),
      before = await preview(id),
      count = a.updates.length;
    await click(a.page, 520, 350);
    await delay(550);
    await click(a.page, 520, 350);
    await a.page.locator("[data-slate-editor]").waitFor();
    const lookupCalls: { query: string; requestedAt: number; status?: number; delivery?: string }[] = [];
    const lookupRoute = async (route: import("playwright-core").Route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      const receipt = { query, requestedAt: Date.now() } as (typeof lookupCalls)[number];
      lookupCalls.push(receipt);
      try {
        const response = await route.fetch();
        receipt.status = response.status();
        await delay(query === "Peer" ? 650 : 120);
        await route.fulfill({ response }); receipt.delivery = "fulfilled";
      } catch { receipt.delivery = "cancelled"; }
    };
    await a.page.route("**/api/v1/users/lookup?*", lookupRoute);
    const started = Date.now();
    await a.page.keyboard.insertText("@Peer");
    await a.page.locator(".rich-inline-suggestions [role=status]").waitFor();
    const loadingShownMs = Date.now() - started;
    await until(async () => lookupCalls.some((call) => call.query === "Peer"), "slow actual directory request began");
    await a.page.keyboard.press("Escape");
    assert.equal(await a.page.locator(".rich-inline-suggestions").count(), 0);
    await a.page.keyboard.press("ControlOrMeta+a");
    const latestStarted = Date.now();
    await a.page.keyboard.insertText("@Canvas");
    const option = a.page.getByRole("option", { name: /Canvas QA peer/ });
    await option.waitFor();
    const lookupMs = Date.now() - latestStarted;
    await delay(700);
    assert.equal(await a.page.locator(".rich-inline-suggestions [role=option]").count(), 2, "late cancelled lookup cannot replace current directory choices");
    assert(lookupCalls.every((call) => call.status === 200));
    await a.page.unroute("**/api/v1/users/lookup?*", lookupRoute);
    checks.push({ metric: "native mention loading/cancellation/current lookup", loadingShownMs, latestReplyMs: lookupMs, lookupCalls });
    await writeFile(join(output, "mention-hit-test.json"), JSON.stringify(
      await option.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const chain = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          chain.push({ tag: node.tagName, class: node.className, pointerEvents: style.pointerEvents, zIndex: style.zIndex });
        }
        return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, chain,
          hit: document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2).slice(0, 8).map((node) => ({ tag: node.tagName, class: node.className })) };
      }), null, 2));
    await option.click();
    await a.page
      .locator("[data-slate-editor] .document-user-mention")
      .waitFor();
    await a.page.keyboard.press("Escape");
    await until(
      async () =>
        JSON.stringify((await preview(id)).value).includes(mentionUser.id),
      "mention native commit",
    );
    const mentioned = await preview(id);
    await peer("qa-note-label", {
      data: node(mentioned.value, "qa-note-label").data,
    });
    await a.page.screenshot({
      path: join(output, "note-mention-inserted.png"),
    });
    await a.page.getByRole("button", { name: "选择 (V / 1)", exact: true }).click();
    await click(a.page, 1300, 750);
    await click(a.page, 350, 220);
    await selected(a.page, "qa-note");
    await a.page.locator(".canvas-app").focus();
    await a.page.keyboard.press("Delete");
    await until(
      async () => !find((await preview(id)).value, "qa-note"),
      "whole note delete after mention",
    );
    const deleted = await preview(id);
    assert.equal(deleted.seq, mentioned.seq + 1);
    assert(!find(deleted.value, "qa-note-label"));
    await until(
      async () => !(await runtime(b.page, "qa-note")).found,
      "peer whole note removal",
    );
    await a.page.keyboard.press("ControlOrMeta+z");
    await until(
      async () =>
        JSON.stringify((await preview(id)).value) ===
        JSON.stringify(mentioned.value),
      "undo restores mentioned note",
    );
    await delay(600);
    const after = await preview(id);
    assert.equal(
      a.updates.length - count,
      after.seq - before.seq,
      "one local update per actual document transaction",
    );
    assert.equal(b.updates.length, 0);
    checks.push({
      metric: "host mention",
      lookupMs,
      localUpdates: a.updates.length - count,
      committedSeqs: after.seq - before.seq,
    });
    await reload(id, mentioned.value);
    await a.page.screenshot({
      path: join(output, "note-mention-delete-undo.png"),
    });
  });
  // Supplementary current-model diagnostic; the default acceptance remains the
  // sixteen issue-tracker stages. This preserves the original minimal input.
  await run("minimal-table", [38, 39, 41], async () => {
    const id = await seed("table-minimal-layout-diagnostic");
    const before = await preview(id), count = a.updates.length;
    const originalIds = names(before.value.scene.children).map((item) => item.id);
    assert.equal(node(before.value, "qa-table").data.columnWidths, undefined);
    assert.equal(node(before.value, "qa-table").data.rowHeights, undefined);
    const started = Date.now();
    const leaveCell = async () => {
      await a.page.keyboard.press("Escape");
      await a.page.getByRole("button", { name: "手型工具 (H / Space)", exact: true }).click();
      await a.page.getByRole("button", { name: "选择 (V / 1)", exact: true }).click();
      await saved(a.page);
    };
    for (let step = 0; step < 12; step++) {
      await a.page.bringToFront();
      await click(a.page, 480 + (step % 3) * 140, 260 + (step % 2) * 46);
      await a.page.locator("[data-slate-editor]").waitFor({ state: "visible" });
      await leaveCell();
      await a.page.locator(".canvas-host").hover({ position: { x: 1100, y: 650 } });
      await a.page.mouse.wheel(24, 0);
      await a.page.mouse.wheel(-24, 0);
      await delay(5000);
      await unchanged(id, before, count);
      console.log("MINIMAL_TABLE_IDLE", step + 1, Math.round((Date.now() - started) / 1000));
    }
    assert(Date.now() - started >= 60000);
    await downloadCanvas(a.page, "png", "minimal-table-view-only");
    await downloadCanvas(a.page, "svg", "minimal-table-view-only");
    await unchanged(id, before, count);
    await mode(a.page, "阅读");
    await click(a.page, 480, 260);
    await delay(300);
    await unchanged(id, before, count);
    await mode(a.page, "编辑");
    await click(a.page, 480, 260);
    await a.page.locator("[data-slate-editor]").waitFor({ state: "visible" });
    await a.page.keyboard.press("ControlOrMeta+a");
    await a.page.keyboard.insertText("Minimal table real edit");
    await leaveCell();
    await until(async () => node((await preview(id)).value, "table-cell-0-0-label").text === "Minimal table real edit", "minimal table native edit");
    const edited = await preview(id);
    assert(edited.seq > before.seq);
    assert.deepEqual(names(edited.value.scene.children).map((item) => item.id), originalIds);
    await peer("table-cell-0-0-label", { text: "Minimal table real edit" });
    await a.page.keyboard.press("ControlOrMeta+z");
    await until(async () => node((await preview(id)).value, "table-cell-0-0-label").text === node(before.value, "table-cell-0-0-label").text, "minimal table native undo");
    await a.page.keyboard.press("ControlOrMeta+Shift+z");
    await until(async () => JSON.stringify((await preview(id)).value) === JSON.stringify(edited.value), "minimal table native redo");
    await reload(id, edited.value);
    const reopened = await preview(id), reopenedCount = a.updates.length;
    await click(a.page, 480, 260);
    await a.page.locator("[data-slate-editor]").waitFor({ state: "visible" });
    await leaveCell();
    await unchanged(id, reopened, reopenedCount);
    await a.page.screenshot({ path: join(output, "minimal-table-after-real-edit.png") });
    checks.push({ metric: "legal minimal table", idleSeconds: (Date.now() - started) / 1000, idleSeqChanges: 0, idleWrites: 0, peerWrites: b.updates.length, realEditSeqChanges: edited.seq - before.seq });
  });
  await run("idle", [38, 39, 41], async () => {
    const id = await seed("idle");
    await mode(b.page, "阅读");
    const before = await preview(id),
      count = a.updates.length;
    const started = Date.now();
    for (let step = 0; step < 12; step++) {
      await a.page.bringToFront();
      const point = [
        { x: 350, y: 240 },
        { x: 790, y: 200 },
        { x: 1190, y: 200 },
        { x: 900, y: 378 },
        { x: 170, y: 490 },
        { x: 820, y: 600 },
        { x: 1104, y: 650 },
        { x: 1352, y: 670 },
      ][step % 8]!;
      await click(a.page, point.x, point.y);
      const port = a.page.locator(".graph-handle").first();
      if (await port.count()) await port.hover();
      else await a.page.locator(".canvas-host").hover({ position: point });
      await a.page.mouse.wheel(35, 0);
      await a.page.mouse.wheel(-35, 0);
      await a.page.setViewportSize({
        width: step % 2 ? 1600 : 1480,
        height: step % 2 ? 1000 : 920,
      });
      await b.page.setViewportSize({
        width: step % 2 ? 1500 : 1440,
        height: 900,
      });
      if (step === 0) {
        await a.page
          .getByRole("button", { name: "主菜单", exact: true })
          .click();
        await a.page
          .getByRole("menuitemradio", { name: "点阵", exact: true })
          .click();
      }
      await delay(5000);
      await unchanged(id, before, count);
      console.log("IDLE", step + 1, Math.round((Date.now() - started) / 1000));
    }
    assert(Date.now() - started >= 60000);
    await a.page.screenshot({
      path: join(output, "sixty-second-view-only.png"),
    });
    await reload(id, before.value);
    assert.equal(b.updates.length, 0);
    checks.push({ idleSeconds: (Date.now() - started) / 1000 });
  });
  assert.deepEqual(errors, []);
  const runtimeAfter = await captureRuntimeFingerprint(builtWeb);
  assert.deepEqual(runtimeAfter, runtimeBefore);
  assert(
    checks.every((check) => check.result !== "failed"),
    "Canvas stage failure; see individual receipts",
  );
  await rm(join(output, "failure-last-unchanged.json"), { force: true });
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      { canvasVersion: packageVersions["@smartdoca/canvas"], checks, errors,
        webMode: builtWeb ? "production-build" : "development-server", runtimeBefore, runtimeAfter, runtimeUnchanged: true },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await web?.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
