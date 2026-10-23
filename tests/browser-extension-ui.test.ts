import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
// @ts-expect-error jsdom is a runtime-only fixture dependency in this workspace.
import { JSDOM } from "jsdom";

const read = (file: string) =>
  readFile(
    new URL("../apps/browser-extension/" + file, import.meta.url),
    "utf8",
  );
const flush = async () => {
  for (let turn = 0; turn < 4; turn++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
type NoteTarget = {
  profileId: string;
  profileRevision: number;
  profileName: string;
  isDefault: boolean;
  targetId: string;
  title: string;
  format: "rich_text" | "markdown";
};
type QuickNoteReply = (message: any) => Promise<any>;
const noteTargets: [NoteTarget, NoteTarget] = [
  {
    profileId: "11111111-1111-4111-8111-111111111111",
    profileRevision: 3,
    profileName: "Quick notes",
    isDefault: true,
    targetId: "22222222-2222-4222-8222-222222222222",
    title: "Existing rich text",
    format: "rich_text",
  },
  {
    profileId: "33333333-3333-4333-8333-333333333333",
    profileRevision: 2,
    profileName: "Markdown notes",
    isDefault: false,
    targetId: "44444444-4444-4444-8444-444444444444",
    title: "Existing Markdown",
    format: "markdown",
  },
];
const noteAck = (message: any, changed = true) => ({
  requestId: message.requestId,
  targetId: noteTargets[0].targetId,
  url: "https://doca.test/#/r/" + noteTargets[0].targetId,
  seq: 7,
  epochId: "55555555-5555-4555-8555-555555555555",
  changed,
});

async function fixture(
  hash = "",
  options: {
    pendingReference?: any;
    moduleReady?: Promise<void>;
    configuredState?: any;
  } = {},
) {
  const dom = new JSDOM(await read("ui.html"), {
    url: "https://extension.test/ui.html" + hash,
    runScripts: "outside-only",
  });
  const dispose = dom.window.close.bind(dom.window);
  const mounts: any[] = [],
    calls: any[] = [],
    panelCalls: any[] = [],
    closes: boolean[] = [],
    storageListeners: ((changes: any, area: string) => void)[] = [],
    stateReplies: (() => Promise<any>)[] = [],
    operationReplies: (() => Promise<any>)[] = [],
    unmounts: any[] = [],
    quickNoteReplies: {
      quickNoteTargets: QuickNoteReply[];
      quickNotePrepare: QuickNoteReply[];
      quickNoteCommit: QuickNoteReply[];
    } = {
      quickNoteTargets: [],
      quickNotePrepare: [],
      quickNoteCommit: [],
    },
    storageWrites: any[] = [];
  const notePrepared = new Map<string, any>();
  const state = {
    locale: "zh",
    connected: true,
    assistantEnabled: true,
    origin: "https://doca.test",
    connectionId: "connection",
    user: { id: "user", name: "User" },
    profiles: [
      { id: "other", name: "Other", revision: 2 },
      { id: "default", name: "Default", isDefault: true, revision: 1 },
    ],
  };
  const noop = { addListener() {} };
  Object.assign(dom.window, {
    TextEncoder,
    setInterval() {},
    assistantFixtureReady: options.moduleReady,
    close: () => closes.push(true),
    chrome: {
      runtime: {
        sendMessage: async (message: any) => {
          calls.push(message);
          const messageType: string = message.type;
          const quickReply =
            messageType === "quickNoteTargets" ||
            messageType === "quickNotePrepare" ||
            messageType === "quickNoteCommit"
              ? quickNoteReplies[messageType].shift()
              : undefined;
          if (quickReply) {
            const result = await quickReply(message);
            if (message.type === "quickNotePrepare" && result.ok)
              notePrepared.set(message.requestId, result.value);
            return result;
          }
          if (message.type === "quickNoteTargets")
            return { ok: true, value: { items: structuredClone(noteTargets) } };
          if (message.type === "quickNotePrepare") {
            const target = noteTargets.find(
              (item) => item.profileId === message.profileId,
            )!;
            const prepared = {
              requestId: message.requestId,
              ticket: "a".repeat(64),
              targetId: target.targetId,
              format: target.format,
              expiresAt: "2099-01-01T00:00:00Z",
            };
            notePrepared.set(message.requestId, prepared);
            return { ok: true, value: prepared };
          }
          if (message.type === "quickNoteCommit") {
            const prepared = notePrepared.get(message.requestId);
            return {
              ok: true,
              value: {
                requestId: message.requestId,
                targetId: prepared.targetId,
                url: "https://doca.test/#/r/" + prepared.targetId,
                seq: 7,
                epochId: "55555555-5555-4555-8555-555555555555",
                changed: true,
              },
            };
          }
          if (message.type === "locale") state.locale = message.locale;
          if (message.type === "configure")
            Object.assign(
              state,
              { origin: JSON.parse(message.config).origin },
              options.configuredState,
            );
          const stateReply = message.type === "state" && stateReplies.shift();
          if (stateReply) return { ok: true, value: await stateReply() };
          const operationReply =
            ["locale", "configure"].includes(message.type) &&
            operationReplies.shift();
          if (operationReply)
            return { ok: true, value: await operationReply() };
          return {
            ok: true,
            value:
              message.type === "state" ||
              message.type === "locale" ||
              message.type === "configure"
                ? structuredClone(state)
                : message.type === "capture"
                  ? { url: "https://doca.test/#/r/saved" }
                  : message.type === "assistantSession"
                    ? { sessionId: null }
                    : { jobs: [], sessionId: null },
          };
        },
      },
      tabs: {
        query: async () => [
          {
            id: 9,
            windowId: 11,
            title: "Current article",
            url: "https://article.test/page",
          },
        ],
        onActivated: noop,
        onUpdated: noop,
      },
      sidePanel: {
        setOptions: async (options: unknown) =>
          panelCalls.push({ type: "setOptions", options }),
        open: async (options: unknown) =>
          panelCalls.push({ type: "open", options }),
      },
      commands: { getAll: async () => [] },
      storage: {
        onChanged: {
          addListener: (listener: (changes: any, area: string) => void) =>
            storageListeners.push(listener),
        },
        session: {
          get: async () => ({ assistantPending: options.pendingReference }),
          set: async (value: any) => {
            storageWrites.push(value);
          },
        },
        local: {
          set: async (value: any) => {
            storageWrites.push(value);
          },
        },
      },
    },
    mountFixture: (_element: unknown, config: any) => {
      mounts.push(config);
      return {
        update: (next: any) => mounts.push(next),
        unmount: () => unmounts.push(config),
        compose() {},
      };
    },
  });
  dom.window.eval(await read("select.js"));
  const messages = (await read("messages.js")).replaceAll("export ", "");
  const ui = (await read("ui.js"))
    .replace('import { translate } from "./messages.js";', "")
    .replace(
      'const loadAssistant = () => import("./generated/assistant.js");',
      "const loadAssistant = async () => { await globalThis.assistantFixtureReady; return { mountBrowserAssistant: globalThis.mountFixture }; };",
    );
  await dom.window.eval("(async () => {" + messages + "\n" + ui + "})()");
  await flush();
  const doc = dom.window.document;
  const element = <T extends HTMLElement>(id: string) =>
    doc.getElementById(id) as T;
  return {
    dom,
    doc,
    element,
    mounts,
    calls,
    panelCalls,
    closes,
    dispose,
    storageListeners,
    serverState: state,
    stateReplies,
    operationReplies,
    unmounts,
    quickNoteReplies,
    storageWrites,
  };
}

async function openQuickNote(
  f: Awaited<ReturnType<typeof fixture>>,
  target: (typeof noteTargets)[number] | null = noteTargets[0],
) {
  f.element<HTMLDetailsElement>("quick-note").open = true;
  f.element("quick-note").dispatchEvent(new f.dom.window.Event("toggle"));
  await flush();
  if (target) {
    f.element<HTMLSelectElement>("quick-note-target").value = target.profileId;
    f.element("quick-note-target").dispatchEvent(
      new f.dom.window.Event("change", { bubbles: true }),
    );
  }
}
function fillQuickNote(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  f.element<HTMLTextAreaElement>("quick-note-text").value = text;
  f.element("quick-note-text").dispatchEvent(
    new f.dom.window.Event("input", { bubbles: true }),
  );
}

it("opens the capture home and saves the page or selection using the chosen rule without mounting AI", async () => {
  const { dom, doc, element, mounts, calls, dispose } = await fixture();
  try {
    expect(element("capture-pane").hidden).toBe(false);
    expect(element("assistant-pane").hidden).toBe(true);
    expect(element("connection-pane").hidden).toBe(true);
    expect(element<HTMLSelectElement>("profile").value).toBe("default");
    expect(mounts).toEqual([]);
    expect(calls.some((message) => message.type.startsWith("assistant"))).toBe(
      false,
    );
    expect(
      doc.querySelector(
        "[data-tab], #quick-actions, #capture-mode, #quick-capture, #quick-organize",
      ),
    ).toBeNull();
    expect(doc.querySelector("#attach-page")).toBeNull();
    expect(
      [...doc.querySelectorAll("select")].every((select) => select.hidden),
    ).toBe(true);
    element("capture-page").click();
    await flush();
    expect(calls.find((message) => message.type === "capture")).toMatchObject({
      mode: "page",
      profileId: "default",
      profileRevision: 1,
      tabId: 9,
    });
    const profile = element<HTMLSelectElement>("profile");
    profile.value = "other";
    profile.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    element("capture-selection").click();
    await flush();
    expect(
      calls.filter((message) => message.type === "capture").at(-1),
    ).toMatchObject({
      mode: "selection",
      profileId: "other",
      profileRevision: 2,
      tabId: 9,
    });
    expect(mounts).toEqual([]);
  } finally {
    dispose();
  }
});

it("opens settings from the top-right action and returns to the capture home with its chosen rule", async () => {
  const { dom, element, mounts, dispose } = await fixture();
  try {
    element<HTMLSelectElement>("profile").value = "other";
    element("settings").click();
    expect(element("connection-pane").hidden).toBe(false);
    expect(element("capture-pane").hidden).toBe(true);
    expect(element("assistant-pane").hidden).toBe(true);
    expect(element<HTMLAnchorElement>("settings-link").href).toBe(
      "https://doca.test/#/browser-assistant",
    );
    expect(element("connection-pane").contains(element("settings-link"))).toBe(
      true,
    );
    expect(element("connection-pane").contains(element("endpoint"))).toBe(true);
    expect(element("connection-pane").contains(element("config"))).toBe(true);
    expect(element("connection-pane").contains(element("locale"))).toBe(true);
    element("back").click();
    expect(element("capture-pane").hidden).toBe(false);
    expect(element("connection-pane").hidden).toBe(true);
    expect(element<HTMLSelectElement>("profile").value).toBe("other");
    expect(mounts).toEqual([]);
  } finally {
    dispose();
  }
});

it("opens the native AI side panel for the source tab and passes the selected rule without sending a model request", async () => {
  const { dom, element, panelCalls, closes, calls, mounts, dispose } =
    await fixture();
  try {
    const profile = element<HTMLSelectElement>("profile");
    profile.value = "other";
    profile.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    element("open-assistant").click();
    await flush();
    const configured = panelCalls.find((call) => call.type === "setOptions");
    expect(configured.options).toMatchObject({ tabId: 9 });
    const panelUrl = new URL(
      configured.options.path,
      "https://extension.test/",
    );
    expect(panelUrl.pathname).toBe("/ui.html");
    expect(panelUrl.hash.startsWith("#assistant?")).toBe(true);
    const parameters = new URLSearchParams(
      panelUrl.hash.slice("#assistant?".length),
    );
    expect(parameters.get("profileId")).toBe("other");
    expect(parameters.get("profileRevision")).toBe("2");
    expect(panelCalls.find((call) => call.type === "open")).toMatchObject({
      options: { tabId: 9 },
    });
    expect(panelCalls.map((call) => call.type)).toEqual(["setOptions", "open"]);
    expect(closes).toEqual([true]);
    expect(mounts).toEqual([]);
    expect(calls.some((message) => message.type.startsWith("assistant"))).toBe(
      false,
    );
  } finally {
    dispose();
  }
});

it("mounts the shared AI UI only in the sidebar, adopts the chosen rule and returns from settings to AI", async () => {
  const { dom, doc, element, mounts, calls, dispose } = await fixture(
    "#assistant?profileId=other&profileRevision=2",
  );
  try {
    expect(doc.body.classList.contains("sidebar")).toBe(true);
    expect(element("assistant-pane").hidden).toBe(false);
    expect(element("capture-pane").hidden).toBe(true);
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("other");
    expect(mounts.at(-1).profile).toEqual({
      id: "other",
      revision: 2,
      name: "Other",
    });
    expect(mounts.at(-1).page).toEqual({
      title: "Current article",
      url: "https://article.test/page",
    });
    expect(
      calls.find((message) => message.type === "assistantSession"),
    ).toMatchObject({ profileId: "other", operation: "get" });
    expect(doc.querySelector("#attach-page")).toBeNull();
    expect(
      calls.some((message) => message.type === "assistantPreparePage"),
    ).toBe(false);
    element("settings").click();
    expect(element("connection-pane").hidden).toBe(false);
    element("back").click();
    await flush();
    expect(element("assistant-pane").hidden).toBe(false);
    expect(element("capture-pane").hidden).toBe(true);
    element<HTMLSelectElement>("locale").value = "en";
    element("locale").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    expect(mounts.at(-1).locale).toBe("en");
    expect(mounts.at(-1).profile.id).toBe("other");
  } finally {
    dispose();
  }
});

it("requires an explicit rule selection when the rule passed to the sidebar has changed", async () => {
  const { dom, element, mounts, calls, dispose } = await fixture(
    "#assistant?profileId=other&profileRevision=999",
  );
  try {
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("");
    expect(element("notice").textContent).toContain("收录方案已修改");
    expect(mounts).toEqual([]);
    expect(calls.some((message) => message.type.startsWith("assistant"))).toBe(
      false,
    );
    element("settings").click();
    element<HTMLSelectElement>("locale").value = "en";
    element("locale").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    element("back").click();
    await flush();
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("");
    expect(mounts).toEqual([]);

    element<HTMLSelectElement>("ai-profile").value = "default";
    element("ai-profile").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    expect(mounts.at(-1).profile.id).toBe("default");
  } finally {
    dispose();
  }
});

it("keeps the explicit launch rule when another rule has retained unsent page material", async () => {
  const { element, mounts, dispose } = await fixture(
    "#assistant?profileId=default&profileRevision=1",
    {
      pendingReference: {
        origin: "https://doca.test",
        connectionId: "connection",
        profileId: "other",
        capture: {
          mode: "selection",
          title: "Earlier article",
          url: "https://earlier.test/page",
        },
      },
    },
  );
  try {
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("default");
    expect(mounts.at(-1).profile.id).toBe("default");
    expect(mounts.at(-1).page.url).toBe("https://article.test/page");
  } finally {
    dispose();
  }
});

it("does not replace the user's chosen rule when retained material changes in another panel", async () => {
  const { dom, element, mounts, dispose, storageListeners } =
    await fixture("#assistant");
  try {
    element<HTMLSelectElement>("ai-profile").value = "other";
    element("ai-profile").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    for (const listener of storageListeners)
      listener(
        {
          assistantPending: {
            newValue: {
              origin: "https://doca.test",
              connectionId: "connection",
              profileId: "default",
              capture: {
                mode: "selection",
                title: "Other panel's article",
                url: "https://other-panel.test/page",
              },
            },
          },
        },
        "session",
      );
    await flush();
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("other");
    expect(element<HTMLSelectElement>("profile").value).toBe("other");
    expect(mounts.at(-1).profile.id).toBe("other");
    expect(mounts.at(-1).page.url).toBe("https://article.test/page");
  } finally {
    dispose();
  }
});

it("mounts with the latest page reference and locale when the local AI module finishes loading", async () => {
  let finishModule!: () => void;
  const moduleReady = new Promise<void>((resolve) => {
    finishModule = resolve;
  });
  const { dom, element, mounts, dispose, storageListeners } = await fixture(
    "#assistant",
    { moduleReady },
  );
  try {
    expect(mounts).toEqual([]);
    for (const listener of storageListeners)
      listener(
        {
          assistantPending: {
            newValue: {
              origin: "https://doca.test",
              connectionId: "connection",
              profileId: "default",
              capture: {
                mode: "selection",
                title: "Latest article",
                url: "https://latest.test/page",
              },
            },
          },
        },
        "session",
      );
    element<HTMLSelectElement>("locale").value = "en";
    element("locale").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    finishModule();
    await flush();
    expect(mounts.at(-1).locale).toBe("en");
    expect(mounts.at(-1).page.url).toBe("https://latest.test/page");
    expect(mounts.at(-1).page.title).toContain("Latest article");
  } finally {
    finishModule();
    dispose();
  }
});

it("refreshes sign-in on focus and visibility without prompting, then restores the chosen rule and locale", async () => {
  const { dom, doc, element, mounts, calls, dispose, serverState, unmounts } =
    await fixture("#assistant?profileId=other&profileRevision=2");
  try {
    const profiles = serverState.profiles;
    Object.assign(serverState, {
      connected: false,
      profiles: [],
      error: "clipper_connection_revoked",
    });
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await flush();
    expect(element("connection-pane").hidden).toBe(false);
    expect(element("assistant-pane").hidden).toBe(true);
    expect(unmounts).toHaveLength(1);
    expect(element("assistant-root").textContent).toBe("");
    expect(element("notice").textContent).toContain("连接已撤销");

    Object.assign(serverState, {
      connected: true,
      profiles,
      error: "",
      locale: "en",
    });
    Object.defineProperty(doc, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    doc.dispatchEvent(new dom.window.Event("visibilitychange"));
    await flush();
    expect(element("assistant-pane").hidden).toBe(false);
    expect(element("connection-pane").hidden).toBe(true);
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("other");
    expect(mounts.at(-1).profile.id).toBe("other");
    expect(mounts.at(-1).locale).toBe("en");
    expect(element("notice").hidden).toBe(true);
    const probes = calls.filter((message) => message.type === "state");
    expect(probes[0].interactive).toBe(true);
    expect(
      probes.slice(1).every((message) => message.interactive === false),
    ).toBe(true);
  } finally {
    dispose();
  }
});

it("observes authorization, site, error and locale storage changes without changing the selected rule", async () => {
  const {
    element,
    mounts,
    calls,
    dispose,
    serverState,
    storageListeners,
    unmounts,
  } = await fixture("#assistant?profileId=other&profileRevision=2");
  const notify = (changes: any, area: string) => {
    for (const listener of storageListeners) listener(changes, area);
  };
  try {
    const profiles = serverState.profiles;
    Object.assign(serverState, {
      connected: false,
      profiles: [],
      error: "clipper_login_required",
    });
    notify(
      {
        authorization: {
          oldValue: { token: "synthetic" },
          newValue: undefined,
        },
      },
      "session",
    );
    await flush();
    expect(element("connection-pane").hidden).toBe(false);
    expect(unmounts).toHaveLength(1);

    Object.assign(serverState, {
      connected: true,
      profiles,
      error: "",
      locale: "en",
    });
    notify(
      {
        site: { oldValue: undefined, newValue: { origin: serverState.origin } },
      },
      "local",
    );
    await flush();
    expect(element("assistant-pane").hidden).toBe(false);
    expect(mounts.at(-1).locale).toBe("en");
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("other");

    Object.assign(serverState, { locale: "zh" });
    notify({ locale: { oldValue: "en", newValue: "zh" } }, "local");
    await flush();
    expect(mounts.at(-1).locale).toBe("zh");
    const beforeError = calls.filter(
      (message) => message.type === "state",
    ).length;
    notify(
      {
        lastError: { oldValue: "clipper_login_required", newValue: undefined },
      },
      "session",
    );
    await flush();
    expect(calls.filter((message) => message.type === "state")).toHaveLength(
      beforeError + 1,
    );
    expect(element<HTMLSelectElement>("ai-profile").value).toBe("other");
    notify({ locale: { oldValue: "zh", newValue: "zh" } }, "local");
    await flush();
    expect(calls.filter((message) => message.type === "state")).toHaveLength(
      beforeError + 1,
    );
    expect(
      calls
        .filter((message) => message.type === "state")
        .slice(1)
        .every((message) => !message.interactive),
    ).toBe(true);
  } finally {
    dispose();
  }
});

it("coalesces overlapping refresh events and applies a fresh result after an in-flight probe", async () => {
  const {
    dom,
    element,
    calls,
    dispose,
    serverState,
    stateReplies,
    storageListeners,
  } = await fixture("#assistant");
  let finishProbe!: (state: unknown) => void;
  stateReplies.push(
    () =>
      new Promise((resolve) => {
        finishProbe = resolve;
      }),
  );
  try {
    const before = calls.filter((message) => message.type === "state").length;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await flush();
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    for (const listener of storageListeners)
      listener(
        {
          lastError: {
            oldValue: undefined,
            newValue: "clipper_login_required",
          },
        },
        "session",
      );
    await flush();
    expect(calls.filter((message) => message.type === "state")).toHaveLength(
      before + 1,
    );
    const earlier = structuredClone(serverState);
    Object.assign(serverState, {
      connected: false,
      profiles: [],
      error: "clipper_login_required",
    });
    finishProbe(earlier);
    await flush();
    expect(calls.filter((message) => message.type === "state")).toHaveLength(
      before + 2,
    );
    expect(element("connection-pane").hidden).toBe(false);
    expect(element("assistant-pane").hidden).toBe(true);
  } finally {
    dispose();
  }
});

it("discards a pre-action state reply that arrives after a successful locale change", async () => {
  const { dom, doc, element, calls, dispose, serverState, stateReplies } =
    await fixture("#assistant");
  let finishOld!: (state: unknown) => void;
  let finishFresh!: (state: unknown) => void;
  const previous = {
    ...structuredClone(serverState),
    error: "clipper_login_required",
  };
  stateReplies.push(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  stateReplies.push(
    () =>
      new Promise((resolve) => {
        finishFresh = resolve;
      }),
  );
  try {
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await flush();
    element("settings").click();
    element<HTMLSelectElement>("locale").value = "en";
    element("locale").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    expect(doc.documentElement.lang).toBe("en");
    finishOld(previous);
    await flush();
    expect(doc.documentElement.lang).toBe("en");
    expect(element<HTMLSelectElement>("locale").value).toBe("en");
    expect(element("notice").hidden).toBe(true);
    expect(calls.filter((message) => message.type === "state")).toHaveLength(3);
    finishFresh(structuredClone(serverState));
    await flush();
    expect(doc.documentElement.lang).toBe("en");
  } finally {
    dispose();
  }
});

it("keeps a successful new connection and its notice when an earlier connection probe finishes late", async () => {
  const { dom, element, mounts, dispose, serverState, stateReplies } =
    await fixture("#assistant", {
      configuredState: {
        connectionId: "new-connection",
        user: { id: "new-user", name: "New account" },
        locale: "en",
      },
    });
  let finishOld!: (state: unknown) => void;
  let finishFresh!: (state: unknown) => void;
  const previous = {
    ...structuredClone(serverState),
    error: "clipper_login_required",
  };
  stateReplies.push(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  stateReplies.push(
    () =>
      new Promise((resolve) => {
        finishFresh = resolve;
      }),
  );
  try {
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await flush();
    element("settings").click();
    element<HTMLInputElement>("endpoint").value = "https://next-doca.test";
    element("endpoint-form").dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await flush();
    expect(element("identity").textContent).toBe("New account");
    const success = element("notice").textContent;
    expect(element("notice").classList.contains("success")).toBe(true);
    finishOld(previous);
    await flush();
    expect(element("identity").textContent).toBe("New account");
    expect(element<HTMLInputElement>("endpoint").value).toBe(
      "https://next-doca.test",
    );
    expect(element("notice").textContent).toBe(success);
    expect(element("notice").classList.contains("success")).toBe(true);
    finishFresh(structuredClone(serverState));
    await flush();
    element("back").click();
    await flush();
    expect(mounts.at(-1).connectionId).toBe("new-connection");
    expect(mounts.at(-1).locale).toBe("en");
  } finally {
    dispose();
  }
});

it("defers refresh work while an action is busy and drains its queued probe after completion", async () => {
  const {
    dom,
    doc,
    element,
    calls,
    dispose,
    serverState,
    stateReplies,
    operationReplies,
  } = await fixture("#assistant");
  let finishOld!: (state: unknown) => void;
  let finishLocale!: (state: unknown) => void;
  const previous = structuredClone(serverState);
  stateReplies.push(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  operationReplies.push(
    () =>
      new Promise((resolve) => {
        finishLocale = resolve;
      }),
  );
  try {
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await flush();
    element<HTMLSelectElement>("locale").value = "en";
    element("locale").dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    await flush();
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    finishOld(previous);
    await flush();
    expect(calls.filter((message) => message.type === "state")).toHaveLength(2);
    finishLocale(structuredClone(serverState));
    await flush();
    expect(calls.filter((message) => message.type === "state")).toHaveLength(3);
    expect(doc.documentElement.lang).toBe("en");
    expect(element<HTMLSelectElement>("locale").value).toBe("en");
  } finally {
    dispose();
  }
});

it("keeps quick notes collapsed and explicitly selects an append target without AI or capture profiles", async () => {
  const f = await fixture();
  try {
    expect(f.element<HTMLDetailsElement>("quick-note").open).toBe(false);
    expect(
      f.calls.some((message) => message.type.startsWith("quickNote")),
    ).toBe(false);
    f.serverState.assistantEnabled = false;
    f.serverState.profiles = [];
    f.dom.window.dispatchEvent(new f.dom.window.Event("focus"));
    await flush();
    f.element<HTMLDetailsElement>("quick-note").open = true;
    f.element("quick-note").dispatchEvent(new f.dom.window.Event("toggle"));
    await flush();
    expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
    const text = "  Plain <b>text</b> & [link]\nsecond line  ";
    fillQuickNote(f, text);
    expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(true);
    f.element<HTMLSelectElement>("quick-note-target").value =
      noteTargets[1].profileId;
    f.element("quick-note-target").dispatchEvent(
      new f.dom.window.Event("change"),
    );
    f.element("quick-note-save").click();
    await flush();
    const prepared = f.calls.find(
      (message) => message.type === "quickNotePrepare",
    );
    expect(prepared).toEqual({
      type: "quickNotePrepare",
      origin: "https://doca.test",
      connectionId: "connection",
      requestId: expect.any(String),
      profileId: noteTargets[1].profileId,
      profileRevision: 2,
      text,
    });
    expect(prepared.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      f.calls.filter((message) => message.type === "quickNoteCommit"),
    ).toEqual([
      {
        type: "quickNoteCommit",
        origin: "https://doca.test",
        connectionId: "connection",
        requestId: prepared.requestId,
        ticket: "a".repeat(64),
      },
    ]);
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe("");
    expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe(
      noteTargets[1].profileId,
    );
    expect(f.element<HTMLAnchorElement>("quick-note-target-link").href).toBe(
      "https://doca.test/#/r/" + noteTargets[1].targetId,
    );
    expect(f.element("quick-note-status").textContent).toContain("记录已追加");
    expect(
      f.calls.some(
        (message) =>
          message.type === "capture" || message.type.startsWith("assistant"),
      ),
    ).toBe(false);
    expect(f.mounts).toEqual([]);
    expect(f.storageWrites).toEqual([]);
    expect(f.dom.window.localStorage.length).toBe(0);
  } finally {
    f.dispose();
  }
});

it("shows no-target guidance and does not mount quick notes in the AI sidebar", async () => {
  const f = await fixture();
  try {
    f.quickNoteReplies.quickNoteTargets.push(async () => ({
      ok: true,
      value: { items: [] },
    }));
    await openQuickNote(f);
    expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
    expect(f.element("quick-note-empty").hidden).toBe(false);
    fillQuickNote(f, "retained draft");
    f.element("quick-note-save").click();
    await flush();
    expect(f.calls.some((message) => message.type === "quickNotePrepare")).toBe(
      false,
    );
  } finally {
    f.dispose();
  }
  const sidebar = await fixture("#assistant");
  try {
    expect(sidebar.element("quick-note").hidden).toBe(true);
    await openQuickNote(sidebar);
    expect(
      sidebar.calls.some((message) => message.type.startsWith("quickNote")),
    ).toBe(false);
  } finally {
    sidebar.dispose();
  }
});

it("keeps the same target and draft through passive refresh and locale changes", async () => {
  const f = await fixture();
  try {
    await openQuickNote(f);
    fillQuickNote(f, "未发送的文字\nsecond line");
    f.dom.window.dispatchEvent(new f.dom.window.Event("focus"));
    await flush();
    f.element<HTMLSelectElement>("locale").value = "en";
    f.element("locale").dispatchEvent(new f.dom.window.Event("change"));
    await flush();
    expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe(
      noteTargets[0].profileId,
    );
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "未发送的文字\nsecond line",
    );
    expect(f.element("quick-note-save").textContent).toBe("Append note");
    expect(
      f.calls.filter((message) => message.type === "quickNoteTargets"),
    ).toHaveLength(1);
    expect(f.calls.some((message) => message.type === "quickNotePrepare")).toBe(
      false,
    );
  } finally {
    f.dispose();
  }
});

it("rejects whitespace and UTF-8 text over 64 KiB without preparing or changing the draft", async () => {
  const f = await fixture();
  try {
    await openQuickNote(f);
    fillQuickNote(f, " \n\t ");
    expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(true);
    const text = "汉".repeat(22000);
    fillQuickNote(f, text);
    f.element("quick-note-save").click();
    await flush();
    expect(f.calls.some((message) => message.type === "quickNotePrepare")).toBe(
      false,
    );
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(text);
    expect(f.element("quick-note-status").textContent).toContain(
      "分成较短的记录",
    );
  } finally {
    f.dispose();
  }
});

it("keeps input until commit acknowledgement and freezes the original snapshot while later text is typed", async () => {
  const f = await fixture();
  let finishPrepare!: (value: any) => void;
  let finishCommit!: (value: any) => void;
  f.quickNoteReplies.quickNotePrepare.push(
    () =>
      new Promise((resolve) => {
        finishPrepare = resolve;
      }),
  );
  f.quickNoteReplies.quickNoteCommit.push(
    () =>
      new Promise((resolve) => {
        finishCommit = resolve;
      }),
  );
  try {
    await openQuickNote(f);
    fillQuickNote(f, "original immutable text");
    f.element("quick-note-save").click();
    f.element("quick-note-save").click();
    await flush();
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "original immutable text",
    );
    expect(
      f.calls.filter((message) => message.type === "quickNotePrepare"),
    ).toHaveLength(1);
    const request = f.calls.find(
      (message) => message.type === "quickNotePrepare",
    );
    fillQuickNote(f, "later independent draft");
    finishPrepare({
      ok: true,
      value: {
        requestId: request.requestId,
        ticket: "b".repeat(64),
        targetId: noteTargets[0].targetId,
        format: "rich_text",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    await flush();
    expect(
      f.calls.filter((message) => message.type === "quickNoteCommit"),
    ).toHaveLength(1);
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "later independent draft",
    );
    finishCommit({
      ok: true,
      value: noteAck(request),
    });
    await flush();
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "later independent draft",
    );
    expect(request.text).toBe("original immutable text");
    expect(f.element("quick-note-clear").hidden).toBe(true);
  } finally {
    f.dispose();
  }
});

it("retries a lost commit acknowledgement only with its original ticket and keeps a later draft", async () => {
  const f = await fixture();
  f.quickNoteReplies.quickNoteCommit.push(async () => ({
    ok: false,
    error: "clipper_connection_failed",
  }));
  try {
    await openQuickNote(f);
    fillQuickNote(f, "original note");
    f.element("quick-note-save").click();
    await flush();
    const first = f.calls.find((message) => message.type === "quickNoteCommit");
    expect(f.element("quick-note-retry").hidden).toBe(false);
    expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(true);
    expect(f.element<HTMLSelectElement>("quick-note-target").disabled).toBe(
      true,
    );
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "original note",
    );
    expect(f.element("quick-note-status").textContent).toContain("无法确认");
    expect(f.element("quick-note-target-link").hidden).toBe(false);
    f.dom.window.dispatchEvent(new f.dom.window.Event("focus"));
    await flush();
    expect(
      f.calls.filter((message) => message.type === "quickNotePrepare"),
    ).toHaveLength(1);
    expect(
      f.calls.filter((message) => message.type === "quickNoteCommit"),
    ).toHaveLength(1);
    fillQuickNote(f, "new draft after uncertain send");
    f.quickNoteReplies.quickNoteCommit.push(async (message) => ({
      ok: true,
      value: noteAck(message, false),
    }));
    f.element("quick-note-retry").click();
    await flush();
    expect(
      f.calls.filter((message) => message.type === "quickNoteCommit"),
    ).toEqual([first, first]);
    expect(
      f.calls.filter((message) => message.type === "quickNotePrepare"),
    ).toHaveLength(1);
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "new draft after uncertain send",
    );
    expect(f.storageWrites).toEqual([]);
  } finally {
    f.dispose();
  }
});

it("retries uncertain preparation using the exact original ID, profile and text before committing", async () => {
  const f = await fixture();
  f.quickNoteReplies.quickNotePrepare.push(async () => ({
    ok: false,
    error: "clipper_connection_failed",
  }));
  try {
    await openQuickNote(f);
    fillQuickNote(f, "original preparation");
    f.element("quick-note-save").click();
    await flush();
    const original = f.calls.find(
      (message) => message.type === "quickNotePrepare",
    );
    expect(f.calls.some((message) => message.type === "quickNoteCommit")).toBe(
      false,
    );
    fillQuickNote(f, "later text");
    f.element("quick-note-retry").click();
    await flush();
    expect(
      f.calls.filter((message) => message.type === "quickNotePrepare"),
    ).toEqual([original, original]);
    expect(
      f.calls.filter((message) => message.type === "quickNoteCommit"),
    ).toHaveLength(1);
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "later text",
    );
  } finally {
    f.dispose();
  }
});

for (const code of [
  "quick_note_ticket_missing",
  "quick_note_signin_changed",
  "clipper_profile_changed",
])
  it(`stops ${code} without a new request ID and requires deliberate reset before another attempt`, async () => {
    const f = await fixture();
    f.quickNoteReplies.quickNoteCommit.push(async () => ({
      ok: false,
      error: code,
      status: 409,
    }));
    try {
      await openQuickNote(f);
      fillQuickNote(f, "preserve this uncertain note");
      f.element("quick-note-save").click();
      await flush();
      const original = f.calls.find(
        (message) => message.type === "quickNotePrepare",
      );
      expect(f.element("quick-note-retry").hidden).toBe(true);
      expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(
        true,
      );
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "preserve this uncertain note",
      );
      expect(f.element("quick-note-status").textContent).toContain("已停止");
      expect(
        f.element<HTMLAnchorElement>("quick-note-target-link").href,
      ).toContain(noteTargets[0].targetId);
      f.dom.window.dispatchEvent(new f.dom.window.Event("focus"));
      await flush();
      expect(
        f.calls.filter((message) => message.type === "quickNotePrepare"),
      ).toHaveLength(1);
      expect(
        f.calls.filter((message) => message.type === "quickNoteCommit"),
      ).toHaveLength(1);
      f.element("quick-note-clear").click();
      expect(f.element("quick-note-reset-confirmation").hidden).toBe(false);
      f.element("quick-note-confirm-reset").click();
      await flush();
      expect(
        f.calls.filter((message) => message.type === "quickNotePrepare"),
      ).toHaveLength(1);
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "preserve this uncertain note",
      );
      expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(
        code === "clipper_profile_changed",
      );
      if (code === "clipper_profile_changed") {
        expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe(
          "",
        );
        f.element<HTMLSelectElement>("quick-note-target").value =
          noteTargets[0].profileId;
        f.element("quick-note-target").dispatchEvent(
          new f.dom.window.Event("change"),
        );
      }
      f.element("quick-note-save").click();
      await flush();
      expect(
        f.calls.filter((message) => message.type === "quickNotePrepare"),
      ).toHaveLength(2);
      expect(
        f.calls.filter((message) => message.type === "quickNotePrepare")[1]
          .requestId,
      ).not.toBe(original.requestId);
    } finally {
      f.dispose();
    }
  });

