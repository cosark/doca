import { expect, it, vi } from "vitest";
import { createBrowserAssistantRequest } from "../apps/web/src/features/ai/browser-assistant-transport.js";

it("projects the shared UI onto the selected browser profile without forwarding workspace controls", async () => {
  const forwarded = vi.fn(async () => ({}));
  const request = createBrowserAssistantRequest({ request: forwarded as any, profile: { id: "profile-one", revision: 7 }, captureCurrentPage: vi.fn(), captured: vi.fn() }, new Map());
  await request("/ai/sessions", "POST", { modelId: "model", resourceIds: ["outside"] });
  expect(forwarded.mock.calls[0]).toEqual(["/ai/sessions", "POST", { profileId: "profile-one", profileRevision: 7 }, undefined]);
  await request("/ai/sessions?archived=false&resourceId=outside");
  expect(forwarded.mock.calls[1]).toEqual(["/ai/sessions?profileId=profile-one", "GET", undefined, undefined]);
  await expect(request("/resources/outside")).rejects.toMatchObject({ status: 403 });
  await expect(request("/ai/sessions/a", "DELETE")).rejects.toMatchObject({ status: 403 });
  expect(forwarded).toHaveBeenCalledTimes(2);
});

it("keeps one current-page capture for concurrent delivery and an explicit retry of the same message", async () => {
  const capture = { captureRequestId: "receipt-one", title: "Page", url: "https://example.test/page" };
  const captureCurrentPage = vi.fn(async () => capture);
  const forwarded = vi.fn(async () => ({ browserProfile: { id: "profile-one", revision: 1 } }));
  const options = { request: forwarded as any, profile: { id: "profile-one", revision: 1 }, captureCurrentPage, captured: vi.fn() };
  const captures = new Map();
  const request = createBrowserAssistantRequest(options, captures);
  const input = { id: "message-one", modelId: "model", text: "Summarize", webSearch: true, skipApprovals: { create: true }, attachments: ["outside"] };
  await Promise.all([request("/ai/sessions/chat/messages", "POST", input), request("/ai/sessions/chat/messages", "POST", input)]);
  expect(captureCurrentPage).toHaveBeenCalledTimes(1);
  for (const call of forwarded.mock.calls.filter((call: any[]) => call[1] === "POST"))
    expect(call).toEqual(["/ai/sessions/chat/messages", "POST", { id: "message-one", modelId: "model", text: "Summarize", captureRequestId: "receipt-one" }, undefined]);
  const afterPageUpdate = createBrowserAssistantRequest({ ...options }, captures);
  await afterPageUpdate("/ai/sessions/chat/messages", "POST", input);
  expect(captureCurrentPage).toHaveBeenCalledTimes(1);
});

it("does not submit a message when current-page preparation fails or sending is cancelled", async () => {
  const forwarded = vi.fn(async () => ({ browserProfile: { id: "profile-one", revision: 1 } }));
  const controller = new AbortController();
  const options = { request: forwarded as any, profile: { id: "profile-one", revision: 1 }, captured: vi.fn() };
  const input = { id: "message-one", modelId: "model", text: "Summarize" };
  await expect(createBrowserAssistantRequest({ ...options, captureCurrentPage: async () => { throw new Error("page denied"); } }, new Map())("/ai/sessions/chat/messages", "POST", input)).rejects.toThrow("page denied");
  const request = createBrowserAssistantRequest({ ...options, captureCurrentPage: async () => {
    controller.abort();
    return { captureRequestId: "receipt-one", title: "Page", url: "https://example.test" };
  } }, new Map());
  await expect(request("/ai/sessions/chat/messages", "POST", input, controller.signal)).rejects.toThrow();
  expect(forwarded.mock.calls.every((call: any[]) => call[1] === "GET")).toBe(true);
});

