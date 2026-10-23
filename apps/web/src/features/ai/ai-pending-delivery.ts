import { DRAFT_QUEUE_KEY, notifyPendingQueue, queueStorageKey, type PendingSendItem } from "./ai-session-ux.js";
import {
  bindPendingSession, getPendingEntry, hashPendingItem, listPendingEntries,
  markPendingAccepted, persistPendingEntry, promotePendingEntry,
  withdrawPendingEntry, pendingScopeKey,
  validatePendingItem,
  PendingQueueChangedError, PendingQueueStorageError,
  type PendingQueueScope, type PendingEntry, type LegacyPendingSource, type LegacyPendingInitialState,
} from "./ai-pending-store.js";
export { PendingQueueChangedError, PendingQueueStorageError, pendingScopeKey };
export type { PendingQueueScope, PendingEntry, LegacyPendingSource };

const holds = new Map<string, number>();
const keyFor = (scope: PendingQueueScope, itemId: string) => `${pendingScopeKey(scope)}:${itemId}`;
export function pendingDeliveryHeld(scope: PendingQueueScope, itemId: string) { return holds.has(keyFor(scope, itemId)); }
export function holdPendingDelivery(scope: PendingQueueScope, itemId: string) {
  const key = keyFor(scope, itemId);
  holds.set(key, (holds.get(key) ?? 0) + 1);
  return () => {
    const count = (holds.get(key) ?? 1) - 1;
    if (count) holds.set(key, count); else holds.delete(key);
    changed(scope);
  };
}

function changed(scope: PendingQueueScope) {
  notifyPendingQueue();
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel("doca-ai-pending-v1");
      channel.postMessage(pendingScopeKey(scope));
      channel.close();
    } catch { /* Notifications are not the committed queue. Readers also poll. */ }
  }
}
export function subscribePendingStore(scope: PendingQueueScope, callback: () => void) {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("doca-ai-pending-v1");
  if (channel) channel.onmessage = event => { if (event.data === pendingScopeKey(scope)) callback(); };
  return () => channel?.close();
}

/** A missing cross-page sender lock stops delivery; storage never falls back. */
export async function withPendingDeliveryLock<T>(scope: PendingQueueScope, sessionId: string, work: () => Promise<T>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new PendingQueueStorageError();
  return navigator.locks.request(`doca-ai-pending:${pendingScopeKey(scope)}:${sessionId}`, { signal }, work);
}

export { samePendingItem } from "./ai-pending-store.js";
export const readPendingEntries = listPendingEntries;
export async function readPendingQueue(scope: PendingQueueScope, sessionKey: string) {
  const sessionId = sessionKey === DRAFT_QUEUE_KEY ? null : sessionKey;
  return (await listPendingEntries(scope)).filter(entry => entry.state === "pending" && entry.sessionId === sessionId)
    .sort((a, b) => {
      const movedA = a.updatedAt > a.createdAt, movedB = b.updatedAt > b.createdAt;
      if (movedA !== movedB) return movedA ? -1 : 1;
      return (movedA ? b.updatedAt.localeCompare(a.updatedAt) : a.createdAt.localeCompare(b.createdAt)) || a.messageId.localeCompare(b.messageId);
    }).map(entry => entry.item);
}
export async function persistOutgoingPending(scope: PendingQueueScope, sessionKey: string, item: PendingSendItem, source?: LegacyPendingSource, initial?: LegacyPendingInitialState) {
  const entry = await persistPendingEntry(scope, sessionKey === DRAFT_QUEUE_KEY ? null : sessionKey, item, source, initial);
  if (initial === undefined && entry.state !== "pending") throw new PendingQueueChangedError();
  changed(scope);
  return entry;
}
export async function adoptOutgoingPending(scope: PendingQueueScope, sessionId: string, item: PendingSendItem) {
  const entry = await bindPendingSession(scope, item, sessionId);
  changed(scope);
  return entry;
}
export async function completeOutgoingPending(scope: PendingQueueScope, sessionId: string, item: PendingSendItem, serverJobId = item.id) {
  const entry = await getPendingEntry(scope, item.id);
  if (!entry || entry.sessionId !== sessionId) throw new PendingQueueChangedError();
  await markPendingAccepted(scope, item, serverJobId);
  changed(scope);
}
export async function withdrawOutgoingPending(scope: PendingQueueScope, item: PendingSendItem) {
  await withdrawPendingEntry(scope, item); changed(scope);
}
export async function promoteOutgoingPending(scope: PendingQueueScope, item: PendingSendItem) {
  await promotePendingEntry(scope, item); changed(scope);
}

export type LegacyPendingItem = { item: PendingSendItem; source: LegacyPendingSource; conflict: boolean };
/** Recheck approved legacy provenance before a resumed pending item can POST. */
export async function verifyLegacyPendingSource(entry: PendingEntry) {
  if (!entry.source) return;
  let raw: string | null;
  try { raw = localStorage.getItem(entry.source.storageKey); } catch { throw new PendingQueueStorageError(); }
  let stored: unknown;
  try { stored = JSON.parse(raw ?? "null"); } catch { throw new PendingQueueChangedError(); }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new PendingQueueChangedError();
  const items = (stored as Record<string, unknown>)[entry.source.sessionKey];
  if (!Array.isArray(items)) throw new PendingQueueChangedError();
  const matches = items.filter(item => item && typeof item === "object" && item.id === entry.messageId);
  if (matches.length !== 1 || !validatePendingItem(matches[0], false) || await hashPendingItem(matches[0]) !== entry.source.hash) throw new PendingQueueChangedError();
}
/** Approved explicit legacy surface. Raw 0.2.7 bytes are never written back. */
export async function readLegacyPendingQueue(scope: PendingQueueScope, legacyUserId: string, sessionKey: string) {
  const storageKey = queueStorageKey(legacyUserId);
  let raw: string | null;
  try { raw = localStorage.getItem(storageKey); } catch { throw new PendingQueueStorageError(); }
  const items: LegacyPendingItem[] = [];
  if (raw === null) return { items, unknown: false };
  let stored: unknown;
  try { stored = JSON.parse(raw); } catch { return { items, unknown: true }; }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { items, unknown: true };
  const value = (stored as Record<string, unknown>)[sessionKey];
  if (value === undefined) return { items, unknown: Object.values(stored).some(value => !Array.isArray(value)) };
  if (!Array.isArray(value)) return { items, unknown: true };
  let unknown = false;
  for (const valueItem of value) {
    if (!validatePendingItem(valueItem, false)) { unknown = true; continue; }
    try {
      const hash = await hashPendingItem(valueItem);
      const item = valueItem as PendingSendItem;
      const source = { storageKey, sessionKey, hash };
      let existing: PendingEntry | null;
      try { existing = await getPendingEntry(scope, item.id); }
      catch (error) {
        if (error instanceof PendingQueueChangedError) { items.push({ item, source, conflict: true }); continue; }
        throw error;
      }
      if (existing?.source?.storageKey === storageKey && existing.source.sessionKey === sessionKey && existing.source.hash === hash) continue;
      items.push({ item, source, conflict: !!existing });
    } catch (error) {
      if (error instanceof PendingQueueStorageError) throw error;
      unknown = true;
    }
  }
  return { items, unknown };
}
