import { translate } from "./messages.js";
const $ = (id) => document.getElementById(id);
let state = { locale: "zh", connected: false, profiles: [] },
  tab = location.hash === "#assistant" ? "assistant" : "capture",
  busy = false,
  polling = false,
  chatRequest = null,
  activeTab = null,
  renderedOrigin = undefined;
if (location.hash === "#assistant") document.body.classList.add("sidebar");
const t = (key) => translate(state.locale, key);
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw Error(result?.error || "clipper_connection_failed");
  return result.value;
}
function notice(message = "", success = false, url) {
  const node = $("notice");
  node.replaceChildren();
  node.hidden = !message;
  node.className = success ? "success" : "";
  node.append(document.createTextNode(message));
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.textContent = t("open");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    node.append(link);
  }
}
function errorMessage(error) {
  const translated = t(error.message);
  return translated === error.message && error.message.startsWith("clipper_")
    ? t("generalError")
    : translated;
}
function selectTab(value) {
  tab = value;
  for (const item of ["capture", "assistant", "connection"]) {
    $(item + "-pane").hidden = item !== value;
    document
      .querySelector(`[data-tab='${item}']`)
      .classList.toggle("active", item === value);
  }
  if (value === "assistant" && state.connected && state.assistantEnabled)
    void loadChat().catch((error) => notice(errorMessage(error)));
}
function render() {
  document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-label]").forEach((node) => {
    node.textContent = t(node.dataset.label);
  });
  document.querySelectorAll("[data-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.placeholder);
  });
  $("locale").value = state.locale;
  if (renderedOrigin !== state.origin) {
    $("endpoint").value = state.origin || "";
    renderedOrigin = state.origin;
  }
  $("identity").textContent = state.connected
    ? state.user.name
    : "Browser Assistant";
  $("connection-heading").textContent = t(
    state.connected ? "replace" : "notConnected",
  );
  $("connection-detail").textContent = state.connected
    ? `${state.user.name}\n${state.origin}`
    : "";
  for (const id of ["profile", "ai-profile"]) {
    const select = $(id),
      previous = select.value;
    select.replaceChildren();
    if (!state.profiles.length) {
      const option = document.createElement("option");
      option.textContent = t("noProfiles");
      option.value = "";
      select.append(option);
    }
    for (const profile of state.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.append(option);
    }
    select.value = state.profiles.some((profile) => profile.id === previous)
      ? previous
      : (
          state.profiles.find((profile) => profile.isDefault) ||
          state.profiles[0]
        )?.id || "";
  }
  profileDetail();
  $("settings-link").href = state.origin
    ? state.origin + "/#/browser-assistant"
    : "#";
  $("settings-link").hidden = !state.origin;
  for (const id of ["capture-page", "capture-selection"])
    $(id).disabled = busy || !state.connected || !state.profiles.length;
  $("retry").hidden = !state.pending;
  $("open-assistant").hidden = !state.assistantEnabled;
  $("send").disabled =
    busy ||
    !state.connected ||
    !state.assistantEnabled ||
    !state.profiles.length;
  if (!state.connected) {
    const desired = tab;
    selectTab("connection");
    tab = desired;
  } else selectTab(tab);
}
function profileDetail() {
  const profile = state.profiles.find(
    (profile) => profile.id === $("profile").value,
  );
  $("profile-detail").textContent = profile
    ? state.locale === "zh"
      ? `${profile.strategy === "append" ? "追加到文档" : "新建文档"} · ${profile.destinationTitle || (profile.libraryId || profile.targetId ? "保存位置不可用" : "个人文档")}\n原图一起归档`
      : `${profile.strategy === "append" ? "Append" : "New document"} · ${profile.destinationTitle || (profile.libraryId || profile.targetId ? "Destination unavailable" : "Personal documents")}\nOriginal images included`
    : t("noProfiles");
}
async function loadState(interactive = false) {
  state = await send({ type: "state", interactive });
  render();
  if (state.error) notice(errorMessage({ message: state.error }));
}
async function action(work, label) {
  if (busy) return;
  busy = true;
  render();
  notice(t(label));
  try {
    await work();
  } catch (error) {
    notice(errorMessage(error));
  } finally {
    busy = false;
    state = await send({ type: "state" }).catch(() => state);
    render();
  }
}
for (const button of document.querySelectorAll("[data-tab]"))
  button.onclick = () => selectTab(button.dataset.tab);