for (const changed of [
  "requestId",
  "targetId",
  "ticket",
  "expiresAt",
  "format",
])
  it(`refuses preparation with mismatched ${changed} before any commit`, async () => {
    const f = await fixture();
    f.quickNoteReplies.quickNotePrepare.push(async (message) => ({
      ok: true,
      value: {
        requestId: message.requestId,
        targetId: noteTargets[0].targetId,
        format: "rich_text",
        ticket: "a".repeat(64),
        expiresAt: "2099-01-01T00:00:00Z",
        [changed]: (
          {
            requestId: "foreign",
            targetId: noteTargets[1].targetId,
            ticket: "A".repeat(64),
            expiresAt: "2000-01-01T00:00:00Z",
            format: "markdown",
          } as any
        )[changed],
      },
    }));
    try {
      await openQuickNote(f);
      fillQuickNote(f, "must stay intact");
      f.element("quick-note-save").click();
      await flush();
      expect(
        f.calls.some((message) => message.type === "quickNoteCommit"),
      ).toBe(false);
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "must stay intact",
      );
      expect(f.element("quick-note-retry").hidden).toBe(true);
      expect(f.element("quick-note-status").className).toBe("error");
    } finally {
      f.dispose();
    }
  });

it("rejects an array preparation ticket without committing or clearing the draft", async () => {
  const f = await fixture();
  f.quickNoteReplies.quickNotePrepare.push(async (message) => ({
    ok: true,
    value: {
      requestId: message.requestId,
      targetId: noteTargets[0].targetId,
      format: "rich_text",
      ticket: ["a".repeat(64)],
      expiresAt: "2099-01-01T00:00:00Z",
    },
  }));
  try {
    await openQuickNote(f);
    fillQuickNote(f, "retain text for malformed preparation");
    f.element("quick-note-save").click();
    await flush();
    expect(f.calls.some((message) => message.type === "quickNoteCommit")).toBe(
      false,
    );
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "retain text for malformed preparation",
    );
    expect(f.element("quick-note-retry").hidden).toBe(true);
    expect(f.element("quick-note-status").textContent).toContain("返回结果");
  } finally {
    f.dispose();
  }
});

