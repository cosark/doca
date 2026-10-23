import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PendingEntry, PendingQueueScope } from "../apps/web/src/features/ai/ai-pending-store.js";

// The store's transaction/renderer behavior is covered separately in real
// Chromium. Here the asynchronous boundary is deliberate: facade notifications
// must wait for transaction completion, never for a request's early success.
const store = vi.hoisted(() => ({
  persist: vi.fn(), bind: vi.fn(), accept: vi.fn(), get: vi.fn(), list: vi.fn(),
  withdraw: vi.fn(), promote: vi.fn(),
}));
vi.mock("../apps/web/src/features/ai/ai-pending-store.js", async importOriginal => ({
  ...await importOriginal<typeof import("../apps/web/src/features/ai/ai-pending-store.js")>(),
  persistPendingEntry: store.persist,
  bindPendingSession: store.bind,
  markPendingAccepted: store.accept,
  getPendingEntry: store.get,
  listPendingEntries: store.list,
  withdrawPendingEntry: store.withdraw,
  promotePendingEntry: store.promote,
}));
import {
  adoptOutgoingPending, completeOutgoingPending, holdPendingDelivery,
  pendingDeliveryHeld, persistOutgoingPending, PendingQueueChangedError,
  PendingQueueStorageError, withPendingDeliveryLock, readPendingQueue,
  readLegacyPendingQueue, pendingScopeKey, withdrawOutgoingPending, verifyLegacyPendingSource,
} from "../apps/web/src/features/ai/ai-pending-delivery.js";
import { hashPendingItem } from "../apps/web/src/features/ai/ai-pending-store.js";
import { DRAFT_QUEUE_KEY, queueStorageKey, type PendingSendItem } from "../apps/web/src/features/ai/ai-session-ux.js";
import { sendOrReconcilePendingItem } from "../apps/web/src/features/ai/ai-pending-runner.js";

