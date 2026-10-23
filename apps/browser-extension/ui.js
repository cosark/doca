import { translate } from "./messages.js";
const loadAssistant = () => import("./generated/assistant.js");
const isSidebar = /^#assistant(?:\?|$)/.test(location.hash);
const launchProfile = new URLSearchParams(location.hash.split("?")[1] || "");
let applyLaunchProfile = true,
  sharedAssistantModule = null,
  rejectedLaunchProfile = false;
const $ = (id) => document.getElementById(id);
let state = { locale: "zh", connected: false, profiles: [] },
  tab = isSidebar ? "assistant" : "capture",
  busy = false,
  activeTab = null,
  renderedOrigin,
  pendingReference = null,
  rememberedProfile = null,
  stateLoading = null,
  stateGeneration = 0,
  stateRefreshQueued = false,
  interactiveStateQueued = false,
  stateErrorNotice = "";
let assistant = null,
  assistantKey = null,
  assistantConfig = null,
  assistantGeneration = 0,
  assistantLoading = null;
let quickNoteScopeKey = null,
  quickNoteGeneration = 0,
  quickNoteTargets = [],
  quickNoteTarget = null,
  quickNoteText = "",
  quickNoteAttempt = null,
  quickNoteLoading = false,
  quickNoteLoaded = false,
  quickNoteSending = false,
  quickNoteResetConfirmation = false,
  quickNoteStatus = null;