$("locale").onchange = () =>
  action(async () => {
    state = await send({ type: "locale", locale: $("locale").value });
    render();
    notice();
  }, "working");
$("profile").onchange = profileDetail;
$("login").onclick = () =>
  action(async () => {
    state = await send({ type: "login" });
    await options();
  }, "working");
$("endpoint-form").onsubmit = (event) => {
  event.preventDefault();
  const endpointValue = $("endpoint").value.trim();
  void action(async () => {
    const parsed = new URL(endpointValue);
    if (
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    )
      throw Error("clipper_invalid_origin");
    state = await send({
      type: "configure",
      config: JSON.stringify({ version: 2, origin: parsed.origin }),
    });
    $("prompt").value = "";
    $("conversation").replaceChildren();
    chatRequest = null;
    await options();
    notice(t("connected"), true);
  }, "working");
};
$("configure").onsubmit = (event) => {
  event.preventDefault();
  void action(async () => {
    state = await send({ type: "configure", config: $("config").value });
    $("config").value = "";
    $("prompt").value = "";
    $("attach-page").checked = false;
    $("conversation").replaceChildren();
    chatRequest = null;
    tab = "capture";
    await options();
    notice(t("connected"), true);
  }, "working");
};
for (const mode of ["page", "selection"])
  $("capture-" + mode).onclick = () =>
    action(async () => {
      const result = await send({
        type: "capture",
        mode,
        profileId: $("profile").value,
        profileRevision: state.profiles.find(
          (profile) => profile.id === $("profile").value,
        )?.revision,
        tabId: activeTab?.id,
      });
      notice(t("saved"), true, result.url);
    }, "saving");
$("retry").onclick = () =>
  action(async () => {
    const result = await send({ type: "retry" });
    notice(t("saved"), true, result.url);
  }, "saving");
