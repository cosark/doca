// Actual Doca + shipped Slides artifact, with an isolated account/database/store.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
const root = await mkdtemp(join(tmpdir(), "doca-slides-gallery-"));
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
    login: "slidesgallery",
    displayName: "Slides QA user",
    password: "isolated-slides-gallery-2026",
  },
  { bootstrap: true },
);
const port=Number(process.env.DOCA_QA_PORT??39444);
const origin = `http://127.0.0.1:${port}`;
const builtWeb=process.env.DOCA_QA_BUILT_WEB==="1";
const packagePins=JSON.parse(await readFile("package.json","utf8")).dependencies;
const editorPackages=["@smartdoca/canvas","@smartdoca/sheet","@smartdoca/slate","@smartdoca/markdown","@smartdoca/slides"];
const packages=Object.fromEntries(await Promise.all(editorPackages.map(async name=>[name,JSON.parse(await readFile(resolve("node_modules",name,"package.json"),"utf8")).version])));
const receiptScope={scope:"isolated synthetic Doca website/account/documents only",webMode:builtWeb?"production-build":"development-server",productionAccepted:false,packages,canvasArtifactSource:packagePins["@smartdoca/canvas"],candidateCanvasArtifact:packagePins["@smartdoca/canvas"].startsWith("file:"),...(builtWeb?{builtIndexSha256:createHash("sha256").update(await readFile("apps/web/dist/index.html")).digest("hex")}:{})};
const app = await createApp(db, {
  origin,
  ...(builtWeb ? { staticDirectory: resolve("apps/web/dist") } : {}),
  storage: { ...storageRuntime(), root },
  ai: { memory: { driver: "sqlite", url: ":memory:" } },
});
await app.listen({ host: "127.0.0.1", port: builtWeb ? port : 0 });
const address = app.server.address();
assert(address && typeof address !== "string");
const web = builtWeb ? undefined : await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(root,"vite-cache"),
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
    "artifacts/verification/issue-tracker-2026-10-21/slides-browser",
);
await mkdir(output, { recursive: true });
await web?.listen();
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
    { login: "slidesgallery", password: "isolated-slides-gallery-2026" },
    "POST",
  );
  const slides = await request(
    "/resources",
    { title: "Slides gallery QA", kind: "document", format: "presentation" },
    "POST",
  );

  const seq = async () =>
    (
      await db
        .selectFrom("document_states")
        .select("seq")
        .where("resource_id", "=", slides.id)
        .executeTakeFirstOrThrow()
    ).seq;
  const project = async () => {
    const data = await request(`/ai/resources/${slides.id}/preview`);
    const Y = await import("yjs"),
      { readDocument } = await import("@smartdoca/slides/core");
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(
        doc,
        new Uint8Array(Buffer.from(data.surface.update, "base64")),
      );
      return readDocument(doc);
    } finally {
      doc.destroy();
    }
  };
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  const updates: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === "update") updates.push(frame);
      } catch {}
    }),
  );
  const saved = async () => {
    await page!
      .getByText(/(?:^| · )已保存到云端$/)
      .last()
      .waitFor({ state: "attached" });
  };
  await page.goto(origin + "/#/r/" + slides.id);
  await page.locator(".eppt-workspace").waitFor();
  await saved();
  const upload = async (name: string, color: string) => {
    const sharp = (await import("sharp")).default;
    await page!
      .locator(
        'input[type="file"][accept="image/png,image/jpeg,image/gif,image/webp"]',
      )
      .setInputFiles({
        name,
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 160, height: 100, channels: 4, background: color },
        })
          .png()
          .toBuffer(),
      });
    await until(
      async () => JSON.stringify(await project()).includes(name),
      name + " saved",
    );
    await saved();
  };
  await upload("slide-first.png", "#3370ff");
  await page.getByRole("button", { name: "第 1 页菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: /复制幻灯片/ }).click();
  await saved();
  await upload("slide-second.png", "#e5484d");
  const value = await project();
  assert.equal(value.slideOrder.length, 2);
  const images = value.slideOrder.flatMap((id) =>
    Object.values(value.slides[id]!.elements).filter(
      (image) => image.type === "image",
    ),
  );
  assert.equal(images.length, 3);
  assert.equal(
    images[0]!.type === "image" &&
      images[1]!.type === "image" &&
      images[0]!.assetId === images[1]!.assetId,
    true,
  );
  const clickImage = async (
    scope: import("playwright-core").Locator,
    name: string,
  ) => {
    const target = scope.locator(`.eppt-slide img[alt="${name}"]`).last();
    await target.waitFor({ state: "attached" });
    const bounds = await target.boundingBox();
    assert(bounds);
    await page!.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  };
  const initialSeq = await seq(),
    initialUpdates = updates.length;
  await page
    .locator(".presentation-document .eppt-slide")
    .click({ position: { x: 20, y: 20 } });
  await clickImage(page.locator(".presentation-document"), "slide-second.png");
  assert.equal(await page.locator(".document-image-preview").count(), 0);
  await delay(500);
  await clickImage(page.locator(".presentation-document"), "slide-second.png");
  await page.locator(".document-image-preview").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "预览图片", exact: true }).click();
  await page.locator(".document-image-preview").waitFor();
  assert.equal(await page.locator(".eppt-image-preview").count(), 0);
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "3 / 3",
  );
  const image = page.locator(".document-image-preview-viewport img"),
    box = await image.boundingBox();
  assert(box);
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 70, { steps: 8 });
  await page.mouse.up();
  assert(
    (await image.getAttribute("style"))?.includes("translate(90px, 30px)"),
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "2 / 3",
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 3",
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "2 / 3",
  );
  await page.mouse.wheel(120, 0);
  await page
    .getByRole("dialog", { name: "slide-second.png", exact: true })
    .waitFor();
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.endsWith("?download=1"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "cross-slide-gallery.png") });
  await page.keyboard.press("Escape");
  assert.equal(await seq(), initialSeq);
  assert.equal(updates.length, initialUpdates);
  pass(
    "native uploaded images and duplicated-page occurrences form one exact cross-slide host gallery; pan, buttons, keys and horizontal wheel do not write content",
  );
  await page.getByRole("combobox", { name: "文档模式", exact: true }).click();
  await page.getByRole("option", { name: "阅读", exact: true }).click();
  await delay(250);
  await clickImage(page.locator(".presentation-document"), "slide-second.png");
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "3 / 3",
  );
  await page.screenshot({ animations:"disabled", path: join(output, "readonly-gallery.png") });
  await page.keyboard.press("Escape");
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
  await history.locator(".eppt-workspace").waitFor();
  await clickImage(history, "slide-first.png");
  await page.locator(".document-image-preview").waitFor();
  assert.equal(
    await page.locator(".document-image-preview-position").textContent(),
    "1 / 3",
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("dialog", { name: "slide-second.png", exact: true })
    .waitFor();
  await page.screenshot({ animations:"disabled", path: join(output, "history-gallery.png") });
  await page.keyboard.press("Escape");
  await history
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await records
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  assert.equal(await seq(), initialSeq);
  assert.equal(updates.length, initialUpdates);
  pass(
    "readonly and history Slides previews use the same full host gallery without content writes",
  );
  const detail = await request(`/resources/${slides.id}`);
  await request(
    `/resources/${slides.id}/trash`,
    { version: detail.resource.version },
    "POST",
  );
  await page.goto(origin + "/#/trash");
  await page.getByText("Slides gallery QA", { exact: true }).click();
  const trash = page.locator(".trash-preview");
  await trash.locator(".eppt-workspace").waitFor();
  await clickImage(trash, "slide-first.png");
  await page.locator(".document-image-preview").waitFor();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("dialog", { name: "slide-second.png", exact: true })
    .waitFor();
  await until(
    async () =>
      (await image.getAttribute("src"))?.includes("?trashPreview=1") ?? false,
    "trash image access flag",
  );
  assert(
    (
      await page
        .locator(".document-image-preview a[download]")
        .getAttribute("href")
    )?.includes("?trashPreview=1&download=1"),
  );
  await page.screenshot({ animations:"disabled", path: join(output, "trash-gallery.png") });
  assert.equal(await seq(), initialSeq);
  pass(
    "recycle-bin Slides gallery retains original asset preview and download authorization flags without writes",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ result:"passed", ...receiptScope, checks, errors }, null, 2),
  );
  await rm(join(output, "failure.png"), { force: true });
  await rm(join(output, "failure.txt"), { force: true });
} catch (error) {
  await page?.screenshot({ animations:"disabled", path: join(output, "failure.png") }).catch(() => {});
  await writeFile(join(output, "failure.txt"), String(error));
  await writeFile(join(output,"results.json"),JSON.stringify({result:"failed",...receiptScope,checks,errors,error:String(error)},null,2)+"\n");
  throw error;
} finally {
  await browser.close();
  await web?.close();
  await app.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
