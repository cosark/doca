import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
// @ts-expect-error jsdom is a runtime-only fixture dependency.
import { JSDOM } from "jsdom";

const source = await readFile(
  new URL("../apps/browser-extension/content.js", import.meta.url),
  "utf8",
);
const selectSource = await readFile(
  new URL("../apps/browser-extension/select.js", import.meta.url),
  "utf8",
);
async function fixture(replies: any[]) {
  const dom = new JSDOM("<p id='article'>Selected page material</p>", {
    url: "https://source.test/page",
    runScripts: "outside-only",
  });
  const calls: any[] = [];
  const messageListeners: any[] = [];
  const listeners = new Map<string, (event: any) => void>();
  const original = dom.window.document.addEventListener.bind(
    dom.window.document,
  );
  dom.window.document.addEventListener = (
    type: string,
    listener: any,
    options: any,
  ) => {
    listeners.set(type, listener);
    original(type, listener, options);
  };
  const attach = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function () {
    return attach.call(this, { mode: "open" });
  };
  Object.assign(dom.window, {
    chrome: {
      runtime: {
        id: "fixture",
        onMessage: {
          addListener: (listener: any) => messageListeners.push(listener),
        },
        sendMessage: async (message: any) => {
          calls.push(message);
          const reply = replies.shift();
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  });
  dom.window.eval(selectSource);
  dom.window.eval(source);
  const range = dom.window.document.createRange();
  range.selectNodeContents(dom.window.document.getElementById("article"));
  Object.assign(range, {
    getBoundingClientRect: () => ({ bottom: 30, right: 100 }),
  });
  // The browser normally supplies these trusted events and selection rectangles.
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => "Selected page material",
    getRangeAt: () => range,
  };
  range.cloneRange = () => range;
  dom.window.getSelection = () => selection;
  listeners.get("mouseup")!({
    isTrusted: true,
    composedPath: () => [],
    target: dom.window.document.body,
  });
  const shadow = dom.window.document.querySelector(
    "[data-doca-capture-ui]",
  )!.shadowRoot!;
  const icon = shadow.querySelector(".logo") as any;
  const save = shadow.querySelector(".actions button") as any;
  const open = () => icon.onclick({ isTrusted: true });
  return {
    dom,
    calls,
    messageListeners,
    shadow,
    icon,
    save,
    open,
    close: () => dom.window.close(),
  };
}
const connected = (
  profiles = [{ id: "profile", revision: 1, name: "Capture", isDefault: true }],
) => ({
  ok: true,
  value: {
    locale: "zh",
    connected: true,
    origin: "https://doca.test",
    assistantEnabled: true,
    profiles,
  },
});

it("keeps one capture receiver and toolbar when navigation recovery overlaps declarative injection", async () => {
  const f = await fixture([connected()]);
  try {
    f.dom.window.eval(source);
    expect(f.messageListeners).toHaveLength(1);
    expect(
      f.dom.window.document.querySelectorAll("[data-doca-capture-ui]"),
    ).toHaveLength(1);
    await f.open();
    expect(f.calls).toHaveLength(1);
    const capture = {
      mode: "page",
      url: "https://source.test/next",
      markdown: "Next page",
      images: [],
    };
    (f.dom.window as any).DocaCapture = { capture: () => capture };
    let response: any;
    f.messageListeners[0](
      { type: "snapshot", mode: "page" },
      {},
      (value: any) => {
        response = value;
      },
    );
    expect(response).toEqual({ ok: true, value: capture });
  } finally {
    f.close();
  }
});

it("retries a transient state failure without leaving both toolbar actions disabled", async () => {
  const f = await fixture([Error("Temporary network failure"), connected()]);
  try {
    await f.open();
    expect(f.shadow.querySelector(".status")!.textContent).toContain("重试");
    expect(f.save.disabled).toBe(false);
    expect(f.save.textContent).toBe("重试连接");
    await f.save.onclick({ isTrusted: true });
    expect(f.save.disabled).toBe(false);
    expect(f.save.textContent).toBe("收录到 Doca");
    expect(f.shadow.querySelectorAll("select option")).toHaveLength(1);
    expect(f.shadow.querySelectorAll(".doca-select")).toHaveLength(1);
  } finally {
    f.close();
  }
});

it("distinguishes an updated extension from a signed-out account", async () => {
  const f = await fixture([Error("Extension context invalidated.")]);
  try {
    await f.open();
    expect(f.shadow.querySelector(".status")!.textContent).toContain(
      "插件已更新",
    );
    expect(f.save.textContent).toBe("刷新当前网页");
    expect(f.save.disabled).toBe(false);
  } finally {
    f.close();
  }
});

it("distinguishes missing profiles from missing sign-in and links to profile settings", async () => {
  const f = await fixture([connected([])]);
  try {
    await f.open();
    expect(f.shadow.querySelector(".status")!.textContent).toContain(
      "设置收录规则",
    );
    expect(f.shadow.querySelector(".status a")!.getAttribute("href")).toBe(
      "https://doca.test/#/browser-assistant",
    );
  } finally {
    f.close();
  }
});

it("rechecks the connection on reopening the toolbar and replaces the old profile list", async () => {
  const f = await fixture([
    connected(),
    connected([
      { id: "new", revision: 2, name: "New account", isDefault: true },
    ]),
  ]);
  try {
    await f.open();
    await f.open();
    await f.open();
    expect(f.calls).toHaveLength(2);
    expect(f.shadow.querySelectorAll("select option")).toHaveLength(1);
    expect(f.shadow.querySelector("select option")!.textContent).toContain(
      "New account",
    );
    expect(
      f.shadow.querySelector(".doca-select-trigger")!.textContent,
    ).toContain("New account");
  } finally {
    f.close();
  }
});

it("refreshes the original toolbar after successful interactive sign-in", async () => {
  const f = await fixture([
    {
      ok: true,
      value: {
        locale: "zh",
        connected: false,
        profiles: [],
        error: "clipper_login_required",
      },
    },
    connected(),
    connected(),
  ]);
  try {
    await f.open();
    expect(f.save.textContent).toBe("登录 Doca");
    await f.save.onclick({ isTrusted: true });
    expect(f.calls.map((message) => message.type)).toEqual([
      "state",
      "login",
      "state",
    ]);
    expect(f.save.textContent).toBe("收录到 Doca");
    expect(f.save.disabled).toBe(false);
  } finally {
    f.close();
  }
});