$("open-assistant").onclick = async () => {
  try {
    if (!activeTab?.id) throw Error("clipper_page_unsupported");
    await chrome.sidePanel.open({ tabId: activeTab.id });
    window.close();
  } catch (error) {
    notice(errorMessage(error));
  }
};
function appendText(node, value) {
  // Render links as native DOM nodes; never execute model HTML.
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)/g;
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    node.append(document.createTextNode(value.slice(end, match.index)));
    try {
      const url = new URL(match[2], state.origin + "/");
      if (!["https:", "http:"].includes(url.protocol)) throw Error();
      const link = document.createElement("a");
      link.href = url.href;
      link.textContent = match[1];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      node.append(link);
    } catch {
      node.append(document.createTextNode(match[0]));
    }
    end = match.index + match[0].length;
  }
  node.append(document.createTextNode(value.slice(end)));
}
async function loadChat() {
  if (
    polling ||
    !state.connected ||
    !state.assistantEnabled ||
    !$("ai-profile").value
  )
    return;
  polling = true;
  try {
    const chat = await send({
        type: "assistantLoad",
        profileId: $("ai-profile").value,
        profileRevision: state.profiles.find(
          (profile) => profile.id === $("ai-profile").value,
        )?.revision,
      }),
      list = $("conversation");
    const nearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.replaceChildren();
    if (!chat.jobs.length) {
      const empty = document.createElement("div");
      empty.className = "empty-chat";
      const strong = document.createElement("strong"),
        paragraph = document.createElement("p");
      strong.textContent = t("emptyChat");
      paragraph.textContent = t("emptyChatHelp");
      empty.append(strong, paragraph);
      list.append(empty);
    }
    for (const job of chat.jobs) {
      const user = document.createElement("div");
      user.className = "bubble user";
      user.textContent = job.text
        .split("\n\n【用户明确附加")[0]
        .split("\n\n当前收录方案：")[0];
      list.append(user);
      const reply = document.createElement("div");
      reply.className = "bubble assistant";
      appendText(
        reply,
        job.progress?.text ||
          (job.status === "cancelled"
            ? t("stopped")
            : job.error
              ? errorMessage({ message: job.error })
              : t("working")),
      );
      for (const approval of job.progress?.approvals || [])
        if (approval.state === "pending") {
          const box = document.createElement("div");
          box.className = "approval";
          box.textContent =
            t("approval") + (approval.preview ? "\n" + approval.preview : "");
          for (const approved of [true, false]) {
            const button = document.createElement("button");
            button.textContent = t(approved ? "approve" : "reject");
            button.onclick = () =>
              action(async () => {
                await send({
                  type: "assistantJob",
                  jobId: job.id,
                  operation: "approval",
                  body: { approvalId: approval.id, approved },
                });
                await loadChat();
                notice();
              }, "working");
            box.append(button);
          }
          reply.append(box);
        }
      if (["queued", "running", "awaiting_approval"].includes(job.status)) {
        const stop = document.createElement("button");
        stop.className = "text-button";
        stop.textContent = t("cancel");
        stop.onclick = () =>
          action(async () => {
            await send({
              type: "assistantJob",
              jobId: job.id,
              operation: "cancel",
            });
            await loadChat();
            notice(t("stopped"));
          }, "working");
        reply.append(document.createElement("br"), stop);
      }
      list.append(reply);
    }
    $("continue-link").hidden = !chat.sessionId;
    if (chat.sessionId)
      $("continue-link").href =
        state.origin + "/#/ai?session=" + chat.sessionId;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  } finally {
    polling = false;
  }
}
async function options() {
  if (!state.connected || !state.assistantEnabled) return;
  const data = await send({ type: "assistantOptions" });
  $("model").replaceChildren();
  for (const model of data.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    $("model").append(option);
  }
  if (data.models.some((model) => model.id === data.defaultModel))
    $("model").value = data.defaultModel;
}
$("ai-profile").onchange = () => {
  chatRequest = null;
  void loadChat().catch((error) => notice(errorMessage(error)));
};
$("new-chat").onclick = () =>
  action(async () => {
    await send({ type: "assistantNew" });
    chatRequest = null;
    await loadChat();
    notice();
  }, "working");
$("model").onchange = $("attach-page").onchange = () => {
  chatRequest = null;
};
$("prompt").oninput = () => {
  chatRequest = null;
};
$("composer").onsubmit = (event) => {
  event.preventDefault();
  if (!$("prompt").value.trim() || !$("model").value) return;
  void action(
    async () => {
      chatRequest ||= crypto.randomUUID();
      await send({
        type: "assistantSend",
        requestId: chatRequest,
        text: $("prompt").value,
        profileId: $("ai-profile").value,
        profileRevision: state.profiles.find(
          (profile) => profile.id === $("ai-profile").value,
        )?.revision,
        modelId: $("model").value,
        attachPage: $("attach-page").checked,
        tabId: activeTab?.id,
      });
      chatRequest = null;
      $("prompt").value = "";
      $("attach-page").checked = false;
      notice();
      await loadChat();
    },
    $("attach-page").checked ? "preparing" : "working",
  );
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.assistantPending?.newValue) {
    $("attach-page").checked = true;
    const profileId = changes.assistantPending.newValue.profileId;
    if (
      [...$("ai-profile").options].some((option) => option.value === profileId)
    )
      $("ai-profile").value = profileId;
  }
});
setInterval(() => {
  if (tab === "assistant" && !document.hidden)
    void loadChat().catch((error) => notice(errorMessage(error)));
}, 1200);
activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
render();
await loadState(true);
await options().catch((error) => notice(errorMessage(error)));
const pending = (await chrome.storage.session.get("assistantPending"))
  .assistantPending;
if (pending) {
  $("attach-page").checked = true;
  if (
    [...$("ai-profile").options].some(
      (option) => option.value === pending.profileId,
    )
  )
    $("ai-profile").value = pending.profileId;
}
