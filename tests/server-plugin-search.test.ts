import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SearchSourceRegistry } from "@smartdoca/search-host";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import * as fileRoutes from "@server/routes/files.js";
import * as searchRoutes from "@server/routes/search.js";
import { createApp } from "@server/app/create-app.js";
import { storageRuntime } from "@server/adapters/storage.js";
import {
  documentSearchSource,
  fileSearchSource,
  knowledgeSearchSource,
} from "@server/services/search/sources.js";
import { openTestDatabase } from "./database.js";

it("retains all core search sources after the production plugin composition starts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "doca-plugin-search-"));
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const registrations = vi.spyOn(SearchSourceRegistry.prototype, "register");
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp(db, {
      origin: "http://localhost:39240",
      storage: {
        configuration: storageRuntime().configuration,
        root: join(directory, "uploads"),
        credentials: {},
        endpointHosts: [],
        cdnKeyPairId: undefined,
        cdnPrivateKey: undefined,
      },
      pluginDirectory: join(directory, "plugins"),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      registrations.mock.calls.map(([source]) => source.descriptor),
    ).toEqual(
      expect.arrayContaining([
        documentSearchSource,
        fileSearchSource,
        knowledgeSearchSource,
      ]),
    );
    const registry = registrations.mock.contexts[0] as SearchSourceRegistry;
    expect(registry.size).toBe(3);
    expect(registry.get(documentSearchSource)).toBeDefined();
    await app.close();
    app = undefined;
    expect(registry.size).toBe(0);
  } finally {
    await app?.close();
    registrations.mockRestore();
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps core sources registered until in-flight search work stops during app close", async () => {
  const directory = await mkdtemp(join(tmpdir(), "doca-plugin-search-stop-"));
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const actor = {
    ...(await createUser(
      db,
      {
        login: "shutdown-search",
        displayName: "Search",
        password: "isolated-shutdown-search-password",
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
  await createContent(db).create(actor, {
    kind: "document",
    format: "markdown",
    title: "问题",
  });
  await db
    .updateTable("search_settings")
    .set({ enabled: 1, endpoint: "http://127.0.0.1:7700", index_name: "doca" })
    .where("id", "=", "system")
    .execute();
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  let service:
    Awaited<ReturnType<typeof searchRoutes.registerSearch>> | undefined;
  const registerSearch = searchRoutes.registerSearch;
  const registration = vi
    .spyOn(searchRoutes, "registerSearch")
    .mockImplementation(async (...parameters) => {
      service = await registerSearch(...parameters);
      const upsert = service.searchHost.upsertProjections.bind(
        service.searchHost,
      );
      vi.spyOn(service.searchHost, "upsertProjections").mockImplementation(
        async (request) => {
          started();
          await resume;
          return upsert(request);
        },
      );
      return service;
    });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp(db, {
      origin: "http://localhost:39240",
      storage: {
        configuration: storageRuntime().configuration,
        root: join(directory, "uploads"),
        credentials: {},
        endpointHosts: [],
        cdnKeyPairId: undefined,
        cdnPrivateKey: undefined,
      },
      search: {
        allowedOrigins: ["http://127.0.0.1:7700"],
        fetch: async () =>
          Response.json({
            taskUid: 1,
            status: "succeeded",
            results: [],
            total: 0,
          }),
      },
      pluginDirectory: join(directory, "plugins"),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
    const closing = app.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      service!.searchHost.registry.get(documentSearchSource),
    ).toBeDefined();
    release();
    await closing;
    app = undefined;
    expect(service!.searchHost.registry.size).toBe(0);
    const jobs = await db
      .selectFrom("projection_jobs")
      .select("last_error")
      .where("kind", "=", "search")
      .execute();
    expect(
      jobs.some((job) =>
        job.last_error?.includes("Search source is not registered"),
      ),
    ).toBe(false);
  } finally {
    release();
    await app?.close();
    registration.mockRestore();
    vi.useRealTimers();
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

it("does not consume search jobs before a slow core plugin mount registers its sources", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "doca-plugin-search-startup-"),
  );
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const actor = {
    ...(await createUser(
      db,
      {
        login: "startup-search",
        displayName: "Search",
        password: "isolated-startup-search-password",
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
  await createContent(db).create(actor, {
    kind: "document",
    format: "markdown",
    title: "问题",
  });
  await db
    .updateTable("search_settings")
    .set({ enabled: 1, endpoint: "http://127.0.0.1:7700", index_name: "doca" })
    .where("id", "=", "system")
    .execute();
  const registerFiles = fileRoutes.registerFiles;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const mount = vi
    .spyOn(fileRoutes, "registerFiles")
    .mockImplementation(async (...parameters) => {
      await vi.advanceTimersByTimeAsync(1000);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const state = await db
        .selectFrom("search_reconciliation")
        .select("last_error")
        .where("id", "=", "system")
        .executeTakeFirst();
      expect(state?.last_error ?? null).toBeNull();
      const jobs = await db
        .selectFrom("projection_jobs")
        .select("last_error")
        .where("kind", "=", "search")
        .execute();
      expect(jobs.every((job) => job.last_error === null)).toBe(true);
      return registerFiles(...parameters);
    });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp(db, {
      origin: "http://localhost:39240",
      storage: {
        configuration: storageRuntime().configuration,
        root: join(directory, "uploads"),
        credentials: {},
        endpointHosts: [],
        cdnKeyPairId: undefined,
        cdnPrivateKey: undefined,
      },
      search: {
        allowedOrigins: ["http://127.0.0.1:7700"],
        fetch: async () =>
          Response.json({
            taskUid: 1,
            status: "succeeded",
            results: [],
            total: 0,
          }),
      },
      pluginDirectory: join(directory, "plugins"),
    });
    expect(mount).toHaveBeenCalledOnce();
  } finally {
    await app?.close();
    mount.mockRestore();
    vi.useRealTimers();
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