it("keeps the original ticket retryable for a mismatched commit acknowledgement", async () => {
  const f = await fixture();
  f.quickNoteReplies.quickNoteCommit.push(async (message) => ({
    ok: true,
    value: { requestId: message.requestId, targetId: noteTargets[1].targetId },
  }));
  try {
    await openQuickNote(f);
    fillQuickNote(f, "not acknowledged");
    f.element("quick-note-save").click();
    await flush();
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "not acknowledged",
    );
    expect(f.element("quick-note-retry").hidden).toBe(false);
    expect(f.element("quick-note-status").textContent).toContain("返回结果");
    f.element("quick-note-retry").click();
    await flush();
    expect(
      f.calls.filter((message) => message.type === "quickNotePrepare"),
    ).toHaveLength(1);
    const commits = f.calls.filter(
      (message) => message.type === "quickNoteCommit",
    );
    expect(commits).toEqual([commits[0], commits[0]]);
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe("");
  } finally {
    f.dispose();
  }
});

for (const [name, change] of [
  ["missing request ID", { requestId: undefined }],
  ["missing URL", { url: undefined }],
  [
    "foreign origin",
    { url: "https://other.test/#/r/" + noteTargets[0].targetId },
  ],
  [
    "another resource",
    { url: "https://doca.test/#/r/" + noteTargets[1].targetId },
  ],
  ["unsafe protocol", { url: "javascript:alert(1)" }],
  ["array URL", { url: ["https://doca.test/#/r/" + noteTargets[0].targetId] }],
  ["negative sequence", { seq: -1 }],
  ["fractional sequence", { seq: 0.5 }],
  ["missing epoch", { epochId: undefined }],
  ["array epoch", { epochId: ["55555555-5555-4555-8555-555555555555"] }],
  ["nonboolean changed", { changed: "false" }],
] as const)
  it(`preserves the draft and exact commit for an acknowledgement with ${name}`, async () => {
    const f = await fixture();
    f.quickNoteReplies.quickNoteCommit.push(async (message) => ({
      ok: true,
      value: { ...noteAck(message), ...change },
    }));
    try {
      await openQuickNote(f);
      fillQuickNote(f, "must retain until a complete acknowledgement");
      f.element("quick-note-save").click();
      await flush();
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "must retain until a complete acknowledgement",
      );
      expect(f.element("quick-note-retry").hidden).toBe(false);
      expect(f.element("quick-note-target-link").hidden).toBe(false);
      f.element("quick-note-retry").click();
      await flush();
      const commits = f.calls.filter(
        (message) => message.type === "quickNoteCommit",
      );
      expect(commits).toEqual([commits[0], commits[0]]);
      expect(
        f.calls.filter((message) => message.type === "quickNotePrepare"),
      ).toHaveLength(1);
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe("");
    } finally {
      f.dispose();
    }
  });