if (isSidebar) {
  document.body.classList.add("sidebar");
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "generated/assistant.css";
  document.head.append(css);
}
const dropdowns = [...document.querySelectorAll("select")].map((select) =>
  globalThis.DocaSelect.enhance(select),
);
const t = (key) => translate(state.locale, key);
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok)
    throw Object.assign(Error(result?.error || "clipper_connection_failed"), {
      status: result?.status,
    });
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
const quickNoteUuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const quickNoteErrorKeys = new Set([
  "quick_note_text_invalid",
  "quick_note_invalid_response",
  "quick_note_ticket_missing",
  "quick_note_request_conflict",
  "quick_note_request_already_used",
  "quick_note_signin_changed",
  "quick_note_busy",
  "clipper_connection_failed",
  "clipper_connection_revoked",
  "clipper_login_required",
  "clipper_not_connected",
  "clipper_profile_changed",
  "clipper_profile_unavailable",
  "clipper_scope_denied",
  "clipper_target_uninitialized",
]);
function quickNoteErrorMessage(code) {
  return t(quickNoteErrorKeys.has(code) ? code : "quicknote.error.generic");
}
function quickNoteAckValid(result, snapshot) {
  try {
    if (typeof result.url !== "string" || typeof result.epochId !== "string")
      return false;
    const url = new URL(result.url);
    return (
      result.requestId === snapshot.requestId &&
      result.targetId === snapshot.targetId &&
      ["http:", "https:"].includes(url.protocol) &&
      url.origin === snapshot.origin &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "#/r/" + snapshot.targetId &&
      !url.username &&
      !url.password &&
      Number.isSafeInteger(result.seq) &&
      result.seq >= 0 &&
      quickNoteUuid.test(result.epochId) &&
      typeof result.changed === "boolean"
    );
  } catch {
    return false;
  }
}
function quickNoteScope() {
  return state.connected
    ? {
        origin: state.origin,
        connectionId: state.connectionId,
        userId: state.user.id,
      }
    : null;
}
function renderQuickNote() {
  $("quick-note").hidden = isSidebar;
  if (isSidebar) return;
  const scope = quickNoteScope();
  const key = scope
    ? JSON.stringify([scope.origin, scope.userId, scope.connectionId])
    : null;
  if (key !== quickNoteScopeKey) {
    const retained = quickNoteTarget || quickNoteAttempt || quickNoteText;
    quickNoteScopeKey = key;
    quickNoteGeneration++;
    quickNoteTargets = [];
    quickNoteTarget = quickNoteAttempt = null;
    quickNoteLoading = quickNoteLoaded = quickNoteResetConfirmation = false;
    quickNoteStatus = retained
      ? { key: "quicknote.scope.changed", error: true }
      : null;
  }
  const select = $("quick-note-target");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = t("quicknote.choose");
  select.append(placeholder);
  for (const target of quickNoteTargets) {
    const option = document.createElement("option");
    option.value = target.profileId;
    option.textContent = `${target.title} · ${target.profileName}`;
    select.append(option);
  }
  select.value = quickNoteTarget?.profileId || "";
  select.disabled =
    !scope ||
    busy ||
    quickNoteLoading ||
    quickNoteSending ||
    !!quickNoteAttempt;
  $("quick-note-refresh").disabled =
    !scope ||
    busy ||
    quickNoteLoading ||
    quickNoteSending ||
    !!quickNoteAttempt;
  $("quick-note-empty").hidden =
    !quickNoteLoaded || quickNoteLoading || !!quickNoteTargets.length;
  if ($("quick-note-text").value !== quickNoteText)
    $("quick-note-text").value = quickNoteText;
  $("quick-note-save").disabled =
    !scope ||
    busy ||
    quickNoteSending ||
    !quickNoteTarget ||
    !quickNoteText.trim() ||
    !!quickNoteAttempt;
  $("quick-note-retry").hidden =
    !quickNoteAttempt ||
    !["prepare-uncertain", "commit-uncertain"].includes(quickNoteAttempt.phase);
  $("quick-note-retry").disabled = !scope || busy || quickNoteSending;
  $("quick-note-clear").hidden = !quickNoteAttempt;
  $("quick-note-clear").disabled = busy || quickNoteSending;
  $("quick-note-reset-confirmation").hidden = !quickNoteResetConfirmation;
  $("quick-note-confirm-reset").disabled = busy || quickNoteSending;
  const link = $("quick-note-target-link");
  const linkTarget = quickNoteAttempt?.snapshot || quickNoteTarget;
  link.hidden = !linkTarget;
  if (linkTarget && scope)
    link.href =
      scope.origin + "/#/r/" + encodeURIComponent(linkTarget.targetId);
  else link.removeAttribute("href");
  const status = $("quick-note-status");
  status.hidden = !quickNoteStatus && !quickNoteLoading;
  status.textContent = quickNoteLoading
    ? t("quicknote.loading")
    : quickNoteStatus
      ? t(quickNoteStatus.key) +
        (quickNoteStatus.code
          ? "\n" + quickNoteErrorMessage(quickNoteStatus.code)
          : "")
      : "";
  status.className = quickNoteStatus?.error
    ? "error"
    : quickNoteStatus?.success
      ? "success"
      : "";
  dropdowns.forEach((dropdown) => dropdown.sync());
  if (
    $("quick-note").open &&
    scope &&
    !quickNoteLoaded &&
    !quickNoteLoading &&
    !quickNoteAttempt
  )
    void loadQuickNoteTargets();
}
async function loadQuickNoteTargets() {
  const scope = quickNoteScope(),
    generation = quickNoteGeneration;
  if (
    isSidebar ||
    !scope ||
    quickNoteLoading ||
    quickNoteSending ||
    quickNoteAttempt
  )
    return;
  quickNoteLoading = true;
  renderQuickNote();
  try {
    const result = await send({
      type: "quickNoteTargets",
      origin: scope.origin,
      connectionId: scope.connectionId,
    });
    if (generation !== quickNoteGeneration) return;
    if (
      !Array.isArray(result?.items) ||
      result.items.some(
        (item) =>
          typeof item.profileId !== "string" ||
          !quickNoteUuid.test(item.profileId) ||
          typeof item.targetId !== "string" ||
          !quickNoteUuid.test(item.targetId) ||
          !Number.isSafeInteger(item.profileRevision) ||
          item.profileRevision < 1 ||
          !["rich_text", "markdown"].includes(item.format) ||
          typeof item.title !== "string" ||
          typeof item.profileName !== "string" ||
          typeof item.isDefault !== "boolean",
      ) ||
      new Set(result.items.map((item) => item.profileId)).size !==
        result.items.length
    )
      throw Error("quick_note_invalid_response");
    quickNoteTargets = result.items.map((item) => ({ ...item }));
    if (quickNoteTarget) {
      const previous = quickNoteTarget;
      quickNoteTarget =
        quickNoteTargets.find(
          (item) =>
            item.profileId === previous.profileId &&
            item.profileRevision === previous.profileRevision &&
            item.targetId === previous.targetId &&
            item.format === previous.format,
        ) || null;
      if (!quickNoteTarget)
        quickNoteStatus = { key: "quicknote.target.changed", error: true };
    }
  } catch (error) {
    if (generation === quickNoteGeneration)
      quickNoteStatus = {
        key: "quicknote.failed",
        code: error.message,
        error: true,
      };
  } finally {
    if (generation === quickNoteGeneration) {
      quickNoteLoading = false;
      quickNoteLoaded = true;
      renderQuickNote();
    }
  }
}
async function submitQuickNote(retry = false) {
  const scope = quickNoteScope();
  if (isSidebar || busy || quickNoteSending || !scope) return;
  if (!retry) {
    if (quickNoteAttempt || !quickNoteTarget) return;
    if (
      !quickNoteText.trim() ||
      new TextEncoder().encode(quickNoteText).byteLength > 64 * 1024
    ) {
      quickNoteStatus = {
        key: "quicknote.failed",
        code: "quick_note_text_invalid",
        error: true,
      };
      renderQuickNote();
      return;
    }
    quickNoteAttempt = {
      snapshot: Object.freeze({
        ...scope,
        requestId: crypto.randomUUID(),
        profileId: quickNoteTarget.profileId,
        profileRevision: quickNoteTarget.profileRevision,
        targetId: quickNoteTarget.targetId,
        format: quickNoteTarget.format,
        text: quickNoteText,
      }),
      ticket: null,
      expiresAt: null,
      phase: "preparing",
    };
  } else if (
    !quickNoteAttempt ||
    !["prepare-uncertain", "commit-uncertain"].includes(quickNoteAttempt.phase)
  )
    return;
  const operation = quickNoteAttempt,
    snapshot = operation.snapshot,
    generation = quickNoteGeneration;
  const current = () =>
    generation === quickNoteGeneration && quickNoteAttempt === operation;
  quickNoteSending = true;
  quickNoteResetConfirmation = false;
  quickNoteStatus = { key: "quicknote.saving" };
  render();
  try {
    if (!operation.ticket) {
      operation.phase = "preparing";
      const prepared = await send({
        type: "quickNotePrepare",
        origin: snapshot.origin,
        connectionId: snapshot.connectionId,
        requestId: snapshot.requestId,
        profileId: snapshot.profileId,
        profileRevision: snapshot.profileRevision,
        text: snapshot.text,
      });
      if (!current()) return;
      if (
        prepared?.requestId !== snapshot.requestId ||
        prepared.targetId !== snapshot.targetId ||
        prepared.format !== snapshot.format ||
        typeof prepared.ticket !== "string" ||
        !/^[a-f0-9]{64}$/.test(prepared.ticket) ||
        typeof prepared.expiresAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          prepared.expiresAt,
        ) ||
        !Number.isFinite(Date.parse(prepared.expiresAt))
      )
        throw Error("quick_note_invalid_response");
      operation.ticket = prepared.ticket;
      operation.expiresAt = prepared.expiresAt;
    }
    if (Date.parse(operation.expiresAt) <= Date.now())
      throw Error("quick_note_ticket_missing");
    operation.phase = "committing";
    const result = await send({
      type: "quickNoteCommit",
      origin: snapshot.origin,
      connectionId: snapshot.connectionId,
      requestId: snapshot.requestId,
      ticket: operation.ticket,
    });
    if (!current()) return;
    if (!quickNoteAckValid(result, snapshot))
      throw Error("quick_note_invalid_response");
    if (quickNoteText === snapshot.text) quickNoteText = "";
    quickNoteAttempt = null;
    quickNoteStatus = { key: "quicknote.saved", success: true };
  } catch (error) {
    if (!current()) return;
    const invalidAcknowledgement =
      operation.phase === "committing" &&
      error.message === "quick_note_invalid_response";
    const targetInvalid =
      [403, 404].includes(error.status) ||
      [
        "clipper_profile_changed",
        "clipper_profile_unavailable",
        "clipper_target_unsupported",
        "clipper_target_uninitialized",
      ].includes(error.message);
    const blocked =
      !invalidAcknowledgement &&
      error.message !== "quick_note_busy" &&
      ([400, 401, 403, 404, 409].includes(error.status) ||
        [
          "quick_note_invalid_response",
          "quick_note_ticket_missing",
          "quick_note_request_conflict",
          "quick_note_request_already_used",
          "quick_note_signin_changed",
          "clipper_profile_changed",
          "clipper_profile_unavailable",
          "clipper_connection_revoked",
          "clipper_scope_denied",
          "clipper_target_unsupported",
          "clipper_target_uninitialized",
        ].includes(error.message));
    operation.phase = blocked
      ? "blocked"
      : operation.ticket
        ? "commit-uncertain"
        : "prepare-uncertain";
    if (targetInvalid) {
      operation.needsReselect = true;
      quickNoteTarget = null;
    }
    quickNoteStatus = {
      key: targetInvalid
        ? "quicknote.target.blocked"
        : blocked
          ? "quicknote.blocked"
          : "quicknote.uncertain",
      code: error.message,
      error: true,
    };
  } finally {
    quickNoteSending = false;
    render();
  }
}
function selectTab(value) {
  tab = value;
  for (const item of ["capture", "assistant", "connection"]) {
    $(item + "-pane").hidden = item !== value;
  }
  $("back").hidden = value !== "connection" || !state.connected;
  $("settings").hidden = value === "connection";
  if (value === "assistant")
    void syncAssistant().catch((error) => notice(errorMessage(error)));
}
function pageReference() {
  const capture =
    pendingReference &&
    pendingReference.origin === state.origin &&
    pendingReference.connectionId === state.connectionId &&
    pendingReference.profileId === $("ai-profile").value
      ? pendingReference.capture
      : null;
  const url = capture?.url || activeTab?.url || "";
  return /^https?:\/\//.test(url)
    ? {
        title:
          (capture?.mode === "selection"
            ? t("selectionReference") + " · "
            : "") +
          (capture?.title || activeTab?.title || new URL(url).hostname),
        url,
      }
    : { title: t("pageUnavailable"), url: "" };
}
function renderReference() {
  void syncAssistant().catch((error) => notice(errorMessage(error)));
}
async function syncAssistant() {
  if (!isSidebar) return;
  const profile = state.profiles.find(
    (profile) => profile.id === $("ai-profile").value,
  );
  if (!state.connected || !state.assistantEnabled || !profile) {
    assistantGeneration++;
    assistant?.unmount();
    assistant = null;
    assistantKey = null;
    assistantConfig = null;
    $("assistant-root").textContent = state.connected
      ? t(
          !state.assistantEnabled
            ? "aiDisabled"
            : rejectedLaunchProfile
              ? "clipper_profile_changed"
              : "noProfiles",
        )
      : "";
    return;
  }
  const key = JSON.stringify([
    state.origin,
    state.connectionId,
    state.user.id,
    profile.id,
    profile.revision,
  ]);
  const page = pageReference();
  if (key === assistantKey) {
    if (!assistant) await assistantLoading;
    if (
      assistant &&
      (JSON.stringify(assistantConfig.page) !== JSON.stringify(page) ||
        assistantConfig.locale !== state.locale)
    ) {
      assistantConfig = { ...assistantConfig, page, locale: state.locale };
      assistant.update(assistantConfig);
    }
    return;
  }
  assistantKey = key;
  const generation = ++assistantGeneration;
  assistant?.unmount();
  assistant = null;
  assistantConfig = null;
  const scope = {
    origin: state.origin,
    connectionId: state.connectionId,
    profileId: profile.id,
  };
  assistantLoading = send({
    type: "assistantSession",
    ...scope,
    operation: "get",
  });
  const initial = await assistantLoading;
  if (generation !== assistantGeneration) return;
  const config = {
    origin: state.origin,
    connectionId: state.connectionId,
    userId: state.user.id,
    userName: state.user.name,
    locale: state.locale,
    sessionId: initial.sessionId,
    profile: { id: profile.id, revision: profile.revision, name: profile.name },
    page: pageReference(),
    request: async (path, method = "GET", body, signal) => {
      signal?.throwIfAborted();
      if (!path.startsWith("/ai/")) throw Error("clipper_scope_denied");
      const result = await send({
        type: "assistantRequest",
        ...scope,
        path: "/assistant/ui/" + path.slice(4),
        method,
        body,
      });
      signal?.throwIfAborted();
      return result;
    },
    captureCurrentPage: () =>
      send({
        type: "assistantPreparePage",
        ...scope,
        profileRevision: profile.revision,
        tabId: activeTab?.id,
      }),
    onSessionChange: (id) => {
      void send({
        type: "assistantSession",
        ...scope,
        operation: "set",
        id,
      }).catch((error) => {
        if (generation === assistantGeneration) notice(errorMessage(error));
      });
    },
    openDoca: (href) => {
      const url = new URL(href);
      if (["https:", "http:"].includes(url.protocol))
        void chrome.tabs.create({ url: url.href });
    },
  };
  const module = await (sharedAssistantModule ||= loadAssistant());
  if (generation !== assistantGeneration) return;
  config.page = pageReference();
  config.locale = state.locale;
  $("assistant-root").replaceChildren();
  assistantConfig = config;
  assistant = module.mountBrowserAssistant($("assistant-root"), config);
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
  $("settings").title = $("settings").ariaLabel = t("extensionSettings");
  $("back").title = $("back").ariaLabel = t("back");
  if (renderedOrigin !== state.origin) {
    $("endpoint").value = state.origin || "";
    renderedOrigin = state.origin;
  }
  $("identity").textContent = state.connected
    ? state.user.name
    : t("assistant");
  $("connection-heading").textContent = t(
    state.connected ? "replace" : "notConnected",
  );
  $("connection-detail").textContent = state.connected
    ? `${state.user.name}\n${state.origin}`
    : "";
  for (const id of ["profile", "ai-profile"]) {
    const select = $(id),
      previous =
        select.value ||
        (rememberedProfile &&
        rememberedProfile.origin === state.origin &&
        rememberedProfile.connectionId === state.connectionId
          ? rememberedProfile.id
          : "");
    select.replaceChildren();
    if (!state.profiles.length || rejectedLaunchProfile) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t(
        rejectedLaunchProfile ? "selectProfile" : "noProfiles",
      );
      option.disabled = true;
      select.append(option);
    }
    for (const profile of state.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent =
        profile.name + (profile.isDefault ? ` · ${t("defaultProfile")}` : "");
      select.append(option);
    }
    select.value = rejectedLaunchProfile
      ? ""
      : state.profiles.some((profile) => profile.id === previous)
        ? previous
        : (
            state.profiles.find((profile) => profile.isDefault) ||
            state.profiles[0]
          )?.id || "";
  }
  if (applyLaunchProfile && state.connected) {
    applyLaunchProfile = false;
    const id = launchProfile.get("profileId"),
      revision = launchProfile.get("profileRevision");
    if (id) {
      const chosen = state.profiles.find((profile) => profile.id === id);
      if (chosen && String(chosen.revision) === revision)
        $("profile").value = $("ai-profile").value = id;
      else {
        rejectedLaunchProfile = true;
        for (const key of ["profile", "ai-profile"]) {
          const select = $(key),
            option = document.createElement("option");
          option.value = "";
          option.disabled = true;
          option.textContent = t("selectProfile");
          select.prepend(option);
          select.value = "";
        }
        notice(t("clipper_profile_changed"));
      }
    }
  }
  $("settings-link").href = state.origin
    ? state.origin + "/#/browser-assistant"
    : "#";
  $("settings-link").hidden = !state.origin;
  for (const id of ["capture-page", "capture-selection"])
    $(id).disabled =
      busy || quickNoteSending || !state.connected || !$("profile").value;
  $("open-assistant").disabled =
    busy ||
    quickNoteSending ||
    !state.connected ||
    !state.assistantEnabled ||
    !$("profile").value;
  $("retry").hidden = !state.pending;
  $("open-assistant").hidden = !state.assistantEnabled;
  profileDetail();
  renderQuickNote();
  dropdowns.forEach((dropdown) => dropdown.sync());
  if (!state.connected) {
    const desired = tab;
    selectTab("connection");
    tab = desired;
    void syncAssistant();
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
function rememberProfile() {
  if (state.connected && $("profile").value)
    rememberedProfile = {
      origin: state.origin,
      connectionId: state.connectionId,
      id: $("profile").value,
    };
}
function loadState(interactive = false) {
  stateRefreshQueued = true;
  interactiveStateQueued ||= interactive;
  if (stateLoading || busy) return stateLoading || Promise.resolve();
  stateLoading = (async () => {
    while (stateRefreshQueued && !busy) {
      const interactive = interactiveStateQueued;
      const generation = stateGeneration;
      stateRefreshQueued = interactiveStateQueued = false;
      const result = await send({ type: "state", interactive }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      if (generation !== stateGeneration || busy) {
        stateRefreshQueued = true;
        if (busy) break;
        continue;
      }
      if ("error" in result) throw result.error;
      rememberProfile();
      state = result.value;
      render();
      if (state.error) {
        stateErrorNotice = errorMessage({ message: state.error });
        notice(stateErrorNotice);
      } else {
        if (stateErrorNotice && $("notice").textContent === stateErrorNotice)
          notice();
        stateErrorNotice = "";
      }
    }
  })().finally(() => {
    stateLoading = null;
    if (stateRefreshQueued && !busy) return loadState(false);
  });
  return stateLoading;
}
function refreshConnection() {
  void loadState(false).catch((error) => notice(errorMessage(error)));
}
async function action(work, label) {
  if (busy || quickNoteSending) return;
  stateGeneration++;
  rememberProfile();
  busy = true;
  render();
  notice(t(label));
  try {
    await work();
  } catch (error) {
    notice(errorMessage(error));
  } finally {
    stateGeneration++;
    busy = false;
    render();
    await loadState(false).catch(() => render());
  }
}
$("settings").onclick = () => selectTab("connection");
$("back").onclick = () => selectTab(isSidebar ? "assistant" : "capture");
$("locale").onchange = () => {
  const locale = $("locale").value;
  return action(async () => {
    state = await send({ type: "locale", locale });
    render();
    notice();
  }, "working");
};
for (const id of ["profile", "ai-profile"])
  $(id).onchange = () => {
    rejectedLaunchProfile = false;
    const other = id === "profile" ? "ai-profile" : "profile";
    $(other).value = $(id).value;
    if (isSidebar) {
      const profile = state.profiles.find(
        (profile) => profile.id === $(id).value,
      );
      if (profile)
        history.replaceState(
          null,
          "",
          "#assistant?" +
            new URLSearchParams({
              profileId: profile.id,
              profileRevision: String(profile.revision),
            }),
        );
    }
    profileDetail();
    dropdowns.forEach((dropdown) => dropdown.sync());
    renderReference();
  };
$("login").onclick = () =>
  action(async () => {
    state = await send({ type: "login" });
    notice();
  }, "working");
$("endpoint-form").onsubmit = (event) => {
  event.preventDefault();
  const value = $("endpoint").value.trim();
  void action(async () => {
    const parsed = new URL(value);
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
    pendingReference = null;
    notice(t("connected"), true);
  }, "working");
};
$("configure").onsubmit = (event) => {
  event.preventDefault();
  void action(async () => {
    state = await send({ type: "configure", config: $("config").value });
    $("config").value = "";
    pendingReference = null;
    tab = isSidebar ? "assistant" : "capture";
    notice(t("connected"), true);
  }, "working");
};
for (const mode of ["page", "selection"])
  $("capture-" + mode).onclick = () =>
    action(async () => {
      const profile = state.profiles.find(
        (profile) => profile.id === $("profile").value,
      );
      const result = await send({
        type: "capture",
        mode,
        profileId: profile?.id,
        profileRevision: profile?.revision,
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
    if (!activeTab?.id || !/^https?:\/\//.test(activeTab.url || ""))
      throw Error("clipper_page_unsupported");
    const profile = state.profiles.find(
      (profile) => profile.id === $("profile").value,
    );
    if (!profile) throw Error("clipper_profile_unavailable");
    const query = new URLSearchParams({
      profileId: profile.id,
      profileRevision: String(profile.revision),
    });
    // Issue both Chrome API calls while the click's user gesture is live.
    const configured = chrome.sidePanel.setOptions({
      tabId: activeTab.id,
      path: "ui.html#assistant?" + query,
      enabled: true,
    });
    const opened = chrome.sidePanel.open({ tabId: activeTab.id });
    await Promise.all([configured, opened]);
    window.close();
  } catch (error) {
    notice(errorMessage(error));
  }
};
$("quick-note").ontoggle = () => {
  if ($("quick-note").open) renderQuickNote();
};
$("quick-note-target").onchange = () => {
  if (quickNoteAttempt || quickNoteSending) return;
  quickNoteTarget =
    quickNoteTargets.find(
      (item) => item.profileId === $("quick-note-target").value,
    ) || null;
  quickNoteStatus = null;
  renderQuickNote();
};
$("quick-note-text").oninput = () => {
  quickNoteText = $("quick-note-text").value;
  renderQuickNote();
};
$("quick-note-refresh").onclick = () => void loadQuickNoteTargets();
$("quick-note-save").onclick = () => void submitQuickNote();
$("quick-note-retry").onclick = () => void submitQuickNote(true);
$("quick-note-clear").onclick = () => {
  if (!quickNoteAttempt || quickNoteSending || busy) return;
  quickNoteResetConfirmation = true;
  renderQuickNote();
};
$("quick-note-confirm-reset").onclick = () => {
  if (!quickNoteResetConfirmation || quickNoteSending || busy) return;
  if (quickNoteAttempt?.needsReselect) {
    quickNoteTarget = null;
    quickNoteTargets = [];
    quickNoteLoaded = false;
  }
  quickNoteAttempt = null;
  quickNoteResetConfirmation = false;
  quickNoteStatus = { key: "quicknote.reset.done" };
  renderQuickNote();
};
$("quick-note-cancel-reset").onclick = () => {
  quickNoteResetConfirmation = false;
  renderQuickNote();
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.assistantPending) {
    pendingReference = changes.assistantPending.newValue || null;
    renderReference();
  }
  const keys =
    area === "session"
      ? ["authorization", "lastError"]
      : area === "local"
        ? ["site", "locale"]
        : [];
  if (
    keys.some(
      (key) =>
        changes[key] &&
        JSON.stringify(changes[key].oldValue) !==
          JSON.stringify(changes[key].newValue),
    )
  )
    refreshConnection();
});
window.addEventListener("focus", refreshConnection);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshConnection();
});
async function refreshTab() {
  activeTab = (
    await chrome.tabs.query({ active: true, currentWindow: true })
  )[0];
  renderReference();
}
chrome.tabs.onActivated.addListener(() => void refreshTab());
chrome.tabs.onUpdated.addListener((id, change) => {
  if (
    id === activeTab?.id &&
    (change.url || change.title || change.status === "complete")
  )
    void refreshTab();
});
await refreshTab();
const commands = await chrome.commands.getAll();
$("shortcuts").textContent = commands
  .filter((command) => command.name.startsWith("capture-"))
  .map(
    (command) =>
      t(command.name === "capture-page" ? "page" : "selection") +
      ": " +
      (command.shortcut || "—"),
  )
  .join(" · ");
render();
await loadState(true);
pendingReference =
  (await chrome.storage.session.get("assistantPending")).assistantPending ||
  null;
renderReference();
