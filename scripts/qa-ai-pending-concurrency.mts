// Real Chrome IndexedDB transactions across two pages; synthetic data, no backend or model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = await mkdtemp(join(tmpdir(), "doca-queue-concurrency-"));
const port = Number(process.env.DOCA_QA_PORT ?? 39493),
  origin = `http://127.0.0.1:${port}`;
const output = resolve(
  process.env.DOCA_QA_OUTPUT ?? ".local/ai-pending-concurrency-idb-2026-10-22",
);
await mkdir(output, { recursive: true });
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  cacheDir: join(root, "vite-cache"),
  plugins: [
    {
      name: "queue-concurrency-fixture",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__queue-fixture") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await server.transformIndexHtml(
              req.url,
              `<!doctype html><html><body><h1>Synthetic IndexedDB pending queue audit</h1><pre id="result"></pre><script type="module">
      import * as store from '/src/features/ai/ai-pending-store.ts';
      window.queueFixture = store;
    </script></body></html>`,
            ),
          );
        });
      },
    },
  ],
  optimizeDeps: { noDiscovery: true, include: [] },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: false,
    watch: { ignored: ["**/*"] },
  },
});
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  // tsx/esbuild may name locally assigned browser callbacks with this helper.
  await context.addInitScript("window.__name = value => value;");
  const one = await context.newPage(),
    two = await context.newPage();
  const errors: string[] = [];
  for (const page of [one, two]) {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/__queue-fixture");
    await page.waitForFunction(() => !!(window as any).queueFixture);
  }
  const scope = {
    docaOrigin: origin,
    userId: `synthetic-concurrency-${randomUUID()}`,
    connectionId: "website",
    profile: null,
  };
  const batch = async (page: typeof one, session: string, prefix: string) =>
    page.evaluate(
      async ({ scope, session, prefix }) => {
        const f = (window as any).queueFixture;
        const items = Array.from({ length: 100 }, (_, index) => ({
          id: `${prefix}-${index}`,
          text: `${prefix}-${index}`,
          attachments: [],
          references: [],
          createdAt: new Date().toISOString(),
          modelId: "synthetic",
          scope: "all",
        }));
        await Promise.all(
          items.map((item) => f.persistPendingEntry(scope, session, item)),
        );
        return items;
      },
      { scope, session, prefix },
    );
  // Correctness must not depend on Web Locks, storage events or a delayed retry.
  for (const page of [one, two])
    await page.evaluate(() =>
      Object.defineProperty(navigator, "locks", {
        value: undefined,
        configurable: true,
      }),
    );
  const [a, b] = await Promise.all([
    batch(one, "session-a", "a"),
    batch(two, "session-b", "b"),
  ]);
  const first = await one.evaluate(
    (scope) => (window as any).queueFixture.listPendingEntries(scope),
    scope,
  );
  assert.equal(first.length, 200);
  assert.deepEqual(
    new Set(first.map((entry: any) => entry.messageId)),
    new Set([...a, ...b].map((item) => item.id)),
  );
  const seed = {
    id: "draft-original",
    text: "Retain original draft ID",
    attachments: [],
    references: [],
    modelId: "synthetic",
    scope: "all",
    createdAt: new Date().toISOString(),
  };
  const source = await one.evaluate(
    async ({ scope, seed }) => {
      const f = (window as any).queueFixture;
      const source = {
        storageKey: `doca.ai.pending-send.${scope.userId}`,
        sessionKey: "draft",
        hash: await f.hashPendingItem(seed),
      };
      localStorage.setItem(
        source.storageKey,
        JSON.stringify({ draft: [seed] }),
      );
      return source;
    },
    { scope, seed },
  );
  const legacyRaw = await one.evaluate(
    (source) => localStorage.getItem(source.storageKey),
    source,
  );
  // Two explicit Continue attempts for the same old item adopt it only once.
  await Promise.all(
    [one, two].map((page) =>
      page.evaluate(
        async ({ scope, seed, source }) => {
          await (window as any).queueFixture.persistPendingEntry(
            scope,
            null,
            seed,
            source,
          );
        },
        { scope, seed, source },
      ),
    ),
  );
  await Promise.all([
    one.evaluate(
      async ({ scope, seed }) => {
        await (window as any).queueFixture.bindPendingSession(
          scope,
          seed,
          "session-a",
        );
      },
      { scope, seed },
    ),
    two.evaluate(
      async ({ scope, item }) => {
        await (window as any).queueFixture.withdrawPendingEntry(scope, item);
      },
      { scope, item: b[0] },
    ),
  ]);
  await Promise.all([
    one.evaluate(
      async ({ scope, seed }) => {
        await (window as any).queueFixture.markPendingAccepted(
          scope,
          seed,
          seed.id,
        );
      },
      { scope, seed },
    ),
    batch(two, "session-c", "c"),
  ]);
  const [final, peer] = await Promise.all(
    [one, two].map((page) =>
      page.evaluate(
        (scope) => (window as any).queueFixture.listPendingEntries(scope),
        scope,
      ),
    ),
  );
  assert.deepEqual(
    final,
    peer,
    "The peer must read the committed result without a polling delay",
  );
  assert.equal(final.length, 301, "Two tombstones must remain stored");
  const pending = final.filter((entry: any) => entry.state === "pending");
  assert.equal(pending.length, 299);
  assert.equal(
    pending.filter((entry: any) => entry.sessionId === "session-a").length,
    100,
  );
  assert.equal(
    pending.filter((entry: any) => entry.sessionId === "session-b").length,
    99,
  );
  assert.equal(
    pending.filter((entry: any) => entry.sessionId === "session-c").length,
    100,
  );
  assert(!pending.some((entry: any) => entry.sessionId === null));
  const expected = [
    ...a.map((item) => item.id),
    ...b.slice(1).map((item) => item.id),
    ...Array.from({ length: 100 }, (_, index) => `c-${index}`),
  ];
  assert.deepEqual(
    new Set(pending.map((entry: any) => entry.messageId)),
    new Set(expected),
  );
  assert.equal(
    final.find((entry: any) => entry.messageId === seed.id)?.state,
    "accepted",
  );
  assert.equal(
    final.find((entry: any) => entry.messageId === "b-0")?.state,
    "withdrawn",
  );
  const tombstones = await two.evaluate(
    async ({ scope, seed, source, withdrawn }) => {
      const f = (window as any).queueFixture;
      const accepted = await f.persistPendingEntry(
        scope,
        "session-a",
        seed,
        source,
      );
      const removed = await f.persistPendingEntry(
        scope,
        "session-b",
        withdrawn,
      );
      const attempts = [
        () =>
          f.persistPendingEntry(
            scope,
            "session-a",
            { ...seed, text: "Changed legacy source text" },
            source,
          ),
        () =>
          f.persistPendingEntry(scope, "session-a", seed, {
            ...source,
            hash: "0".repeat(64),
          }),
        () => f.bindPendingSession(scope, seed, "different-session"),
        () => f.markPendingAccepted(scope, withdrawn, withdrawn.id),
        () => f.promotePendingEntry(scope, withdrawn),
      ];
      const conflicts = [];
      for (const attempt of attempts) {
        try {
          await attempt();
          conflicts.push(false);
        } catch (error) {
          conflicts.push(error instanceof f.PendingQueueChangedError);
        }
      }
      return { accepted: accepted.state, withdrawn: removed.state, conflicts };
    },
    { scope, seed, source, withdrawn: b[0] },
  );
  assert.deepEqual(tombstones, {
    accepted: "accepted",
    withdrawn: "withdrawn",
    conflicts: [true, true, true, true, true],
  });
  assert.equal(
    await one.evaluate(
      (source) => localStorage.getItem(source.storageKey),
      source,
    ),
    legacyRaw,
  );

  const initialTombstones = await two.evaluate(
    async ({ scope, seed, source }) => {
      const f = (window as any).queueFixture;
      const selected = { ...scope, userId: "synthetic-direct-tombstones" };
      const addedStates: string[] = [];
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        addedStates.push((args[0] as any).state);
        return add.apply(this, args);
      };
      try {
        const accepted = { ...seed, id: "already-accepted" },
          withdrawn = { ...seed, id: "explicitly-withdrawn" };
        await f.persistPendingEntry(
          selected,
          "existing-session",
          accepted,
          source,
          { state: "accepted", serverJobId: accepted.id },
        );
        await f.persistPendingEntry(selected, null, withdrawn, source, {
          state: "withdrawn",
        });
        await f.persistPendingEntry(
          selected,
          "existing-session",
          accepted,
          source,
          { state: "accepted", serverJobId: accepted.id },
        );
        let conflict = false;
        try {
          await f.persistPendingEntry(
            selected,
            "existing-session",
            accepted,
            source,
            { state: "withdrawn" },
          );
        } catch (error) {
          conflict = error instanceof f.PendingQueueChangedError;
        }
        const entries = await f.listPendingEntries(selected);
        return {
          addedStates,
          pending: entries.filter((entry: any) => entry.state === "pending")
            .length,
          retained: entries.length,
          conflict,
        };
      } finally {
        IDBObjectStore.prototype.add = add;
      }
    },
    { scope, seed, source },
  );
  assert.deepEqual(initialTombstones, {
    addedStates: ["accepted", "withdrawn"],
    pending: 0,
    retained: 2,
    conflict: true,
  });

  const isolation = await one.evaluate(
    async ({ scope, seed }) => {
      const f = (window as any).queueFixture;
      const scopes = [
        { ...scope, docaOrigin: "https://other-target.example" },
        { ...scope, userId: "other-account" },
        {
          ...scope,
          connectionId: "connection-one",
          profile: { id: "profile", revision: 1 },
        },
        {
          ...scope,
          connectionId: "connection-two",
          profile: { id: "profile", revision: 1 },
        },
      ];
      const item = { ...seed, id: "same-id-different-scope" };
      for (const selected of scopes)
        await f.persistPendingEntry(selected, "isolated-session", item);
      const counts = await Promise.all(
        scopes.map((selected) =>
          f
            .listPendingEntries(selected)
            .then((entries: any[]) => entries.length),
        ),
      );
      const revised = { ...scopes[2], profile: { id: "profile", revision: 2 } };
      const revisionEntries = await f.listPendingEntries(revised);
      let revisionConflict = false;
      try {
        await f.persistPendingEntry(revised, "isolated-session", item);
      } catch (error) {
        revisionConflict = error instanceof f.PendingQueueChangedError;
      }
      const otherProfile = {
        ...scopes[2],
        profile: { id: "different-profile", revision: 1 },
      };
      await f.persistPendingEntry(otherProfile, "other-session", {
        ...item,
        id: "other-profile-item",
      });
      const ownProfileEntries = await f.listPendingEntries(scopes[2]);
      return {
        counts,
        revisionEntries: revisionEntries.length,
        revisionConflict,
        ownProfileIds: ownProfileEntries.map((entry: any) => entry.messageId),
      };
    },
    { scope, seed },
  );
  assert.deepEqual(isolation, {
    counts: [1, 1, 1, 1],
    revisionEntries: 0,
    revisionConflict: true,
    ownProfileIds: ["same-id-different-scope"],
  });

  // Keep a deliberately unresolved network operation outside any IDB transaction.
  const network = one.evaluate(async () => {
    await new Promise<void>((resolve) => {
      (window as any).networkHeld = true;
      (window as any).releaseNetwork = resolve;
    });
  });
  await one.waitForFunction(() => (window as any).networkHeld);
  const elapsed = await two.evaluate(
    async ({ scope, item }) => {
      const start = performance.now();
      await (window as any).queueFixture.promotePendingEntry(scope, item);
      return performance.now() - start;
    },
    { scope, item: a[0] },
  );
  assert(
    elapsed < 2000,
    "A parked network operation blocked another session's queue write",
  );
  await one.evaluate(() => (window as any).releaseNetwork());
  await network;

  const failures = await one.evaluate(
    async ({ scope, seed }) => {
      const f = (window as any).queueFixture;
      const failureScope = { ...scope, userId: "synthetic-storage-failures" };
      const results: Record<string, boolean> = {};
      const originalOpen = indexedDB.open.bind(indexedDB);
      for (const fault of ["unavailable", "blocked"] as const) {
        Object.defineProperty(indexedDB, "open", {
          configurable: true,
          value:
            fault === "unavailable"
              ? () => {
                  throw new DOMException("Synthetic denial", "SecurityError");
                }
              : () => {
                  const request: Record<string, unknown> = {};
                  queueMicrotask(() => (request.onblocked as () => void)?.());
                  return request;
                },
        });
        try {
          await f.persistPendingEntry(failureScope, "session", {
            ...seed,
            id: fault,
          });
          results[fault] = false;
        } catch (error) {
          results[fault] = error instanceof f.PendingQueueStorageError;
        } finally {
          Object.defineProperty(indexedDB, "open", {
            configurable: true,
            value: originalOpen,
          });
        }
        results[`${fault}Preserved`] =
          (await f.getPendingEntry(failureScope, fault)) === null;
      }
      const add = IDBObjectStore.prototype.add;
      for (const fault of ["quota", "abort"] as const) {
        IDBObjectStore.prototype.add = function (...args) {
          if (fault === "quota")
            throw new DOMException("Synthetic quota", "QuotaExceededError");
          const request = add.apply(this, args);
          request.addEventListener("success", () => this.transaction.abort(), {
            once: true,
          });
          return request;
        };
        try {
          await f.persistPendingEntry(failureScope, "session", {
            ...seed,
            id: fault,
          });
          results[fault] = false;
        } catch (error) {
          results[fault] = error instanceof f.PendingQueueStorageError;
        } finally {
          IDBObjectStore.prototype.add = add;
        }
        results[`${fault}Preserved`] =
          (await f.getPendingEntry(failureScope, fault)) === null;
      }
      const original = {
        ...seed,
        id: "snapshot-original",
        attachments: [
          {
            id: "prepared-upload",
            url: "/api/v1/assets/prepared-upload/content",
            filename: "notes.txt",
            mime: "text/plain",
            size: 7,
            extractStatus: "ready",
            preview: "Parsed text",
            description: "Original metadata",
            sourceFileId: "source-file",
            sourceName: "Original source",
          },
        ],
      };
      const saving = f.persistPendingEntry(failureScope, "session", original);
      original.text = "A later caller edit must not replace the saved snapshot";
      const saved = await saving;
      results.immutableSnapshot = saved.item.text === seed.text;
      results.attachmentMetadataRetained =
        JSON.stringify(saved.item.attachments) ===
        JSON.stringify(original.attachments);
      // Resolve must be later than oncomplete, including when add succeeds first.
      const transact = IDBDatabase.prototype.transaction;
      let completed = false;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = transact.apply(this, args);
        if (args[1] === "readwrite")
          tx.addEventListener(
            "complete",
            () => {
              completed = true;
            },
            { once: true },
          );
        return tx;
      };
      try {
        await f.persistPendingEntry(failureScope, "session", {
          ...seed,
          id: "completion-order",
        });
        results.resolvesAfterCommit = completed;
      } finally {
        IDBDatabase.prototype.transaction = transact;
      }
      return results;
    },
    { scope, seed },
  );
  assert(Object.values(failures).every(Boolean), JSON.stringify(failures));

  const unknown = await two.evaluate(
    async ({ scope, seed }) => {
      const f = (window as any).queueFixture;
      const entry = await f.getPendingEntry(scope, "a-1");
      const future = {
        ...entry,
        recordVersion: 2,
        futurePayload: { keep: "untouched" },
      };
      const raw = async (value?: any) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("doca-ai-pending", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<any>((resolve, reject) => {
            const tx = db.transaction(
              "entries",
              value ? "readwrite" : "readonly",
            );
            const store = tx.objectStore("entries");
            const request = value
              ? store.put(value)
              : store.get([
                  scope.docaOrigin,
                  scope.userId,
                  scope.connectionId,
                  "a-1",
                ]);
            let result: any;
            request.onsuccess = () => {
              result = request.result;
            };
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      };
      await raw(future);
      const results = [];
      for (const work of [
        () => f.listPendingEntries(scope),
        () => f.getPendingEntry(scope, "a-1"),
        () => f.persistPendingEntry(scope, "session-a", entry.item),
        () => f.withdrawPendingEntry(scope, entry.item),
      ]) {
        try {
          await work();
          results.push(false);
        } catch (error) {
          results.push(error instanceof f.PendingQueueStorageError);
        }
      }
      const preserved = JSON.stringify(await raw()) === JSON.stringify(future);
      return { rejected: results.every(Boolean), preserved };
    },
    { scope, seed },
  );
  assert.deepEqual(unknown, { rejected: true, preserved: true });

  const newerContext = await browser.newContext();
  await newerContext.addInitScript("window.__name = value => value;");
  const newer = await newerContext.newPage();
  await newer.goto(origin + "/__queue-fixture");
  await newer.waitForFunction(() => !!(window as any).queueFixture);
  const newerDatabase = await newer.evaluate(
    async ({ scope, seed }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("doca-ai-pending", 2);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("future", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("future", "readwrite");
        tx.objectStore("future").put({ id: "retain", bytes: "future data" });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      const f = (window as any).queueFixture;
      let rejected = false;
      try {
        await f.persistPendingEntry(scope, "session", seed);
      } catch (error) {
        rejected = error instanceof f.PendingQueueStorageError;
      }
      const reopened = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("doca-ai-pending");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise<any>((resolve, reject) => {
        const request = reopened
          .transaction("future")
          .objectStore("future")
          .get("retain");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const result = {
        rejected,
        version: reopened.version,
        preserved: value?.bytes === "future data",
        stores: [...reopened.objectStoreNames],
      };
      reopened.close();
      return result;
    },
    { scope, seed },
  );
  assert.deepEqual(newerDatabase, {
    rejected: true,
    version: 2,
    preserved: true,
    stores: ["future"],
  });
  await newerContext.close();
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    synthetic: true,
    realPages: 2,
    requiresWebLocks: false,
    parallelInitialWrites: 200,
    storedEntries: 301,
    pendingEntries: 299,
    retainedTombstones: 2,
    exactIds: true,
    concurrentAdoptWithdrawAccept: true,
    peerReadAfterCommit: true,
    legacyRawUnchanged: true,
    tombstones,
    initialTombstones,
    isolation,
    failures,
    unknownRecord: unknown,
    newerDatabase,
    networkDoesNotBlockQueueWrite: true,
    networkOverlapWriteMs: elapsed,
    paidProviderCalls: 0,
    errors,
  };
  for (const page of [one, two])
    await page.evaluate((value) => {
      document.querySelector("#result")!.textContent = JSON.stringify(
        value,
        null,
        2,
      );
    }, result);
  await one.screenshot({
    path: join(output, "two-page-idb-queue-audit.png"),
    fullPage: true,
  });
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  process.stdout.write(JSON.stringify(result) + "\n");
} finally {
  await browser.close();
  await web.close();
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
