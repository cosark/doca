(() => {
  let range = null,
    host = null,
    snapshot = null;
  const zh = {
    capture: "收录到 Doca",
    ai: "交给 AI",
    close: "关闭",
    busy: "正在保存正文和原图…",
    saved: "已保存，打开文档",
    login: "登录 Doca",
    setup: "请先连接 Doca",
    retry: "重试收录",
    failed: "收录未完成，请在扩展中查看详情",
  };
  const en = {
    capture: "Save to Doca",
    ai: "Ask AI",
    close: "Close",
    busy: "Saving content and original images…",
    saved: "Saved · Open document",
    login: "Sign in to Doca",
    setup: "Connect Doca first",
    retry: "Retry",
    failed: "Capture incomplete. Open the extension for details.",
  };
  let text = zh;
  const send = async (message) => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw Error(result?.error || "clipper_connection_failed");
    return result.value;
  };
  const hide = () => {
    host?.remove();
    host = null;
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hide();
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    async (event) => {
      if (
        !event.isTrusted ||
        host?.contains(event.target) ||
        event.composedPath().includes(host)
      )
        return;
      const active =
        event.target instanceof Element
          ? event.target.closest("input,textarea,[contenteditable='true']")
          : null;
      const selection = window.getSelection();
      if (
        active ||
        !selection?.rangeCount ||
        selection.isCollapsed ||
        !selection.toString().trim()
      ) {
        hide();
        return;
      }
      range = selection.getRangeAt(0).cloneRange();
      snapshot = null;
      const rect = range.getBoundingClientRect();
      hide();
      host = document.createElement("div");
      host.dataset.docaCaptureUi = "true";
      host.style.cssText = `position:fixed;z-index:2147483647;top:${Math.max(8, rect.top - 50)}px;left:${Math.max(8, Math.min(innerWidth - 310, rect.left))}px;`;
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent =
        ":host{all:initial} .bar{font:13px/1.5 system-ui,sans-serif;display:flex;align-items:center;gap:4px;padding:5px;border:1px solid #dbe3ef;border-radius:10px;background:#fff;box-shadow:0 4px 20px #15264822;color:#1f2937;max-width:min(410px,90vw)}button,a{font:inherit;padding:6px 9px;border:0;border-radius:6px;background:transparent;color:inherit;text-decoration:none;cursor:pointer}button:hover{background:#edf3ff}button:first-of-type{color:#2462e9}button:disabled{opacity:.5}select{max-width:130px;border:0;background:#f5f7fa;color:inherit;padding:6px;border-radius:5px} .status{padding:4px 8px;max-width:280px} .status:empty{display:none}";
      const bar = document.createElement("div");
      bar.className = "bar";
      const save = document.createElement("button"),
        ai = document.createElement("button"),
        close = document.createElement("button"),
        profiles = document.createElement("select"),
        status = document.createElement("span");
      status.className = "status";
      status.setAttribute("role", "status");
      save.textContent = text.capture;
      ai.textContent = text.ai;
      close.textContent = "×";
      close.title = text.close;
      bar.addEventListener("mousedown", (event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("select")
        )
          event.preventDefault();
      });
      close.onclick = hide;
      async function run(event, assistant) {
        if (!event.isTrusted) return;
        save.disabled = true;
        ai.disabled = true;
        status.textContent = text.busy;
        try {
          snapshot ||= globalThis.DocaCapture.capture("selection", range);
          if (assistant) {
            await send({
              type: "openAssistant",
              capture: snapshot,
              profileId: profiles.value,
              profileRevision: Number(
                profiles.selectedOptions[0]?.dataset.revision,
              ),
            });
            status.textContent = "";
          } else {
            const result = await send({
              type: "capture",
              capture: snapshot,
              profileId: profiles.value,
              profileRevision: Number(
                profiles.selectedOptions[0]?.dataset.revision,
              ),
            });
            status.replaceChildren();
            const link = document.createElement("a");
            link.textContent = text.saved;
            link.href = result.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            status.append(link);
            save.hidden = true;
            ai.hidden = true;
            profiles.hidden = true;
          }
        } catch {
          status.textContent = text.failed;
          save.textContent = text.retry;
        } finally {
          save.disabled = false;
          ai.disabled = false;
        }
      }
      save.onclick = (event) => run(event, false);
      ai.onclick = (event) => run(event, true);
      profiles.addEventListener("change", () => {
        snapshot = null;
      });
      bar.append(profiles, save, ai, status, close);
      shadow.append(style, bar);
      document.documentElement.append(host);
      const current = host;
      try {
        const state = await send({ type: "state" });
        if (host !== current) return;
        text = state.locale === "en" ? en : zh;
        save.textContent = text.capture;
        ai.textContent = text.ai;
        if (!state.connected) {
          profiles.hidden = true;
          ai.hidden = true;
          save.textContent = text.login;
          save.onclick = async (event) => {
            if (!event.isTrusted) return;
            snapshot ||= globalThis.DocaCapture.capture("selection", range);
            await send({ type: "login" }).catch(() => {});
            hide();
          };
          status.textContent = text.setup;
          return;
        }
        if (!state.profiles.length) {
          profiles.hidden = true;
          save.disabled = true;
          ai.disabled = true;
          status.textContent = text.setup;
          return;
        }
        for (const profile of state.profiles) {
          const option = document.createElement("option");
          option.value = profile.id;
          option.dataset.revision = String(profile.revision);
          option.textContent = profile.name;
          profiles.append(option);
        }
        profiles.value = (
          state.profiles.find((profile) => profile.isDefault) ||
          state.profiles[0]
        ).id;
        ai.hidden = !state.assistantEnabled;
      } catch {
        status.textContent = text.setup;
        save.disabled = true;
        ai.disabled = true;
      }
    },
    true,
  );
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "snapshot") {
      try {
        snapshot = globalThis.DocaCapture.capture(
          message.mode,
          message.mode === "selection" ? range : null,
        );
        respond({ ok: true, value: snapshot });
      } catch (error) {
        respond({ ok: false, error: error.message });
      }
    }
    if (message.type === "image") {
      const image = snapshot?.images.find(
        (image) => image.id === message.id && image.url === message.url,
      );
      if (!image) {
        respond({ ok: false, error: "clipper_image_unlisted" });
        return;
      }
      fetch(image.url, { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) throw Error("clipper_image_failed");
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 20 * 1024 ** 2)
            throw Error("clipper_image_invalid");
          let binary = "";
          for (let start = 0; start < bytes.length; start += 8192)
            binary += String.fromCharCode(
              ...bytes.subarray(start, start + 8192),
            );
          respond({ ok: true, value: btoa(binary) });
        })
        .catch((error) => respond({ ok: false, error: error.message }));
      return true;
    }
  });
})();