for (const status of [403, 404])
  it(`requires target reselection after an ordinary ${status} without exposing internal error codes`, async () => {
    const f = await fixture();
    f.quickNoteReplies.quickNoteCommit.push(async () => ({
      ok: false,
      error: "internal_document_authorization_failure",
      status,
    }));
    try {
      await openQuickNote(f);
      fillQuickNote(f, "permission failure keeps this note");
      f.element("quick-note-save").click();
      await flush();
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "permission failure keeps this note",
      );
      expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
      expect(f.element("quick-note-retry").hidden).toBe(true);
      expect(f.element("quick-note-status").textContent).toContain(
        "重新选择文档",
      );
      expect(f.element("quick-note-status").textContent).not.toContain(
        "internal_document",
      );
      expect(
        f.element<HTMLAnchorElement>("quick-note-target-link").href,
      ).toContain(noteTargets[0].targetId);
      f.element("quick-note-clear").click();
      f.element("quick-note-confirm-reset").click();
      await flush();
      expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
      expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(
        true,
      );
      expect(
        f.calls.filter((message) => message.type === "quickNotePrepare"),
      ).toHaveLength(1);
      expect(
        f.calls.filter((message) => message.type === "quickNoteCommit"),
      ).toHaveLength(1);
    } finally {
      f.dispose();
    }
  });

