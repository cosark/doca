import type { AIChatRuntime } from "./ai-runtime.js";

export type BrowserPageCapture = { captureRequestId: string; title: string; url: string };
export function createBrowserAssistantRequest(options: {
  request: AIChatRuntime["request"];
  profile: { id: string; revision: number };
  captureCurrentPage: () => Promise<BrowserPageCapture>;
  captured: (capture: BrowserPageCapture) => void;
}, captures: Map<string, Promise<BrowserPageCapture>>): AIChatRuntime["request"] {
  return async (path, method = "GET", body, signal) => {
    signal?.throwIfAborted();
    if (method === "GET" && /^\/ai\/sessions(?:\?|$)/.test(path))
      return options.request(`/ai/sessions?profileId=${encodeURIComponent(options.profile.id)}`, method, undefined, signal);
    if (method === "POST" && path === "/ai/sessions")
      return options.request(path, method, { profileId: options.profile.id, profileRevision: options.profile.revision }, signal);
    if (method === "POST" && /^\/ai\/sessions\/[^/]+\/messages$/.test(path)) {
      const input = body as { id: string; modelId: string; text: string };
      // A connection may retain chats for several profiles. Verify this exact
      // current session before preparing any page under the selected profile.
      const current = await options.request<{ browserProfile: { id: string; revision: number } }>(path.slice(0, -9), "GET", undefined, signal);
      signal?.throwIfAborted();
      if (current?.browserProfile?.id !== options.profile.id || current?.browserProfile?.revision !== options.profile.revision)
        throw Object.assign(new Error("clipper_profile_changed"), { status: 409 });
      let pending = captures.get(input.id);
      if (!pending) {
        pending = options.captureCurrentPage();
        captures.set(input.id, pending);
        pending.catch(() => { if (captures.get(input.id) === pending) captures.delete(input.id); });
      }
      const capture = await pending;
      signal?.throwIfAborted();
      options.captured(capture);
      return options.request(path, method, { id: input.id, modelId: input.modelId, text: input.text, captureRequestId: capture.captureRequestId }, signal);
    }
    if ((method === "GET" && (path === "/ai/options" || /^\/ai\/sessions\/[^/?]+(?:\?(?:page=\d+|pendingId=[a-f0-9-]{36}))?$/i.test(path))) ||
      (method === "POST" && /^\/ai\/jobs\/[^/]+\/(?:cancel|approval)$/.test(path)))
      return options.request(path, method, body, signal);
    throw Object.assign(new Error("clipper_scope_denied"), { status: 403 });
  };
}
