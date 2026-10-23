import { afterEach, expect, it, vi } from "vitest";
import {
  hashPendingItem,
  pendingScopeKey,
  persistPendingEntry,
  samePendingItem,
  validatePendingItem,
  PendingQueueStorageError,
  type PendingQueueScope,
} from "../apps/web/src/features/ai/ai-pending-store.js";
import type { PendingSendItem } from "../apps/web/src/features/ai/ai-session-ux.js";

afterEach(() => vi.unstubAllGlobals());

const scope = (): PendingQueueScope => ({
  docaOrigin: "https://doca.example",
  userId: "user",
  connectionId: "website",
  profile: null,
});
const item = (): PendingSendItem => ({
  id: "original-message",
  text: "  Preserve literal input  ",
  attachments: [],
  references: [],
  modelId: "chosen-model",
  scope: "all",
  createdAt: "2026-10-22T00:00:00.000Z",
});

it("hashes the complete known payload deterministically without trimming input or changing array order", async () => {
  const original = {
    ...item(),
    attachments: [
      {
        id: "upload",
        filename: "original.png",
        mime: "image/png",
        size: 123,
        sourceFileId: "file",
        sourceName: "source.png",
        extractStatus: "ready" as const,
        preview: "Parsed upload preview",
        description: "Description supplied by the existing uploader",
      },
    ],
    references: [
      {
        resourceId: "resource",
        anchor: { end: 4, start: 1 },
        label: "Selection",
        seq: 8,
        epochId: "epoch",
      },
    ],
    files: [{ kind: "folder" as const, id: "folder", name: "Read me" }],
    currentResourceId: "resource",
    currentFolder: { type: "document" as const, id: "document" },
    skillIds: ["one", "two"],
    webSearch: false,
    skipApprovals: { create: false, delete: true },
  };
  expect(validatePendingItem(original, true)).toBe(true);
  const reordered = {
    ...original,
    references: [
      {
        seq: 8,
        epochId: "epoch",
        label: "Selection",
        anchor: { start: 1, end: 4 },
        resourceId: "resource",
      },
    ],
  };
  expect(await hashPendingItem(reordered)).toBe(
    await hashPendingItem(original),
  );
  expect(samePendingItem(reordered, original)).toBe(true);
  expect(
    await hashPendingItem({ ...original, text: original.text.trim() }),
  ).not.toBe(await hashPendingItem(original));
  expect(
    await hashPendingItem({ ...original, skillIds: ["two", "one"] }),
  ).not.toBe(await hashPendingItem(original));
  expect(
    await hashPendingItem({
      ...original,
      attachments: [{ ...original.attachments[0]!, sourceName: "changed.png" }],
    }),
  ).not.toBe(await hashPendingItem(original));
});

it.each(["pending", "failed"] as const)(
  "preserves a known old %s attachment for inspection but rejects a new send before storage",
  async (extractStatus) => {
    const original = {
      ...item(),
      attachments: [
        {
          id: "file",
          filename: "notes.txt",
          mime: "text/plain",
          size: 10,
          extractStatus,
          preview: "Original",
          description: "Retain",
        },
      ],
    };
    expect(validatePendingItem(original)).toBe(true);
    expect(validatePendingItem(original, true)).toBe(false);
    expect(await hashPendingItem(original)).toMatch(/^[a-f0-9]{64}$/);
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    await expect(
      persistPendingEntry(scope(), "session", original),
    ).rejects.toBeInstanceOf(PendingQueueStorageError);
    expect(open).not.toHaveBeenCalled();
    expect(original.attachments[0]!.extractStatus).toBe(extractStatus);
  },
);

it("preserves the existing ready upload URL and metadata in the complete payload hash", async () => {
  const file = {
    id: "ready-upload",
    url: "/api/v1/assets/ready-upload/content",
    filename: "ready.txt",
    mime: "text/plain",
    size: 42,
    extractStatus: "ready" as const,
    sourceFileId: "source-file",
    sourceName: "Original source",
    preview: "Full parsed preview",
    description: "Existing metadata",
  };
  const original = { ...item(), attachments: [file] };
  const snapshot = structuredClone(original);
  expect(validatePendingItem(original, true)).toBe(true);
  const hash = await hashPendingItem(original);
  expect(await hashPendingItem(structuredClone(original))).toBe(hash);
  for (const change of [
    { url: "/api/v1/assets/changed/content" },
    { preview: "Changed preview" },
    { description: "Changed metadata" },
  ]) {
    expect(
      await hashPendingItem({
        ...original,
        attachments: [{ ...file, ...change }],
      }),
    ).not.toBe(hash);
  }
  expect(
    validatePendingItem(
      { ...original, attachments: [{ ...file, url: 42 }] },
      true,
    ),
  ).toBe(false);
  expect(original).toEqual(snapshot);
});

