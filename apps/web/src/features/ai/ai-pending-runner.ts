import { useEffect, useRef } from "react";
import { api } from "@web/shared/api.js";
import { pendingQueueScope, useAIChatRuntime, type AIJobStream } from "./ai-runtime.js";
import { completeOutgoingPending, pendingDeliveryHeld, pendingScopeKey, PendingQueueChangedError, readPendingEntries, readPendingQueue, subscribePendingStore, verifyLegacyPendingSource, withPendingDeliveryLock } from "./ai-pending-delivery.js";
import { getPendingEntry, samePendingItem } from "./ai-pending-store.js";
import {
  PENDING_QUEUE_EVENT,
  sessionHasActiveJob,
  type PendingSendItem,
} from "@web/features/ai/ai-session-ux.js";

export type PendingSessionSnapshot = {
  session: { model_id: string | null };
  jobs: { id: string; status: string; model_id: string | null }[];
  messages: {
    id: string;
    role: string;
    text: string;
    attachments: { id: string }[];
    references: PendingSendItem["references"];
    explorer: NonNullable<PendingSendItem["files"]>;
  }[];
};

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    : entry);
}

/** The server job ID is authoritative acceptance, regardless of its final state.
 * Content must also match before discarding the local pending copy.
 */
export function reconcilePendingItem(item: PendingSendItem, snapshot: PendingSessionSnapshot) {
  const job = snapshot.jobs.find((entry) => entry.id === item.id);
  if (!job) return "unseen" as const;
  const message = snapshot.messages.find((entry) => entry.id === item.id && entry.role === "user");
  if (!message) return "unverified" as const;
  return message.text === item.text &&
    stableValue(message.attachments.map((file) => file.id)) === stableValue(item.attachments.map((file) => file.id)) &&
    stableValue(message.references) === stableValue(item.references) &&
    stableValue(message.explorer) === stableValue(item.files ?? []) &&
    (!item.modelId || item.modelId === job.model_id)
    ? "accepted" as const
    : "conflict" as const;
}

export class PendingMessageConflictError extends Error {
  readonly code = "pending_message_conflict";
  readonly status = 409;
  constructor(readonly reason: "unverified" | "conflict") {
    super("The server already accepted this message. Its pending copy is retained because the content differs or cannot yet be verified. Review or withdraw it before sending again.");
  }
}

export async function sendOrReconcilePendingItem(
  sessionId: string,
  item: PendingSendItem,
  request: typeof api = api,
  flush?: () => Promise<void>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const path = `/ai/sessions/${sessionId}?pendingId=${encodeURIComponent(item.id)}`;
  const snapshot = signal
    ? await request<PendingSessionSnapshot>(path, "GET", undefined, signal)
    : await request<PendingSessionSnapshot>(path);
  signal?.throwIfAborted();
  const reconciliation = reconcilePendingItem(item, snapshot);
  if (reconciliation === "accepted") return { state: "accepted" as const, id: item.id };
  if (reconciliation === "unverified" && sessionHasActiveJob(snapshot.jobs))
    return { state: "waiting" as const };
  if (reconciliation === "conflict" || reconciliation === "unverified")
    throw new PendingMessageConflictError(reconciliation);
  if (sessionHasActiveJob(snapshot.jobs)) return { state: "waiting" as const };
  await flush?.();
  signal?.throwIfAborted();
  const id = await sendPendingItem(sessionId, item, request, signal);
  return { state: "sent" as const, id };
}

export async function sendPendingItem(
  sessionId: string,
  item: PendingSendItem,
  request: typeof api = api,
  signal?: AbortSignal,
) {
  const modelId = item.modelId;
  if (!modelId || !["all", "document"].includes(item.scope ?? "")) throw new PendingQueueChangedError();
  const id = item.id;
  signal?.throwIfAborted();
  await request(`/ai/sessions/${sessionId}/messages`, "POST", {
    id,
    text: item.text,
    attachments: item.attachments.map((file) => file.id),
    ...(item.files?.length ? { files: item.files } : {}),
    modelId,
    scope: item.scope,
    currentResourceId: item.currentResourceId,
    currentFolder: item.currentFolder,
    references: item.references,
    skillIds: item.skillIds ?? [],
    webSearch: item.webSearch !== false,
    skipApprovals: item.skipApprovals,
  }, signal);
  return id;
}