let stored: Map<string, string>;
const dispatch = vi.fn();
const scope = (patch: Partial<PendingQueueScope> = {}): PendingQueueScope => ({
  docaOrigin: "https://doca.test", userId: "actor", connectionId: "connection",
  profile: { id: "profile", revision: 3 }, ...patch,
});
const item = (): PendingSendItem => ({ id: crypto.randomUUID(), text: "Original page request", references: [], attachments: [], modelId: "test", scope: "all", createdAt: new Date().toISOString() });
const entry = (pending: PendingSendItem, patch: Partial<PendingEntry> = {}): PendingEntry => ({
  ...scope(), recordVersion: 1, messageId: pending.id, sessionId: null, item: pending,
  payloadHash: "a".repeat(64), state: "pending", createdAt: pending.createdAt,
  updatedAt: pending.createdAt, ...patch,
});
beforeEach(() => {
  vi.resetAllMocks();
  stored = new Map();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", { dispatchEvent: dispatch });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  store.list.mockResolvedValue([]);
  store.get.mockResolvedValue(null);
  store.persist.mockImplementation(async (identity, sessionId, pending) => entry(pending, { ...identity, sessionId }));
  store.bind.mockImplementation(async (identity, pending, sessionId) => entry(pending, { ...identity, sessionId }));
  store.accept.mockResolvedValue(undefined);
  store.withdraw.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it.each([DRAFT_QUEUE_KEY, "session"])("persists %s through the asynchronous scoped store without writing legacy storage", async sessionKey => {
  const original = item(), identity = scope();
  const result = await persistOutgoingPending(identity, sessionKey, original);
  expect(store.persist).toHaveBeenCalledExactlyOnceWith(identity, sessionKey === DRAFT_QUEUE_KEY ? null : sessionKey, original, undefined, undefined);
  expect(result.item.id).toBe(original.id);
  expect(stored.size).toBe(0);
});

it("does not notify or consume a successful commit until the store transaction completes", async () => {
  const original = item(), identity = scope();
  let commit!: (value: PendingEntry) => void;
  store.persist.mockReturnValue(new Promise<PendingEntry>(resolve => { commit = resolve; }));
  const saving = persistOutgoingPending(identity, DRAFT_QUEUE_KEY, original);
  await Promise.resolve();
  expect(dispatch).not.toHaveBeenCalled();
  commit(entry(original));
  await saving;
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it.each(["accepted", "withdrawn"] as const)("passes an explicit legacy %s state into the initial transaction without a pending write", async state => {
  const original = item(), identity = scope();
  const source = { storageKey: queueStorageKey("legacy"), sessionKey: "session", hash: await hashPendingItem(original) };
  const initial = state === "accepted" ? { state, serverJobId: original.id } : { state };
  await persistOutgoingPending(identity, "session", original, source, initial);
  expect(store.persist).toHaveBeenCalledExactlyOnceWith(identity, "session", original, source, initial);
  expect(store.accept).not.toHaveBeenCalled();
  expect(store.bind).not.toHaveBeenCalled();
});

it.each(["accepted", "withdrawn"] as const)("refuses an existing %s tombstone before the caller consumes the composer", async state => {
  const original = item(), consume = vi.fn();
  const raw = JSON.stringify({ draft: [original] }, null, 2) + "\n";
  stored.set(queueStorageKey("legacy"), raw);
  store.persist.mockResolvedValue(entry(original, { state }));
  await expect(persistOutgoingPending(scope(), DRAFT_QUEUE_KEY, original).then(consume)).rejects.toBeInstanceOf(PendingQueueChangedError);
  expect(consume).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(stored.get(queueStorageKey("legacy"))).toBe(raw);
});

it("leaves notification and legacy bytes untouched when the transaction aborts", async () => {
  const original = item(), raw = '{"draft": [{"preserve": "exact original bytes"}]}\n';
  stored.set(queueStorageKey("legacy"), raw);
  store.persist.mockRejectedValue(new PendingQueueStorageError());
  await expect(persistOutgoingPending(scope(), DRAFT_QUEUE_KEY, original)).rejects.toBeInstanceOf(PendingQueueStorageError);
  expect(dispatch).not.toHaveBeenCalled();
  expect(stored.get(queueStorageKey("legacy"))).toBe(raw);
});

it("binds only the explicitly continued item and records acceptance as a tombstone", async () => {
  const original = item(), identity = scope();
  await adoptOutgoingPending(identity, "session", original);
  expect(store.bind).toHaveBeenCalledExactlyOnceWith(identity, original, "session");
  store.get.mockResolvedValue(entry(original, { sessionId: "session" }));
  await completeOutgoingPending(identity, "session", original);
  expect(store.accept).toHaveBeenCalledExactlyOnceWith(identity, original, original.id);
  expect(stored.size).toBe(0);
});

it("refuses completion from another session and propagates changed immutable payload conflicts", async () => {
  const original = item();
  store.get.mockResolvedValue(entry(original, { sessionId: "other" }));
  await expect(completeOutgoingPending(scope(), "session", original)).rejects.toBeInstanceOf(PendingQueueChangedError);
  expect(store.accept).not.toHaveBeenCalled();
  store.get.mockResolvedValue(entry(original, { sessionId: "session" }));
  store.accept.mockRejectedValue(new PendingQueueChangedError());
  await expect(completeOutgoingPending(scope(), "session", { ...original, text: "A later local edit" })).rejects.toBeInstanceOf(PendingQueueChangedError);
});

it("lists only live items for the selected session while accepted and withdrawn records remain in the store", async () => {
  const draft = item(), pending = item(), accepted = item(), withdrawn = item(), other = item();
  store.list.mockResolvedValue([
    entry(draft), entry(pending, { sessionId: "session" }),
    entry(accepted, { sessionId: "session", state: "accepted", serverJobId: accepted.id }),
    entry(withdrawn, { sessionId: "session", state: "withdrawn" }),
    entry(other, { sessionId: "other" }),
  ]);
  expect(await readPendingQueue(scope(), DRAFT_QUEUE_KEY)).toEqual([draft]);
  expect(await readPendingQueue(scope(), "session")).toEqual([pending]);
  await withdrawOutgoingPending(scope(), pending);
  expect(store.withdraw).toHaveBeenCalledExactlyOnceWith(scope(), pending);
});

it("isolates live holds and network locks by target origin, account, connection and profile", async () => {
  const original = item(), identity = scope();
  const release = holdPendingDelivery(identity, original.id);
  expect(pendingDeliveryHeld(identity, original.id)).toBe(true);
  for (const different of [scope({ docaOrigin: "https://other.test" }), scope({ userId: "other" }), scope({ connectionId: "other" }), scope({ profile: { id: "other", revision: 3 } }), scope({ profile: { id: "profile", revision: 4 } })])
    expect(pendingDeliveryHeld(different, original.id)).toBe(false);
  const request = vi.fn(async (_name, _options, callback) => callback());
  vi.stubGlobal("navigator", { locks: { request } });
  expect(await withPendingDeliveryLock(identity, "session", async () => "accepted")).toBe("accepted");
  expect(request.mock.calls[0]![0]).toBe(`doca-ai-pending:${pendingScopeKey(identity)}:session`);
  release();
  expect(pendingDeliveryHeld(identity, original.id)).toBe(false);
});

it("refuses delivery without a cross-page lock rather than falling back to an unlocked sender", async () => {
  vi.stubGlobal("navigator", {});
  const work = vi.fn();
  await expect(withPendingDeliveryLock(scope(), "session", work)).rejects.toBeInstanceOf(PendingQueueStorageError);
  expect(work).not.toHaveBeenCalled();
});

it("recovers a lost accepted reply with the same original ID and readonly reconciliation only", async () => {
  const original = item();
  let posts = 0, accepted = false;
  const paths: { path: string; method: string }[] = [];
  const flush = vi.fn(async () => {});
  const request = (async (path: string, method = "GET", body?: any) => {
    paths.push({ path, method });
    if (method === "GET") return { session: { model_id: "test" }, jobs: accepted ? [{ id: original.id, status: "completed", model_id: "test" }] : [], messages: accepted ? [{ ...original, role: "user", explorer: [] }] : [] };
    expect(body.id).toBe(original.id);
    posts++;
    accepted = true;
    throw new Error("reply lost after commit");
  }) as any;
  await expect(sendOrReconcilePendingItem("session", original, request, flush)).rejects.toThrow("reply lost");
  const afterRefresh = paths.length;
  expect((await sendOrReconcilePendingItem("session", structuredClone(original), request, flush)).state).toBe("accepted");
  expect(paths.slice(afterRefresh)).toEqual([{ path: `/ai/sessions/session?pendingId=${original.id}`, method: "GET" }]);
  expect(posts).toBe(1);
  expect(flush).toHaveBeenCalledTimes(1);
});

it.each(["failed", "cancelled", "interrupted", "completed"])("treats an authoritative %s job as accepted without capture or another POST", async status => {
  const original = item(), flush = vi.fn();
  const request = vi.fn(async () => ({ session: { model_id: "test" }, jobs: [{ id: original.id, status, model_id: "test" }], messages: [{ ...original, role: "user", explorer: [] }] })) as any;
  expect((await sendOrReconcilePendingItem("session", original, request, flush)).state).toBe("accepted");
  expect(request).toHaveBeenCalledTimes(1);
  expect(flush).not.toHaveBeenCalled();
});

it("retains an accepted job's differing local payload and never posts it under the accepted ID", async () => {
  const original = item(), flush = vi.fn();
  const request = vi.fn(async () => ({ session: { model_id: "test" }, jobs: [{ id: original.id, status: "completed", model_id: "test" }], messages: [{ ...original, text: "A different server payload", role: "user", explorer: [] }] })) as any;
  await expect(sendOrReconcilePendingItem("session", original, request, flush)).rejects.toMatchObject({ code: "pending_message_conflict" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(flush).not.toHaveBeenCalled();
});

it("exposes known legacy items only as readonly explicit-continue candidates and preserves exact bytes", async () => {
  const original = item(), raw = JSON.stringify({ draft: [original] }, null, 2) + "\n";
  stored.set(queueStorageKey("legacy"), raw);
  const legacy = await readLegacyPendingQueue(scope(), "legacy", DRAFT_QUEUE_KEY);
  expect(legacy.unknown).toBe(false);
  expect(legacy.items).toEqual([{ item: original, source: { storageKey: queueStorageKey("legacy"), sessionKey: DRAFT_QUEUE_KEY, hash: await hashPendingItem(original) }, conflict: false }]);
  expect(stored.get(queueStorageKey("legacy"))).toBe(raw);
  expect(store.persist).not.toHaveBeenCalled();
});

it.each(["accepted", "withdrawn"] as const)("suppresses an unchanged legacy source behind its %s tombstone without hiding a later edit", async state => {
  const original = item(), source = { storageKey: queueStorageKey("legacy"), sessionKey: DRAFT_QUEUE_KEY, hash: await hashPendingItem(original) };
  stored.set(source.storageKey, JSON.stringify({ draft: [original] }));
  store.get.mockResolvedValue(entry(original, { source, state }));
  expect((await readLegacyPendingQueue(scope(), "legacy", DRAFT_QUEUE_KEY)).items).toEqual([]);
  const edited = { ...original, text: "Later manual legacy edit" }, raw = JSON.stringify({ draft: [edited] });
  stored.set(source.storageKey, raw);
  const result = await readLegacyPendingQueue(scope(), "legacy", DRAFT_QUEUE_KEY);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.conflict).toBe(true);
  expect(result.items[0]!.item).toEqual(edited);
  expect(stored.get(source.storageKey)).toBe(raw);
});

it("preserves an unknown legacy DTO and marks it unsupported without attempting to repair or send it", async () => {
  const raw = '{"draft":[{"version":99,"id":"unknown","text":"retain everything"}]}\n';
  stored.set(queueStorageKey("legacy"), raw);
  expect(await readLegacyPendingQueue(scope(), "legacy", DRAFT_QUEUE_KEY)).toEqual({ items: [], unknown: true });
  expect(stored.get(queueStorageKey("legacy"))).toBe(raw);
  expect(store.persist).not.toHaveBeenCalled();
});

it("verifies the unchanged original legacy DTO after the user explicitly chose missing current options", async () => {
  const selected = item();
  const { modelId: _model, scope: _scope, ...legacy } = selected;
  const source = { storageKey: queueStorageKey("legacy"), sessionKey: DRAFT_QUEUE_KEY, hash: await hashPendingItem(legacy) };
  const raw = JSON.stringify({ draft: [legacy] }, null, 2) + "\n";
  stored.set(source.storageKey, raw);
  await expect(verifyLegacyPendingSource(entry(selected, { source }))).resolves.toBeUndefined();
  expect(stored.get(source.storageKey)).toBe(raw);
  expect(store.persist).not.toHaveBeenCalled();
});

it.each(["changed-text", "unknown-dto", "duplicate-id", "removed-source", "invalid-json"])("rejects %s legacy provenance changed during readonly preflight before any message POST", async change => {
  const original = item();
  const source = { storageKey: queueStorageKey("legacy"), sessionKey: DRAFT_QUEUE_KEY, hash: await hashPendingItem(original) };
  const pending = entry(original, { sessionId: "session", source });
  stored.set(source.storageKey, JSON.stringify({ draft: [original] }));
  const raw = change === "changed-text" ? JSON.stringify({ draft: [{ ...original, text: "A later edit from another page" }] })
    : change === "unknown-dto" ? JSON.stringify({ draft: [{ ...original, futureVersion: 99 }] })
    : change === "duplicate-id" ? JSON.stringify({ draft: [original, structuredClone(original)] })
    : change === "removed-source" ? JSON.stringify({ draft: [] }) : '{"draft": [invalid';
  const request = vi.fn(async (_path: string, method = "GET") => {
    expect(method).toBe("GET");
    // This is the final provenance recheck after the server GET. A stale
    // candidate from the modal/list must not authorize the following POST.
    stored.set(source.storageKey, raw);
    return { session: { model_id: "test" }, jobs: [], messages: [] };
  }) as any;
  await expect(sendOrReconcilePendingItem("session", original, request, () => verifyLegacyPendingSource(pending))).rejects.toBeInstanceOf(PendingQueueChangedError);
  expect(request).toHaveBeenCalledTimes(1);
  expect(stored.get(source.storageKey)).toBe(raw);
  expect(store.persist).not.toHaveBeenCalled();
  expect(store.accept).not.toHaveBeenCalled();
});

it("reports denied legacy source reads without weakening the final POST guard", async () => {
  const original = item(), source = { storageKey: queueStorageKey("legacy"), sessionKey: DRAFT_QUEUE_KEY, hash: await hashPendingItem(original) };
  vi.stubGlobal("localStorage", { getItem() { throw new DOMException("Denied", "SecurityError"); } });
  const request = vi.fn(async () => ({ session: { model_id: "test" }, jobs: [], messages: [] })) as any;
  await expect(sendOrReconcilePendingItem("session", original, request, () => verifyLegacyPendingSource(entry(original, { source })))).rejects.toBeInstanceOf(PendingQueueStorageError);
  expect(request).toHaveBeenCalledTimes(1);
});