it("recognizes missing old selection fields only for inspection and refuses a new write without explicit selections", async () => {
  const { modelId: _, scope: __, ...old } = item();
  expect(validatePendingItem(old)).toBe(true);
  expect(validatePendingItem(old, true)).toBe(false);
  expect(await hashPendingItem(old)).toMatch(/^[a-f0-9]{64}$/);
  const open = vi.fn();
  vi.stubGlobal("indexedDB", { open });
  await expect(persistPendingEntry(scope(), null, old)).rejects.toBeInstanceOf(
    PendingQueueStorageError,
  );
  expect(open).not.toHaveBeenCalled();
});

it.each([
  { future: true },
  {
    attachments: [
      {
        id: "file",
        filename: "x",
        mime: "x",
        size: 1,
        unknownMetadata: "preserve",
      },
    ],
  },
  { references: [{ resourceId: "resource", futureAnchorField: 1 }] },
  { references: [{ resourceId: "resource", anchor: new Map([["start", 1]]) }] },
  { currentFolder: { type: "future", id: "folder" } },
  { skipApprovals: { future: true } },
  { skillIds: [undefined] },
  { webSearch: "true" },
  { attachments: [{ id: "file", filename: "x", mime: "x", size: Number.NaN }] },
])(
  "rejects an unrecognized or lossy payload while retaining the caller's original object: %j",
  async (change) => {
    const original = { ...item(), ...change } as PendingSendItem;
    const snapshot = structuredClone(original);
    expect(validatePendingItem(original)).toBe(false);
    await expect(hashPendingItem(original)).rejects.toBeInstanceOf(
      PendingQueueStorageError,
    );
    expect(original).toEqual(snapshot);
  },
);

it("rejects a cyclic anchor and a sparse array rather than silently converting them", async () => {
  const anchor: Record<string, unknown> = {};
  anchor.self = anchor;
  await expect(
    hashPendingItem({
      ...item(),
      references: [{ resourceId: "resource", anchor }],
    }),
  ).rejects.toBeInstanceOf(PendingQueueStorageError);
  const skillIds = new Array<string>(2);
  skillIds[1] = "second";
  await expect(hashPendingItem({ ...item(), skillIds })).rejects.toBeInstanceOf(
    PendingQueueStorageError,
  );
});

it("includes target origin, account, connection and profile revision in the scope identity", () => {
  const extension = {
    ...scope(),
    connectionId: "connection",
    profile: { id: "profile", revision: 1 },
  };
  const keys = [
    scope(),
    { ...scope(), docaOrigin: "https://other.example" },
    { ...scope(), userId: "other" },
    extension,
    { ...extension, profile: { id: "profile", revision: 2 } },
    { ...extension, profile: { id: "other", revision: 1 } },
  ].map(pendingScopeKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(
    pendingScopeKey({
      profile: extension.profile,
      userId: extension.userId,
      connectionId: extension.connectionId,
      docaOrigin: extension.docaOrigin,
    }),
  ).toBe(pendingScopeKey(extension));
});

it.each([
  { docaOrigin: "https://doca.example/" },
  { docaOrigin: "https://doca.example/path" },
  { docaOrigin: "file:///doca" },
  { connectionId: "connection", profile: null },
  { profile: { id: "profile", revision: 1 } },
  { connectionId: "connection", profile: { id: "profile", revision: 0 } },
  { userId: "" },
])("fails closed for an incomplete or noncanonical scope: %j", (change) => {
  expect(() =>
    pendingScopeKey({ ...scope(), ...change } as PendingQueueScope),
  ).toThrow(PendingQueueStorageError);
});

it("rejects unavailable IndexedDB and never writes or reads localStorage as a fallback", async () => {
  const getItem = vi.fn(),
    setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem, setItem });
  vi.stubGlobal("indexedDB", undefined);
  const original = item();
  await expect(
    persistPendingEntry(scope(), null, original),
  ).rejects.toBeInstanceOf(PendingQueueStorageError);
  expect(original).toEqual(item());
  expect(getItem).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
});

it("allows initial tombstones only for explicit known legacy sources and an accepted session", async () => {
  const open = vi.fn();
  vi.stubGlobal("indexedDB", { open });
  const original = item(),
    source = {
      storageKey: "old-key",
      sessionKey: "draft",
      hash: await hashPendingItem(original),
    };
  await expect(
    persistPendingEntry(scope(), "session", original, undefined, {
      state: "accepted",
      serverJobId: original.id,
    }),
  ).rejects.toBeInstanceOf(PendingQueueStorageError);
  await expect(
    persistPendingEntry(scope(), null, original, source, {
      state: "accepted",
      serverJobId: original.id,
    }),
  ).rejects.toBeInstanceOf(PendingQueueStorageError);
  await expect(
    persistPendingEntry(scope(), "session", original, source, {
      state: "accepted",
      serverJobId: "",
    }),
  ).rejects.toBeInstanceOf(PendingQueueStorageError);
  expect(open).not.toHaveBeenCalled();
});
