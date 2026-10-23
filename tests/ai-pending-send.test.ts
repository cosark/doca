import { afterEach, expect, it, vi } from "vitest";
import {
  PendingMessageConflictError,
  reconcilePendingItem,
  sendOrReconcilePendingItem,
  sendPendingItem,
  type PendingSessionSnapshot,
} from "../apps/web/src/features/ai/ai-pending-runner.js";
import type { PendingSendItem } from "../apps/web/src/features/ai/ai-session-ux.js";

afterEach(() => vi.unstubAllGlobals());
it("uses the queued bubble identity for submission and for a retry after a lost response", async () => {
  const item: PendingSendItem = {
    id: crypto.randomUUID(), text: "queued message", createdAt: new Date().toISOString(),
    attachments: [], references: [], modelId: "mock", scope: "all",
  };
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    if (requests.length === 1) throw new Error("response lost");
    return Response.json({ id: body.id });
  }));
  await expect(sendPendingItem("session", item)).rejects.toThrow("response lost");
  expect(await sendPendingItem("session", item)).toBe(item.id);
  expect(requests.map(request => request.id)).toEqual([item.id, item.id]);
  expect(requests[0]).toEqual(requests[1]);
});

function pendingItem(): PendingSendItem {
  return {
    id: crypto.randomUUID(), text: "Summarize this page", createdAt: new Date().toISOString(),
    attachments: [], references: [], files: [], modelId: "mock", scope: "all",
  };
}

function acceptedSnapshot(item: PendingSendItem, status = "completed"): PendingSessionSnapshot {
  return {
    session: { model_id: "mock" },
    jobs: [{ id: item.id, status, model_id: "mock" }],
    messages: [{ id: item.id, role: "user", text: item.text, attachments: item.attachments, references: item.references, explorer: item.files ?? [] }],
  };
}

it("reconciles a committed POST with a lost reply after rebuilding the runner, without preparing another page or posting again", async () => {
  const original = pendingItem();
  let persisted: PendingSessionSnapshot = { session: { model_id: "mock" }, jobs: [], messages: [] };
  let posts = 0, captures = 0;
  const rebuildTransport = () => {
    const captureMemory = new Map<string, string>();
    return (async (_path: string, method = "GET", body?: any) => {
      if (method === "GET") return structuredClone(persisted);
      posts++;
      if (!captureMemory.has(body.id)) {
        captures++;
        captureMemory.set(body.id, `page-capture-${captures}`);
      }
      persisted = acceptedSnapshot(original, "running");
      throw new Error("RPC reply lost after commit");
    }) as any;
  };
  await expect(sendOrReconcilePendingItem("session", original, rebuildTransport())).rejects.toThrow("RPC reply lost after commit");
  persisted.jobs[0]!.status = "completed";
  const reopenedPending = JSON.parse(JSON.stringify(original)) as PendingSendItem;
  const flush = vi.fn(async () => {});
  expect(await sendOrReconcilePendingItem("session", reopenedPending, rebuildTransport(), flush)).toEqual({ state: "accepted", id: original.id });
  expect(posts).toBe(1);
  expect(captures).toBe(1);
  expect(flush).not.toHaveBeenCalled();
});

it.each(["queued", "running", "awaiting_approval", "completed", "failed", "cancelled"])("recognizes accepted identity before checking active work (%s)", async status => {
  const item = pendingItem();
  const snapshot = acceptedSnapshot(item, status);
  snapshot.jobs.push({ id: crypto.randomUUID(), status: "running", model_id: "mock" });
  const request = vi.fn(async () => snapshot);
  expect(await sendOrReconcilePendingItem("session", item, request as any)).toEqual({ state: "accepted", id: item.id });
  expect(request).toHaveBeenCalledExactlyOnceWith(`/ai/sessions/session?pendingId=${item.id}`);
});

it.each(["text", "attachments", "references", "files", "model"])("keeps a changed local pending item for review instead of discarding it or submitting it (%s)", async field => {
  const original = pendingItem();
  const snapshot = acceptedSnapshot(original);
  const edited = structuredClone(original);
  if (field === "text") edited.text = "A new local edit";
  if (field === "attachments") edited.attachments = [{ id: "another-asset", filename: "new.png", mime: "image/png", size: 1 }];
  if (field === "references") edited.references = [{ resourceId: "another-document", label: "New reference" }];
  if (field === "files") edited.files = [{ kind: "file", id: "another-file", name: "New file" }];
  if (field === "model") edited.modelId = "another-model";
  const before = structuredClone(edited);
  const request = vi.fn(async () => snapshot);
  const flush = vi.fn(async () => {});
  expect(reconcilePendingItem(edited, snapshot)).toBe("conflict");
  await expect(sendOrReconcilePendingItem("session", edited, request as any, flush)).rejects.toMatchObject({ code: "pending_message_conflict", status: 409, reason: "conflict" });
  expect(edited).toEqual(before);
  expect(request).toHaveBeenCalledExactlyOnceWith(`/ai/sessions/session?pendingId=${edited.id}`);
  expect(flush).not.toHaveBeenCalled();
});

it("retains an accepted pending copy when the current history page cannot verify its content, without reposting", async () => {
  const item = pendingItem();
  const snapshot = acceptedSnapshot(item);
  snapshot.messages = [];
  const request = vi.fn(async () => snapshot);
  expect(reconcilePendingItem(item, snapshot)).toBe("unverified");
  await expect(sendOrReconcilePendingItem("session", item, request as any)).rejects.toBeInstanceOf(PendingMessageConflictError);
  expect(request).toHaveBeenCalledExactlyOnceWith(`/ai/sessions/session?pendingId=${item.id}`);
});

it("waits for authoritative history when an accepted queued job has not saved its user message yet", async () => {
  const item = pendingItem();
  const snapshot = acceptedSnapshot(item, "queued");
  snapshot.messages = [];
  const request = vi.fn(async () => snapshot);
  expect(await sendOrReconcilePendingItem("session", item, request as any)).toEqual({ state: "waiting" });
  expect(request).toHaveBeenCalledExactlyOnceWith(`/ai/sessions/session?pendingId=${item.id}`);
});

it.each(["read", "flush"])("retains the local item and stops before POST when its mounted authorization boundary closes during %s", async phase => {
  const item = pendingItem(), controller = new AbortController();
  const snapshot: PendingSessionSnapshot = { session: { model_id: "mock" }, messages: [], jobs: [] };
  const request = vi.fn(async () => {
    if (phase === "read") controller.abort();
    return snapshot;
  });
  const flush = vi.fn(async () => { if (phase === "flush") controller.abort(); });
  const original = structuredClone(item);
  await expect(sendOrReconcilePendingItem("session", item, request as any, flush, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(request).toHaveBeenCalledExactlyOnceWith(`/ai/sessions/session?pendingId=${item.id}`, "GET", undefined, controller.signal);
  expect(item).toEqual(original);
});