it("allows reading another retained profile history but rejects capture or sending until its original profile matches", async () => {
  const captureCurrentPage = vi.fn();
  const forwarded = vi.fn(async () => ({ browserProfile: { id: "profile-one", revision: 4 } }));
  const captures = new Map();
  const make = (id: string, revision: number) => createBrowserAssistantRequest({ request: forwarded as any, profile: { id, revision }, captureCurrentPage, captured: vi.fn() }, captures);
  const input = { id: "message", modelId: "model", text: "Use this page" };
  await make("profile-two", 1)("/ai/sessions/original");
  for (const request of [make("profile-two", 1), make("profile-one", 3)])
    await expect(request("/ai/sessions/original/messages", "POST", input)).rejects.toMatchObject({ status: 409 });
  expect(captureCurrentPage).not.toHaveBeenCalled();
  expect(captures.size).toBe(0);
  expect(forwarded.mock.calls.every((call: any[]) => call[1] !== "POST")).toBe(true);
  captureCurrentPage.mockResolvedValue({ captureRequestId: "receipt", title: "Page", url: "https://example.test/" });
  await make("profile-one", 4)("/ai/sessions/original/messages", "POST", input);
  expect(captureCurrentPage).toHaveBeenCalledOnce();
  expect(forwarded.mock.calls.filter((call: any[]) => call[1] === "POST")).toHaveLength(1);
});

it("requires a current authoritative profile response before capturing, without inventing a profile for missing or unauthorized data", async () => {
  for (const response of [null, {}, { browserProfile: { id: "profile-one" } }]) {
    const captureCurrentPage = vi.fn();
    const request = createBrowserAssistantRequest({ request: (async () => response) as any, profile: { id: "profile-one", revision: 1 }, captureCurrentPage, captured: vi.fn() }, new Map());
    await expect(request("/ai/sessions/chat/messages", "POST", { id: "message", modelId: "model", text: "Summarize" })).rejects.toBeDefined();
    expect(captureCurrentPage).not.toHaveBeenCalled();
  }
  const captureCurrentPage = vi.fn();
  const request = createBrowserAssistantRequest({ request: (async () => { throw Object.assign(new Error("revoked"), { status: 401 }); }) as any, profile: { id: "profile-one", revision: 1 }, captureCurrentPage, captured: vi.fn() }, new Map());
  await expect(request("/ai/sessions/chat/messages", "POST", { id: "message", modelId: "model", text: "Summarize" })).rejects.toMatchObject({ status: 401 });
  expect(captureCurrentPage).not.toHaveBeenCalled();
});

it("stops before capture when the authorization boundary closes while its profile preflight is reading", async () => {
  const controller = new AbortController(), captureCurrentPage = vi.fn();
  const request = createBrowserAssistantRequest({
    request: (async () => { controller.abort(); return { browserProfile: { id: "profile-one", revision: 1 } }; }) as any,
    profile: { id: "profile-one", revision: 1 }, captureCurrentPage, captured: vi.fn(),
  }, new Map());
  await expect(request("/ai/sessions/chat/messages", "POST", { id: "message", modelId: "model", text: "Summarize" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(captureCurrentPage).not.toHaveBeenCalled();
});

it("forwards an authoritative pending-ID lookup without capturing and rejects invalid or unrelated queries", async () => {
  const sessionId = "12345678-1234-4234-8234-123456789abc";
  const pendingId = "87654321-4321-4321-8321-cba987654321";
  const forwarded = vi.fn(async () => ({}));
  const captureCurrentPage = vi.fn();
  const request = createBrowserAssistantRequest({
    request: forwarded as any,
    profile: { id: "profile-one", revision: 1 },
    captureCurrentPage,
    captured: vi.fn(),
  }, new Map());
  const controller = new AbortController();
  const path = `/ai/sessions/${sessionId}?pendingId=${pendingId}`;
  await request(path, "GET", undefined, controller.signal);
  expect(forwarded.mock.calls).toEqual([[path, "GET", undefined, controller.signal]]);
  for (const query of [
    "pendingId=invalid",
    "pendingId=",
    `pendingId=${pendingId}&outside=true`,
    `outside=${pendingId}`,
  ]) {
    await expect(request(`/ai/sessions/${sessionId}?${query}`)).rejects.toMatchObject({ status: 403 });
  }
  expect(forwarded).toHaveBeenCalledOnce();
  expect(captureCurrentPage).not.toHaveBeenCalled();
});
