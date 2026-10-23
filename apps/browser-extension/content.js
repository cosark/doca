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
      if (event.key === "Escape") dismiss();
    },
    true,
  );
  let dropdown = null;
  const originalHide = hide;
  const dismiss = () => {
    dropdown?.destroy();
    dropdown = null;
    originalHide();
  };
  document.addEventListener(
    "mouseup",
    (event) => {
      if (!event.isTrusted || event.composedPath().includes(host)) return;
      const editable =
        event.target instanceof Element &&
        event.target.closest("input,textarea,[contenteditable='true']");
      const selection = window.getSelection();
      if (
        editable ||
        !selection?.rangeCount ||
        selection.isCollapsed ||
        !selection.toString().trim()
      ) {
        dismiss();
        return;
      }
      range = selection.getRangeAt(0).cloneRange();
      snapshot = null;
      const rect = range.getBoundingClientRect();
      dismiss();
      host = document.createElement("div");
      host.dataset.docaCaptureUi = "true";
      host.style.cssText = `position:fixed;z-index:2147483647;top:${Math.max(8, Math.min(innerHeight - 42, rect.bottom + 6))}px;left:${Math.max(8, Math.min(innerWidth - 66, rect.right - 32))}px;`;
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `:host{all:initial;color-scheme:light}[hidden]{display:none!important}*{box-sizing:border-box}.launcher{display:flex;gap:3px;align-items:center;animation:enter .16s ease-out}button,a{font:12px/1.5 system-ui,sans-serif;cursor:pointer;color:#655276;text-decoration:none}button{border:1px solid #e7e1ee;border-radius:8px;background:#fff;padding:7px 10px;transition:background .15s,transform .12s}button:hover{background:#f4f0ff}button:active{transform:scale(.96)}button:disabled{opacity:.5}button:focus-visible{outline:2px solid #7051be;outline-offset:2px}.logo{display:flex;padding:0;border:0;background:none;width:32px;height:32px;box-shadow:0 3px 12px #30223b25;border-radius:9px}.logo svg{width:32px;height:32px}.close{border:0;padding:0;border-radius:50%;width:20px;height:20px;color:#8d7f99;box-shadow:0 1px 6px #30223b15}.panel{position:fixed;width:min(270px,calc(100vw - 16px));font:12px/1.5 system-ui,sans-serif;border:1px solid #e7e1ee;border-radius:12px;background:#fff;padding:10px;box-shadow:0 8px 28px #30223b24;color:#655276;animation:enter .16s ease-out}.actions{display:flex;gap:6px;margin-top:8px}.actions button{flex:1}.actions button:first-child{background:#3370ff;color:#fff;border-color:#3370ff}.actions button:last-child{background:#f7f3ff;color:#7051be;border-color:#e8ddff}.status{display:block;font-size:11px;color:#8d7f99;margin-top:6px;overflow-wrap:anywhere}.status:empty{display:none}.status a{color:#7051be}.doca-select{display:block;min-width:0}.doca-select-trigger{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left}.doca-select-trigger>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.doca-select-arrow{width:6px;height:6px;border-right:1px solid #a092af;border-bottom:1px solid #a092af;transform:rotate(45deg);margin:-3px 3px 0 0;flex:none}.doca-select-menu{position:fixed;z-index:2;background:#fff;border:1px solid #e7e1ee;border-radius:8px;padding:4px;overflow:auto;box-shadow:0 6px 22px #30223b22;animation:enter .14s ease-out}.doca-select-option{display:block;width:100%;border:0;text-align:left;overflow-wrap:anywhere}.doca-select-option.is-active,.doca-select-option:hover{background:#f4f0ff}.doca-select-option[aria-selected=true]{color:#7051be;font-weight:600}@keyframes enter{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
      const launcher = document.createElement("div"),
        icon = document.createElement("button"),
        close = document.createElement("button"),
        panel = document.createElement("div");
      launcher.className = "launcher";
      icon.className = "logo";
      close.className = "close";
      close.textContent = "×";
      close.title = text.close;
      close.setAttribute("aria-label", text.close);
      icon.setAttribute("aria-label", text.capture);
      icon.setAttribute("aria-expanded", "false");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 128 128");
      svg.setAttribute("aria-hidden", "true");
      for (const [name, attributes] of [
        ["rect", { width: 128, height: 128, rx: 30, fill: "#3370ff" }],
        [
          "path",
          {
            fill: "white",
            d: "M36 29h27c24 0 39 14 39 35S87 99 63 99H36zm19 17v36h8c13 0 20-7 20-18s-7-18-20-18z",
          },
        ],
        ["circle", { cx: 31, cy: 99, r: 9, fill: "#a7c6ff" }],
      ]) {
        const node = document.createElementNS(svg.namespaceURI, name);
        for (const [key, value] of Object.entries(attributes))
          node.setAttribute(key, String(value));
        svg.append(node);
      }
      icon.append(svg);
      launcher.append(icon, close);
      panel.className = "panel";
      panel.hidden = true;
      const profiles = document.createElement("select"),
        save = document.createElement("button"),
        ai = document.createElement("button"),
        status = document.createElement("span"),
        actions = document.createElement("div");
      status.className = "status";
      status.setAttribute("role", "status");
      actions.className = "actions";
      actions.append(save, ai);
      panel.append(profiles, actions, status);
      shadow.append(style, launcher, panel);
      document.documentElement.append(host);
      const current = host;
      function position() {
        const box = icon.getBoundingClientRect();
        panel.style.left =
          Math.max(
            8,
            Math.min(
              innerWidth - panel.offsetWidth - 8,
              box.right - panel.offsetWidth,
            ),
          ) + "px";
        panel.style.top =
          (box.bottom + panel.offsetHeight + 8 <= innerHeight
            ? box.bottom + 6
            : Math.max(8, box.top - panel.offsetHeight - 6)) + "px";
      }
      close.onclick = dismiss;
      // Keep the webpage selection while still allowing keyboard focus in the controls.
      shadow.addEventListener("mousedown", (e) => {
        if (e.target instanceof Element && e.target.closest("button,a"))
          e.preventDefault();
      });
      let loaded = false;
      icon.onclick = async (event) => {
        if (!event.isTrusted) return;
        panel.hidden = !panel.hidden;
        icon.setAttribute("aria-expanded", String(!panel.hidden));
        if (panel.hidden) {
          dropdown?.close();
          return;
        }
        position();
        if (loaded) return;
        loaded = true;
        save.disabled = ai.disabled = true;
        save.textContent = text.capture;
        ai.textContent = text.ai;
        try {
          const state = await send({ type: "state" });
          if (host !== current) return;
          text = state.locale === "en" ? en : zh;
          save.textContent = text.capture;
          ai.textContent = text.ai;
          close.title = text.close;
          close.setAttribute("aria-label", text.close);
          icon.setAttribute("aria-label", text.capture);
          if (!state.connected) {
            profiles.hidden = true;
            ai.hidden = true;
            save.disabled = false;
            save.textContent = text.login;
            status.textContent = text.setup;
            save.onclick = async (e) => {
              if (e.isTrusted) {
                await send({ type: "login" }).catch(() => {});
                dismiss();
              }
            };
            position();
            return;
          }
          if (!state.profiles.length) {
            profiles.hidden = true;
            status.textContent = text.setup;
            position();
            return;
          }
          for (const profile of state.profiles) {
            const option = document.createElement("option");
            option.value = profile.id;
            option.dataset.revision = String(profile.revision);
            option.textContent =
              profile.name +
              (profile.isDefault
                ? state.locale === "en"
                  ? " · Default"
                  : " · 默认"
                : "");
            profiles.append(option);
          }
          profiles.value = (
            state.profiles.find((p) => p.isDefault) || state.profiles[0]
          ).id;
          profiles.setAttribute(
            "aria-label",
            state.locale === "en" ? "Capture profile" : "收录方案",
          );
          dropdown = globalThis.DocaSelect.enhance(profiles);
          save.disabled = ai.disabled = false;
          ai.hidden = !state.assistantEnabled;
          position();
        } catch {
          status.textContent = text.setup;
          position();
        }
      };
      async function run(event, assistant) {
        if (!event.isTrusted) return;
        save.disabled = ai.disabled = true;
        status.textContent = text.busy;
        position();
        try {
          snapshot ||= globalThis.DocaCapture.capture("selection", range);
          const result = await send({
            type: assistant ? "openAssistant" : "capture",
            capture: snapshot,
            profileId: profiles.value,
            profileRevision: Number(
              profiles.selectedOptions[0]?.dataset.revision,
            ),
          });
          if (assistant) {
            status.textContent = "";
          } else {
            const link = document.createElement("a");
            link.textContent = text.saved;
            link.href = result.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            status.replaceChildren(link);
            actions.hidden = true;
            profiles.parentElement.hidden = true;
          }
        } catch {
          status.textContent = text.failed;
          save.textContent = text.retry;
        } finally {
          save.disabled = ai.disabled = false;
          position();
        }
      }
      save.onclick = (e) => run(e, false);
      ai.onclick = (e) => run(e, true);
    },
    true,
  );
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "snapshot") {
      try {
        snapshot = globalThis.DocaCapture.capture(
          message.mode,
          message.mode === "selection"
            ? (() => {
                const current = window.getSelection();
                return current?.rangeCount && !current.isCollapsed
                  ? current.getRangeAt(0).cloneRange()
                  : range;
              })()
            : null,
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
