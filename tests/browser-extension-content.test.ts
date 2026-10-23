import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
// @ts-expect-error jsdom is a runtime-only fixture dependency.
import { JSDOM } from "jsdom";
const source = await readFile(
  new URL("../apps/browser-extension/content.js", import.meta.url),
  "utf8",
);
const flush = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const connected = (
  profiles = [
    {
      id: "profile",
      revision: 1,
      name: "Research",
      isDefault: true,
      strategy: "create",
    },
  ],
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
async function fixture(replies: any[] = []) {
  const dom = new JSDOM(
    "<title>Article</title><p id='article'>Selected page material</p>",
    { url: "https://source.test/page", runScripts: "outside-only" },
  );
  const calls: any[] = [],
    messageListeners: any[] = [];
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
          if (message.type === "dockPreferences")
            return { ok: true, value: { position: null, locale: "zh" } };
          const reply = replies.shift();
          if (reply instanceof Error) throw reply;
          return reply ?? { ok: true, value: { opened: true } };
        },
      },
    },
    DocaCapture: {
      capture: (mode: string, range: any) => {
        if (mode === "selection" && !range)
          throw Error("clipper_selection_missing");
        return {
          mode,
          url: "https://source.test/page",
          markdown:
            mode === "selection" ? "Selected page material" : "Entire article",
          images: [],
        };
      },
    },
  });
  dom.window.eval(source);
  await flush();
  const host = dom.window.document.querySelector("[data-doca-capture-ui]")!;
  const shadow = host.shadowRoot!;
  const get = (selector: string) => shadow.querySelector(selector) as any;
  const click = async (action: string) => {
    get('[data-action="' + action + '"]').onclick({ isTrusted: true });
    await flush();
  };
  const range = dom.window.document.createRange();
  range.selectNodeContents(dom.window.document.getElementById("article"));
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: dom.window.document.getElementById("article").firstChild,
    getRangeAt: () => range,
  };
  dom.window.getSelection = () => selection;
  const select = () =>
    dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
  return {
    dom,
    host,
    shadow,
    get,
    calls,
    messageListeners,
    click,
    select,
    range,
    dispose: () => dom.window.close(),
  };
}
it("mounts four permanent actions without a selection popup and registers one receiver", async () => {
  const f = await fixture();
  try {
    expect(f.shadow.querySelectorAll(".tool")).toHaveLength(4);
    expect(f.get(".panel").hidden).toBe(true);
    f.select();
    f.dom.window.document.dispatchEvent(
      new f.dom.window.MouseEvent("mouseup", { bubbles: true }),
    );
    expect(f.get(".panel").hidden).toBe(true);
    expect(
      f.dom.window.document.querySelectorAll("[data-doca-capture-ui]"),
    ).toHaveLength(1);
    f.dom.window.eval(source);
    expect(f.messageListeners).toHaveLength(1);
    expect(f.calls.map((c) => c.type)).toEqual(["dockPreferences"]);
  } finally {
    f.dispose();
  }
});
it("confirms the chosen rule before capturing the page and freezes retry material", async () => {
  const f = await fixture([
    connected(),
    new Error("network failed"),
    { ok: true, value: { url: "https://doca.test/#/r/saved" } },
  ]);
  try {
    await f.click("page");
    expect(f.get(".confirm").textContent).toBe("确认收录");
    expect(f.calls.some((c) => c.type === "capture")).toBe(false);
    await f.get(".confirm").onclick({ isTrusted: true });
    expect(f.get(".status").textContent).toContain("network failed");
    const first = f.calls.find((c) => c.type === "capture");
    await f.get(".confirm").onclick({ isTrusted: true });
    expect(f.calls.filter((c) => c.type === "capture")).toEqual([first, first]);
    expect(first).toMatchObject({
      profileId: "profile",
      profileRevision: 1,
      capture: { mode: "page", markdown: "Entire article" },
    });
    expect(f.get(".status").textContent).toContain("已保存到 Doca");
    expect(f.get(".status a").href).toBe("https://doca.test/#/r/saved");
  } finally {
    f.dispose();
  }
});
it("captures the selected range from the permanent button without showing an automatic selection icon", async () => {
  const f = await fixture([
    connected(),
    { ok: true, value: { url: "https://doca.test/#/r/saved" } },
  ]);
  try {
    f.select();
    await f.click("selection");
    await f.get(".confirm").onclick({ isTrusted: true });
    expect(f.calls.find((c) => c.type === "capture").capture).toMatchObject({
      mode: "selection",
      markdown: "Selected page material",
    });
  } finally {
    f.dispose();
  }
});
it("opens the assistant from the direct click and routes settings through the trusted extension page", async () => {
  const f = await fixture();
  try {
    await f.click("assistant");
    await f.click("settings");
    expect(f.calls.slice(1).map((c) => c.type)).toEqual([
      "openAssistant",
      "openSettings",
    ]);
    expect(
      f.calls.some((c) => c.type === "capture" || c.type === "state"),
    ).toBe(false);
  } finally {
    f.dispose();
  }
});
it("recovers a transient connection failure and rechecks rules on reopening", async () => {
  const f = await fixture([
    new Error("Temporary network failure"),
    connected(),
    connected([
      {
        id: "new",
        revision: 2,
        name: "New account",
        isDefault: true,
        strategy: "create",
      },
    ]),
  ]);
  try {
    await f.click("page");
    expect(f.get(".confirm").textContent).toBe("重试");
    await f.get(".confirm").onclick({ isTrusted: true });
    await flush();
    expect(f.get("select").value).toBe("profile");
    await f.click("page");
    await f.click("page");
    expect(f.get("select").value).toBe("new");
  } finally {
    f.dispose();
  }
});
it("offers settings for missing rules and reconnects before reloading the rule list", async () => {
  const missing = await fixture([connected([])]);
  try {
    await missing.click("page");
    expect(missing.get(".status").textContent).toContain("请先设置收录规则");
    expect(missing.get(".confirm").textContent).toBe("打开设置");
  } finally {
    missing.dispose();
  }
  const f = await fixture([
    {
      ok: true,
      value: {
        connected: false,
        profiles: [],
        locale: "zh",
        error: "clipper_login_required",
      },
    },
    connected(),
    connected(),
  ]);
  try {
    await f.click("page");
    expect(f.get(".confirm").textContent).toBe("登录 Doca");
    await f.get(".confirm").onclick({ isTrusted: true });
    await flush();
    expect(f.calls.map((c) => c.type)).toEqual([
      "dockPreferences",
      "state",
      "login",
      "state",
    ]);
    expect(f.get(".confirm").textContent).toBe("确认收录");
  } finally {
    f.dispose();
  }
});
it("keeps drag adjustments in view and saves their relative position", async () => {
  const f = await fixture();
  try {
    const handle = f.get(".handle");
    handle.onkeydown({ key: "End", preventDefault() {} });
    await flush();
    expect(f.calls.at(-1)).toMatchObject({
      type: "dockPreferences",
      operation: "set",
      position: 1,
    });
    handle.onkeydown({ key: "Home", preventDefault() {} });
    await flush();
    expect(f.calls.at(-1)).toMatchObject({ position: 0 });
    expect(f.host.style.top).toBe("12px");
  } finally {
    f.dispose();
  }
});
