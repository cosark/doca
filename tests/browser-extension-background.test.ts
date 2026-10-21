import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID, webcrypto } from "node:crypto";
import { expect, it } from "vitest";
const source = await readFile(
  new URL("../apps/browser-extension/background.js", import.meta.url),
  "utf8",
);
const origin = "https://doca.example.test",
  connectionId = randomUUID();
const config = {
  version: 2,
  origin,
  connectionId,
  token: "doca_browser_v2_" + "1".repeat(64),
  expiresAt: "2099-01-01T00:00:00Z",
};
function runtime() {
  const local: Record<string, any> = {
      site: { version: 2, origin },
      installationId: randomUUID(),
    },
    session: Record<string, any> = { authorization: { ...config } };
  const area = (values: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]]),
      ),
    set: async (next: any) => Object.assign(values, next),
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  });
  const context = vm.createContext({
    URL,
    crypto: {
      randomUUID,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: webcrypto.subtle,
    },
    TextEncoder,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
    chrome: {
      storage: { local: area(local), session: area(session) },
      runtime: {
        id: "fixture",
        getURL: (path: string) => "chrome-extension://fixture/" + path,
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} },
      },
      tabs: { query: async () => [] },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        items: [],
        user: { id: "fixture" },
        connection: { assistant_enabled: 1 },
      }),
    }),
  });
  vm.runInContext(source, context);
  return {
    context,
    local,
    session,
    handle: (message: any, sender: any) => context.handle(message, sender),
  };
}
it("recognizes extension UI opened in a tab and denies privileged page messages", async () => {
  const r = runtime(),
    ui = {
      id: "fixture",
      url: "chrome-extension://fixture/ui.html#assistant",
      tab: { id: 1 },
    };
  await expect(r.handle({ type: "assistantNew" }, ui)).resolves.toEqual({
    sessionId: null,
    jobs: [],
  });
  await expect(
    r.handle(
      { type: "assistantNew" },
      { ...ui, url: "https://source.example.test/" },
    ),
  ).rejects.toThrow("clipper_scope_denied");
  await expect(
    r.handle({ type: "state" }, { ...ui, id: "other" }),
  ).rejects.toThrow("clipper_scope_denied");
});
it("rejects unknown configuration without overwriting current credentials or material", async () => {
  const r = runtime();
  r.session.pending = { requestId: "unsent" };
  await expect(
    r.handle(
      { type: "configure", config: JSON.stringify({ version: 1, origin }) },
      { id: "fixture", url: "chrome-extension://fixture/ui.html" },
    ),
  ).rejects.toThrow("clipper_invalid_config");
  expect(r.local.site).toEqual({ version: 2, origin });
  expect(r.session.authorization).toEqual(config);
  expect(r.session.pending.requestId).toBe("unsent");
});
it("blocks a frozen task from being sent after switching accounts or origins", async () => {
  const r = runtime();
  await expect(
    r.context.request("/clips/" + randomUUID() + "/commit", "POST", {}, false, {
      origin: "https://other.example.test",
      connectionId,
    }),
  ).rejects.toThrow("clipper_scope_denied");
  await expect(r.context.request("/auth/me")).rejects.toThrow(
    "clipper_scope_denied",
  );
});
it("does not silently substitute the default profile when the selected profile disappeared", async () => {
  const r = runtime();
  await expect(r.context.begin({}, randomUUID(), 1, 1)).rejects.toThrow(
    "clipper_profile_unavailable",
  );
});

it("retries an assistant message with the frozen body without reading or uploading a newly active page", async () => {
  const r = runtime(),
    sessionId = randomUUID(),
    requestId = randomUUID(),
    profileId = randomUUID();
  r.session.assistant = { id: sessionId, origin, connectionId, profileId };
  const body = {
    id: requestId,
    modelId: "original-model",
    text: "original instruction",
    captureRequestId: randomUUID(),
  };
  r.session.assistantDraft = {
    origin,
    connectionId,
    requestId,
    sessionId,
    body,
  };
  let posted: any;
  r.context.fetch = async (_url: string, options: any) => {
    if (options.body) posted = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: requestId }) };
  };
  await r.handle(
    {
      type: "assistantSend",
      requestId,
      profileId,
      attachPage: true,
      modelId: "changed",
      text: "changed",
    },
    {
      id: "fixture",
      url: "chrome-extension://fixture/ui.html#assistant",
      tab: { id: 1 },
    },
  );
  expect(posted).toEqual(body);
  expect(r.session.assistantDraft).toBeUndefined();
});

it("keeps drafts isolated when the website signs in as another account", async () => {
  const r = runtime();
  r.session.pending = { requestId: "account-a" };
  const other = { ...config, connectionId: randomUUID(), userId: randomUUID() };
  await r.context.rememberAuthorization(other);
  expect(r.session.pending).toBeNull();
  await r.context.rememberAuthorization(config);
  expect(r.session.pending.requestId).toBe("account-a");
});
it("rejects forged or mismatched website login callbacks", async () => {
  const r = runtime();
  r.session.loginFlow = {
    state: randomUUID(),
    origin,
    tabId: 10,
    expiresAt: Date.now() + 10000,
  };
  await expect(
    r.context.loginResult(
      {
        state: r.session.loginFlow.state,
        status: "authorized",
        code: "a".repeat(64),
      },
      {
        id: "fixture",
        url: origin + "/#/browser-connect?state=x",
        tab: { id: 11 },
      },
    ),
  ).rejects.toThrow("clipper_scope_denied");
});

it("avoids repeated authorization tabs while a cookie-blocked browser has a recent same-origin login proof", async () => {
  const r = runtime();
  r.session.cookieProbeUnsupported = true;
  r.session.websiteProofAt = Date.now();
  r.context.fetch = async () => {
    throw Error("Should reuse the recent website proof for passive polling");
  };
  await expect(r.context.ensureLogin(false)).resolves.toEqual(config);
});