for (const field of ["profileId", "targetId"] as const)
  it(`rejects an array target-list ${field} without selecting a target or preparing`, async () => {
    const f = await fixture();
    f.quickNoteReplies.quickNoteTargets.push(async () => ({
      ok: true,
      value: {
        items: [{ ...noteTargets[0], [field]: [noteTargets[0][field]] }],
      },
    }));
    try {
      await openQuickNote(f, null);
      fillQuickNote(f, "retain text when targets are malformed");
      const target = f.element<HTMLSelectElement>("quick-note-target");
      expect(target.options).toHaveLength(1);
      expect(target.value).toBe("");
      expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(
        true,
      );
      f.element("quick-note-save").click();
      await flush();
      expect(
        f.calls.some((message) => message.type === "quickNotePrepare"),
      ).toBe(false);
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "retain text when targets are malformed",
      );
      expect(f.element("quick-note-status").textContent).toContain("返回结果");
    } finally {
      f.dispose();
    }
  });

it("rejects incomplete target entries instead of filling missing current-contract fields", async () => {
  const f = await fixture();
  f.quickNoteReplies.quickNoteTargets.push(async () => ({
    ok: true,
    value: { items: [{ ...noteTargets[0], isDefault: undefined }] },
  }));
  try {
    await openQuickNote(f, null);
    expect(
      f.element<HTMLSelectElement>("quick-note-target").options,
    ).toHaveLength(1);
    expect(f.element<HTMLButtonElement>("quick-note-save").disabled).toBe(true);
    expect(f.element("quick-note-status").textContent).toContain("返回结果");
    expect(f.calls.some((message) => message.type === "quickNotePrepare")).toBe(
      false,
    );
  } finally {
    f.dispose();
  }
});

