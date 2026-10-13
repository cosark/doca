import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bootstrap, Detail } from "@web/shared/api.js";
import {
  cacheStartupBootstrap,
  cacheStartupDocument,
  clearDocumentStartupCache,
  documentStartupCacheKey,
  forgetStartupDocument,
  readDocumentStartup,
} from "@web/shared/document-startup-cache.js";

const id = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const bootstrap: Bootstrap = {
  siteName: "Isolated cache test",
  registrationEnabled: false,
  initialized: true,
  user: { id: userId, display_name: "Cache tester", admin: false },
  capabilities: { documents: true },
  plugins: [],
};
const detail: Detail = {
  resource: {
    id,
    kind: "document",
    format: "rich_text",
    title: "Cached document",
    owner_id: userId,
    library_id: null,
    parent_id: null,
    version: 1,
    role: "editor",
    access_mode: "custom",
    visibility: "invited",
    created_at: "2026-10-12",
    updated_at: "2026-10-12",
    deleted_at: null,
  },
  ownerName: "Cache tester",
  lastEditorName: null,
  lastEditedAt: null,
  comments: [],
  grants: [],
  likes: 0,
  liked: false,
  favorite: false,
  pinned: false,
};
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("restores authorized metadata synchronously for desktop and mobile without requesting the backend", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  for (const hash of [`#/r/${id}`, `#/r/${id}?comment=anything`, `#/m/r/${id}`])
    expect(readDocumentStartup(hash)?.detail.resource).toEqual(detail.resource);
  expect(readDocumentStartup("#/home")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps only display metadata and retains the previous snapshot on quota failure", () => {
  cacheStartupBootstrap({
    ...bootstrap,
    token: "must-not-be-cached",
  } as Bootstrap);
  cacheStartupDocument(
    userId,
    {
      ...detail,
      comments: [{ body: "not startup metadata" }] as any,
      grants: [{ user_id: userId, role: "owner" }],
    },
    null,
  );
  const raw = values.get(documentStartupCacheKey)!;
  expect(() =>
    cacheStartupBootstrap({
      ...bootstrap,
      plugins: undefined,
    } as unknown as Bootstrap),
  ).not.toThrow();
  expect(values.get(documentStartupCacheKey)).toBe(raw);
  expect(raw).not.toContain("must-not-be-cached");
  expect(readDocumentStartup(`#/r/${id}`)?.detail.comments).toEqual([]);
  expect(readDocumentStartup(`#/r/${id}`)?.detail.grants).toEqual([]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  });
  expect(() =>
    cacheStartupDocument(
      userId,
      { ...detail, resource: { ...detail.resource, title: "New title" } },
      null,
    ),
  ).not.toThrow();
  expect(values.get(documentStartupCacheKey)).toBe(raw);
});

it("never exposes another account's metadata and never clears durable content during logout", () => {
  values.set(
    "isolated-checkpoint-and-outbox",
    "original bytes and message ids",
  );
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  cacheStartupBootstrap({
    ...bootstrap,
    user: { ...bootstrap.user!, id: "20000000-0000-4000-8000-000000000002" },
  });
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
  cacheStartupDocument(userId, detail, null);
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  cacheStartupBootstrap({ ...bootstrap, user: null });
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
  expect(values.get("isolated-checkpoint-and-outbox")).toBe(
    "original bytes and message ids",
  );
});

it.each([
  "not JSON",
  JSON.stringify({ version: 2, bootstrap, documents: [] }),
  JSON.stringify({ version: 1, bootstrap }),
])("preserves and refuses unknown or malformed stored formats: %s", (raw) => {
  values.set(documentStartupCacheKey, raw);
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  clearDocumentStartupCache();
  expect(values.get(documentStartupCacheKey)).toBe(raw);
});

it("bounds metadata storage and forgets revoked resources without removing other documents", () => {
  cacheStartupBootstrap(bootstrap);
  for (let n = 0; n < 15; n++)
    cacheStartupDocument(
      userId,
      {
        ...detail,
        resource: {
          ...detail.resource,
          id: `${id.slice(0, -2)}${String(n).padStart(2, "0")}`,
        },
      },
      null,
    );
  const cache = JSON.parse(values.get(documentStartupCacheKey)!);
  expect(cache.documents).toHaveLength(12);
  const newest = cache.documents[0].detail.resource.id;
  forgetStartupDocument(newest);
  expect(readDocumentStartup(`#/r/${newest}`)).toBeNull();
  expect(
    JSON.parse(values.get(documentStartupCacheKey)!).documents,
  ).toHaveLength(11);
});

it("shares startup HTTP requests and retries a failed connection instead of memoizing failure", async () => {
  let reject!: (reason: unknown) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    )
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(bootstrap), { status: 200 })),
    );
  vi.stubGlobal("fetch", fetch);
  const { loadBootstrap } = await import("@web/shared/bootstrap.js");
  const first = loadBootstrap();
  expect(loadBootstrap()).toBe(first);
  reject(new TypeError("Failed to fetch"));
  await expect(first).rejects.toThrow("Failed to fetch");
  expect(await loadBootstrap()).toEqual(bootstrap);
  expect(await loadBootstrap()).toEqual(bootstrap);
  expect(fetch).toHaveBeenCalledTimes(2);
  await loadBootstrap(true);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("clears the startup identity on explicit session rejection and successful logout", async () => {
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  const events: string[] = [];
  vi.stubGlobal("window", {
    dispatchEvent: (event: Event) => events.push(event.type),
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "session_expired" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 })),
  );
  const { api } = await import("@web/shared/api.js");
  await expect(api("/me")).rejects.toMatchObject({ status: 401 });
  expect(events).toContain("session-expired");
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  await api("/auth/logout", "POST");
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
});

it("refuses a delayed bootstrap response after logout instead of restoring an obsolete cached account", async () => {
  cacheStartupBootstrap(bootstrap);
  cacheStartupDocument(userId, detail, null);
  let respond!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const { api } = await import("@web/shared/api.js");
  const { clearDocumentStartupCache: logout } =
    await import("@web/shared/document-startup-cache.js");
  const pending = api("/bootstrap");
  logout();
  respond(new Response(JSON.stringify(bootstrap), { status: 200 }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(readDocumentStartup(`#/r/${id}`)).toBeNull();
});
