// Replay ONLY synthetic current-format AI fixtures into new isolated resources.
// No AI credentials or external model requests are needed for this browser check.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { openDatabase } from "../packages/db/src/index.js";
import { createUser } from "../packages/core/src/modules/identity/passwords.js";
import { transact } from "../packages/db/src/transactions.js";
import { provisionSurface } from "../packages/core/src/modules/documents/codecs/surfaces.js";
import { createContent } from "../packages/core/src/workflows/resources.js";
import { readAIDocument } from "../packages/core/src/workflows/ai-documents.js";

assert.equal(process.env.DOCA_QA_ISOLATED, "1");
const specs = process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf(":");
  assert(
    separator > 0,
    "Expected canvas:/path.json or presentation:/path.json",
  );
  const format = argument.slice(0, separator),
    file = resolve(argument.slice(separator + 1));
  assert(["canvas", "presentation"].includes(format));
  return { format, file };
});
assert(specs.length > 0, "Pass only synthetic AI fixture files");
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? "artifacts/ai-native-creativity/final-render",
);
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "doca-ai-render-"));
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
const owner = {
  ...(await createUser(
    db,
    {
      login: "airenderqa",
      displayName: "AI render QA",
      password: "isolated-ai-render",
    },
    { bootstrap: true },
  )),
  admin: 1,
};
const port = Number(process.env.DOCA_QA_PORT ?? 39466),
  origin = `http://127.0.0.1:${port}`;
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
    // Verify a fixed editor session; concurrent repository edits must not inject
    // development HMR/reloads into the 60-second content-write observation.
    hmr: false,
    watch: { ignored: ["**/*"] },
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
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
const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
  }),
  errors: string[] = [],
  updates: any[] = [],
  fixtures: any[] = [];
try {
  const login = await context.request.post(origin + "/api/v1/auth/login", {
    headers: { origin },
    data: { login: "airenderqa", password: "isolated-ai-render" },
  });
  assert(login.ok());
  for (const [index, spec] of specs.entries()) {
    const value = JSON.parse(await readFile(spec.file, "utf8"));
    const resource = await createContent(db).create(owner, {
      kind: "document",
      format: spec.format as any,
      title: `AI fixture ${index + 1}`,
    });
    assert.equal(
      (
        await db
          .selectFrom("document_states")
          .select("resource_id")
          .where("resource_id", "=", resource.id)
          .execute()
      ).length,
      0,
      "Only seed a new unopened synthetic resource",
    );
    await transact(db, (tx) => provisionSurface(tx, resource, value));
    const before = await readAIDocument(db, { actor: owner }, resource.id),
      page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) =>
      socket.on("framesent", ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.type === "update")
            updates.push({ resourceId: resource.id, frame });
        } catch {}
      }),
    );
    await page.goto(origin + "/#/r/" + resource.id);
    await page
      .locator(spec.format === "canvas" ? ".canvas-host" : ".eppt-workspace")
      .waitFor({ timeout: 45000 });
    if (spec.format === "canvas") {
      await page.locator(".canvas-app").focus();
      await page.keyboard.press("Shift+Digit1");
    }
    await delay(300);
    await page.screenshot({ path: join(output, `fixture-${index + 1}.png`) });
    fixtures.push({ ...spec, index: index + 1, resource, page, before });
  }
  console.log(`START idle: ${fixtures.length} native documents, 60 seconds`);
  await delay(60000);
  for (const fixture of fixtures) {
    const saved = await readAIDocument(
      db,
      { actor: owner },
      fixture.resource.id,
    );
    assert.equal(saved.seq, fixture.before.seq, "Idle must not save content");
    assert.deepEqual(saved.value, fixture.before.value);
    await fixture.page.reload();
    await fixture.page
      .locator(fixture.format === "canvas" ? ".canvas-host" : ".eppt-workspace")
      .waitFor();
    await fixture.page
      .getByRole("combobox", { name: "文档模式", exact: true })
      .click();
    await fixture.page
      .getByRole("option", { name: "阅读", exact: true })
      .click();
    await delay(200);
    const reloaded = await readAIDocument(
      db,
      { actor: owner },
      fixture.resource.id,
    );
    assert.equal(reloaded.seq, fixture.before.seq);
    assert.equal(reloaded.epochId, fixture.before.epochId);
    assert.deepEqual(reloaded.value, fixture.before.value);
    console.log(
      `PASS render/idle/reload/readonly ${fixture.index} ${fixture.format}`,
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(updates, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        idleSeconds: 60,
        browserErrors: errors,
        contentUpdatesSent: updates.length,
        fixtures: fixtures.map((f) => ({
          index: f.index,
          format: f.format,
          file: f.file,
          seq: f.before.seq,
          passed: true,
        })),
        boundary:
          "New isolated current-format resources from synthetic AI projections; original CRDT identity restoration is covered separately by host tests.",
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await browser.close();
  await web.close();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
}