it("presents unknown network errors generically while preserving same-ticket retry", async () => {
  const f = await fixture();
  f.quickNoteReplies.quickNoteCommit.push(async () => ({
    ok: false,
    error: "socket_diagnostic_internal",
  }));
  try {
    await openQuickNote(f);
    fillQuickNote(f, "network uncertain");
    f.element("quick-note-save").click();
    await flush();
    expect(f.element("quick-note-status").textContent).not.toContain(
      "socket_diagnostic",
    );
    expect(f.element("quick-note-status").textContent).toContain(
      "无法完成此次请求",
    );
    expect(f.element("quick-note-retry").hidden).toBe(false);
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "network uncertain",
    );
  } finally {
    f.dispose();
  }
});

for (const stage of ["prepare", "commit"])
  it(`drops a late ${stage} result after the account scope changes and retains unsent text`, async () => {
    const f = await fixture();
    let finish!: (value: any) => void;
    f.quickNoteReplies[
      stage === "prepare" ? "quickNotePrepare" : "quickNoteCommit"
    ].push(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      await openQuickNote(f);
      fillQuickNote(f, "keep across scope change");
      f.element("quick-note-save").click();
      await flush();
      const original = f.calls.find(
        (message) => message.type === "quickNotePrepare",
      );
      Object.assign(f.serverState, {
        origin: "https://other.test",
        connectionId: "other-connection",
        user: { id: "other-user", name: "Other account" },
      });
      f.dom.window.dispatchEvent(new f.dom.window.Event("focus"));
      await flush();
      expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
      expect(f.element("quick-note-target-link").hidden).toBe(true);
      expect(f.element("quick-note-status").textContent).toContain("已变化");
      finish({
        ok: true,
        value:
          stage === "prepare"
            ? {
                requestId: original.requestId,
                targetId: noteTargets[0].targetId,
                format: "rich_text",
                ticket: "a".repeat(64),
                expiresAt: "2099-01-01T00:00:00Z",
              }
            : {
                requestId: original.requestId,
                targetId: noteTargets[0].targetId,
                changed: true,
              },
      });
      await flush();
      expect(
        f.calls.filter((message) => message.type === "quickNoteCommit"),
      ).toHaveLength(stage === "prepare" ? 0 : 1);
      expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
        "keep across scope change",
      );
      expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
      expect(f.element("quick-note-status").textContent).not.toContain(
        "记录已追加",
      );
      expect(f.element("quick-note-clear").hidden).toBe(true);
    } finally {
      f.dispose();
    }
  });