export function usePendingSendRunner(
  userId: string | undefined,
  flush?: () => Promise<void>,
  onError?: (error: Error) => void,
  activeSessionId?: string | null,
) {
  const runtime = useAIChatRuntime();
  const api = runtime.request;
  const identity = userId ? pendingScopeKey(pendingQueueScope(runtime, userId)) : "";
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    if (!userId) return;
    const scope = pendingQueueScope(runtime, userId);
    let stopped = false;
    const controller = new AbortController();
    const assertActive = () => {
      if (currentIdentity.current !== identity || stopped) controller.abort();
      controller.signal.throwIfAborted();
    };
    const scopedRequest: typeof api = async <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => {
      assertActive();
      const result = await api<T>(path, method, body, signal);
      assertActive();
      return result;
    };
    const locks = new Set<string>();
    const cooldown = new Map<string, number>();
    const blocked = new Map<string, number>();
    const sources = new Map<string, AIJobStream>();

    const drain = async (sessionId: string, fromComplete = false) => {
      if (stopped || locks.has(sessionId)) return;
      if (!fromComplete && Date.now() < (cooldown.get(sessionId) ?? 0)) return;
      if (Date.now() < (blocked.get(sessionId) ?? 0)) return;
      const item = (await readPendingQueue(scope, sessionId))[0];
      assertActive();
      if (!item) return;
      if (pendingDeliveryHeld(scope, item.id)) return;
      locks.add(sessionId);
      const work = async () => {
        const current = (await readPendingQueue(scope, sessionId))[0];
        assertActive();
        if (!current || current.id !== item.id) return;
        const delivery = await sendOrReconcilePendingItem(sessionId, current, scopedRequest, async () => {
          await flushRef.current?.();
          const latest = await getPendingEntry(scope, current.id);
          if (!latest || latest.state !== "pending" || latest.sessionId !== sessionId || !samePendingItem(latest.item, current)) throw new PendingQueueChangedError();
          await verifyLegacyPendingSource(latest);
          assertActive();
        }, controller.signal);
        controller.signal.throwIfAborted();
        if (delivery.state === "waiting") {
          cooldown.delete(sessionId);
          return;
        }
        try { await completeOutgoingPending(scope, sessionId, current, delivery.id); }
        catch (error) {
          if (error instanceof PendingQueueChangedError && delivery.state === "sent") await api(`/ai/jobs/${delivery.id}/cancel`, "POST");
          throw error;
        }
        cooldown.set(sessionId, Date.now() + 2000);
        blocked.delete(sessionId);
      };
      try {
        await withPendingDeliveryLock(scope, sessionId, work, controller.signal);
      } catch (error) {
        if (error instanceof PendingMessageConflictError) errorRef.current?.(error);
        else if (error instanceof PendingQueueChangedError) errorRef.current?.(new PendingMessageConflictError("conflict"));
        else if (!controller.signal.aborted) errorRef.current?.(error as Error);
        const status = (error as Error & { status?: number }).status;
        blocked.set(
          sessionId,
          Date.now() + (status === 404 || status === 403 ? 60_000 : 8_000),
        );
      } finally {
        locks.delete(sessionId);
      }
    };

    const watch = (sessionId: string) => {
      if (sources.has(sessionId)) return;
      const source = runtime.stream(sessionId);
      source.addEventListener("job", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as {
          status?: string;
        };
        if (
          data.status &&
          ["queued", "running", "awaiting_approval"].includes(data.status)
        ) {
          cooldown.delete(sessionId);
          return;
        }
        void drain(sessionId, true).catch(error => { if (!stopped) errorRef.current?.(error); });
      });
      source.addEventListener("revoked", () => {
        source.close();
        sources.delete(sessionId);
      });
      sources.set(sessionId, source);
    };

    const sync = async () => {
      try {
      const ids = new Set((await readPendingEntries(scope)).filter(entry => entry.state === "pending" && entry.sessionId !== null &&
        (activeSessionId === undefined || entry.sessionId === activeSessionId)).map(entry => entry.sessionId!));
      if (stopped) return;
      for (const [sessionId, source] of sources) {
        if (ids.has(sessionId)) continue;
        source.close();
        sources.delete(sessionId);
      }
      for (const sessionId of ids) {
        watch(sessionId);
        void drain(sessionId).catch(error => { if (!stopped) errorRef.current?.(error); });
      }
      } catch (error) { if (!stopped) errorRef.current?.(error as Error); }
    };

    void sync();
    const unsubscribe = subscribePendingStore(scope, () => void sync());
    const timer = setInterval(sync, 2000);
    window.addEventListener(PENDING_QUEUE_EVENT, sync);
    window.addEventListener("storage", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stopped = true;
      unsubscribe();
      controller.abort();
      clearInterval(timer);
      window.removeEventListener(PENDING_QUEUE_EVENT, sync);
      window.removeEventListener("storage", sync);
      document.removeEventListener("visibilitychange", sync);
      for (const source of sources.values()) source.close();
    };
  }, [userId, runtime.request, runtime.stream, activeSessionId, identity]);
}