it("drops old target-list responses on a site change without replacing the new list", async () => {
  const f = await fixture();
  let finishOld!: (value: any) => void;
  f.quickNoteReplies.quickNoteTargets.push(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  f.quickNoteReplies.quickNoteTargets.push(async () => ({
    ok: true,
    value: { items: [{ ...noteTargets[1], title: "New site document" }] },
  }));
  try {
    f.element<HTMLDetailsElement>("quick-note").open = true;
    f.element("quick-note").dispatchEvent(new f.dom.window.Event("toggle"));
    await flush();
    fillQuickNote(f, "unsent draft");
    f.serverState.origin = "https://next.test";
    f.dom.window.dispatchEvent(new f.dom.window.Event("focus"));
    await flush();
    finishOld({ ok: true, value: { items: [noteTargets[0]] } });
    await flush();
    expect(f.element("quick-note-target").textContent).toContain(
      "New site document",
    );
    expect(f.element("quick-note-target").textContent).not.toContain(
      "Existing rich text",
    );
    expect(f.element<HTMLSelectElement>("quick-note-target").value).toBe("");
    expect(f.element<HTMLTextAreaElement>("quick-note-text").value).toBe(
      "unsent draft",
    );
  } finally {
    f.dispose();
  }
});

it("starts a fresh popup without a previous target, draft or uncertain ticket", async () => {
  const first = await fixture();
  try {
    first.quickNoteReplies.quickNoteCommit.push(async () => ({
      ok: false,
      error: "clipper_connection_failed",
    }));
    await openQuickNote(first);
    fillQuickNote(first, "only this open instance");
    first.element("quick-note-save").click();
    await flush();
    expect(first.element("quick-note-retry").hidden).toBe(false);
    expect(first.storageWrites).toEqual([]);
  } finally {
    first.dispose();
  }
  const next = await fixture();
  try {
    next.element<HTMLDetailsElement>("quick-note").open = true;
    next
      .element("quick-note")
      .dispatchEvent(new next.dom.window.Event("toggle"));
    await flush();
    expect(next.element<HTMLSelectElement>("quick-note-target").value).toBe("");
    expect(next.element<HTMLTextAreaElement>("quick-note-text").value).toBe("");
    expect(next.element("quick-note-retry").hidden).toBe(true);
    expect(next.element("quick-note-clear").hidden).toBe(true);
    expect(
      next.calls.some((message) =>
        ["quickNotePrepare", "quickNoteCommit"].includes(message.type),
      ),
    ).toBe(false);
    expect(next.dom.window.localStorage.length).toBe(0);
  } finally {
    next.dispose();
  }
});
