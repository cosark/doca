export const messages = {
  zh: {
    "quicknote.title": "快速记录",
    "quicknote.help":
      "直接追加到已授权的富文本或 Markdown 文档，不使用 AI。文字与目标仅保留在本次打开的插件中。",
    "quicknote.target": "选择追加文档",
    "quicknote.choose": "请选择文档",
    "quicknote.refresh": "刷新文档",
    "quicknote.empty":
      "暂无可用目标。请在 Doca 启用追加规则并选择可编辑的富文本或 Markdown 文档。",
    "quicknote.text": "记录内容",
    "quicknote.placeholder": "写下要追加的文字…",
    "quicknote.open": "打开目标文档",
    "quicknote.save": "追加记录",
    "quicknote.retry": "重试同一记录",
    "quicknote.reset": "结束本次尝试",
    "quicknote.reset.help":
      "结束不会撤回可能已保存的内容。请先检查目标文档，再决定是否开始新的记录；此操作不会自动发送。",
    "quicknote.confirm.reset": "已检查文档，结束本次尝试",
    "quicknote.cancel.reset": "返回",
    "quicknote.reset.done":
      "本次尝试已结束，文字已保留。开始新的记录前，请确认目标文档中没有重复内容。",
    "quicknote.loading": "正在读取可追加文档…",
    "quicknote.saving": "正在追加记录，请保留此窗口…",
    "quicknote.saved": "记录已追加到文档。",
    "quicknote.failed": "尚未完成，请检查后重试。文字已保留。",
    "quicknote.uncertain":
      "无法确认此次记录的结果，文字已保留。请先检查目标文档；重试仅继续原来的记录。",
    "quicknote.blocked":
      "此次记录已停止，文字已保留。请先检查目标文档；系统不会自动重发。",
    "quicknote.scope.changed":
      "站点、账户或连接已变化，目标与本次发送状态已清除，文字已保留。若刚发送过，请先检查原目标文档。",
    "quicknote.target.changed":
      "原目标规则已变化或不可用，请重新选择文档。文字已保留。",
    "quicknote.target.blocked":
      "目标权限或规则已变化，此次记录已停止，文字已保留。请先检查原目标文档，结束本次尝试后重新选择文档。",
    "quicknote.error.generic": "无法完成此次请求，请检查连接或文档权限。",
    quick_note_text_invalid: "请输入非空文字；内容过长时请分成较短的记录。",
    quick_note_invalid_response:
      "返回结果与此次记录不一致，无法确认结果，文字未清除。",
    quick_note_ticket_missing:
      "此次发送已过期或服务已重新连接，无法继续确认结果。",
    quick_note_request_conflict: "同一记录的内容或目标发生冲突，已停止发送。",
    quick_note_request_already_used: "此前已处理过这次记录，请先检查目标文档。",
    quick_note_signin_changed:
      "登录状态已变化，此次发送已停止。请先检查目标文档。",
    quick_note_busy: "服务正在处理另一条记录，请稍后重试原记录。",
    selectProfile: "选择收录规则",
    extensionSettings: "插件设置",
    back: "返回",
    manageProfiles: "设置收录规则",
    profileSettingsHelp:
      "在 Doca 设置保存位置、追加或新建策略，可配置多套规则。",
    handoff: "交给 AI",
    imagesHelp: "正文与原图一起保存。AI 助手将在浏览器右侧打开。",
    saveNow: "立即收录",
    analyze: "交给 AI 分析",
    browserSource: "浏览器会话",
    defaultProfile: "默认",
    quickCapture: "收录当前页",
    quickOrganize: "AI 整理后收录",
    organizePrompt:
      "请先阅读当前附加材料，判断是否需要整理。先按所选收录方案完整保存原文和原图；适合原样保存就结束，需要整理则在刚保存的文档中优化结构，保留事实、来源和原图。需要审批时请等待我的确认。",
    pageUnavailable: "切换到要引用的网页",
    selectionReference: "已选网页内容",
    shortcutHelp: "可在浏览器扩展快捷键设置中调整",

    advancedConfig: "粘贴站点配置",
    endpoint: "Doca 服务地址",
    endpointHelp:
      "填写 Doca 根地址，不包含 /api/v1。切换后使用新站点当前登录的账户。",
    saveEndpoint: "保存地址并连接",
    clipper_invalid_origin: "请输入 HTTPS 的 Doca 根地址，本机开发可用 HTTP。",
    login: "登录或重新连接 Doca",
    clipper_login_required: "请在打开的 Doca 页面完成登录，再返回插件。",
    clipper_login_invalid: "登录交接已过期，请重新连接。",
    clipper_token_expired: "正在重新验证 Doca 登录状态，请重试。",
    capture: "网页收录",
    assistant: "AI 助手",
    connection: "连接",
    profile: "收录方案",
    page: "收录当前页面",
    selection: "收录选中区域",
    openAssistant: "打开 AI 侧边栏",
    description: "保存网页内容与原图，随时回到 Doca 继续整理。",
    loadedOnly: "收录当前已加载的内容，包括页面下方已加载的部分。",
    settings: "在 Doca 设置保存位置与策略",
    retry: "重试上次收录",
    saving: "正在保存正文与原图…",
    saved: "已保存到 Doca",
    open: "打开文档",
    connected: "已连接",
    notConnected: "连接你的 Doca",
    setup:
      "跟随当前浏览器的 Doca 登录状态。站点配置只包含地址，不包含账户凭证。",
    config: "Doca 连接配置",
    import: "连接 Doca",
    replace: "替换连接配置",
    importHelp:
      "配置只包含 Doca 地址。切换站点后使用该站点当前登录账户的收录方案。",
    paste: "粘贴 Doca 生成的完整配置",
    noProfiles: "先在 Doca 创建一个收录方案",
    model: "模型",
    prompt: "让 Doca 帮你整理资料…",
    send: "发送",
    attach: "附加当前网页或选区",
    sendHelp: "发送时附加此网页；可取消勾选。打开助手不会发送内容。",
    newChat: "新对话",
    continue: "在 Doca 继续",
    preparing: "正在准备网页材料与图片…",
    working: "正在处理…",
    stopped: "已停止",
    cancel: "停止",
    approve: "允许执行",
    reject: "拒绝",
    approval: "需要确认操作",
    emptyChat: "保持网页在眼前，交给 Doca 整理。",
    emptyChatHelp: "试试：把这篇文章整理成故障现象、原因、排查步骤和解决方案。",
    aiDisabled: "当前连接未启用 AI，请在 Doca 的连接设置中开启。",
    expired: "激活配置已过期，请在 Doca 重新生成。",
    generalError: "操作未完成，请重试。",
    account: "当前账户",
    locale: "界面语言",
    clipper_not_connected: "请先粘贴 Doca 配置完成连接。",
    clipper_invalid_config: "配置格式无效或版本不支持，原站点配置已保留。",
    clipper_activation_invalid: "激活配置已过期、已使用或已撤销，请重新生成。",
    clipper_connection_revoked:
      "连接已撤销，请在 Doca 的浏览器连接页面手动恢复。",
    clipper_page_unsupported: "此页面无法收录。已打开的普通网页请刷新后重试。",
    clipper_selection_missing: "请先在网页选择需要收录的内容。",
    clipper_image_failed: "图片读取失败，请保持原网页打开并重试。",
    clipper_image_invalid:
      "图片格式不支持、内容无效或超过 20 MiB，收录尚未完成。",
    clipper_images_missing: "仍有图片未上传，请重试，正文尚未保存。",
    clipper_conversion_warning:
      "此页面包含当前无法完整转换的内容，收录尚未完成。",
    clipper_profile_changed: "收录方案已修改，请重新选择方案后收录。",
    clipper_profile_unavailable: "收录方案不可用，请在 Doca 检查设置。",
    clipper_request_conflict: "重试内容与原任务不一致，请重新发起收录。",
    clipper_capture_expired: "未完成的收录已到期，请重新收录。",
    clipper_connection_failed: "无法连接 Doca，请检查站点和网络。",
    clipper_scope_denied: "此操作超出当前连接的授权范围。",
    clipper_assistant_disabled: "当前连接未启用 AI 助手。",
    clipper_content_too_large: "页面内容超过本次收录上限，请选择较小范围。",
    clipper_too_many_images: "页面超过 100 张图片，请选择需要的内容。",
    clipper_busy: "另一个收录正在保存，请完成后再试。",
    clipper_session_missing: "会话不可用，请开始新对话。",
    clipper_target_uninitialized:
      "目标文档尚未就绪，请在 Doca 打开一次后重试。",
  },
  en: {
    "quicknote.title": "Quick note",
    "quicknote.help":
      "Append directly to an authorized rich-text or Markdown document without AI. Text and target remain only while this view is open.",
    "quicknote.target": "Choose a document to append to",
    "quicknote.choose": "Select a document",
    "quicknote.refresh": "Refresh documents",
    "quicknote.empty":
      "No targets are available. Enable an append rule in Doca with an editable rich-text or Markdown document.",
    "quicknote.text": "Note text",
    "quicknote.placeholder": "Write the text to append…",
    "quicknote.open": "Open target document",
    "quicknote.save": "Append note",
    "quicknote.retry": "Retry the same note",
    "quicknote.reset": "End this attempt",
    "quicknote.reset.help":
      "Ending does not undo content that may already be saved. Check the target document before starting another note. This action sends nothing.",
    "quicknote.confirm.reset": "Checked the document; end this attempt",
    "quicknote.cancel.reset": "Back",
    "quicknote.reset.done":
      "This attempt has ended and the text is retained. Check the document for duplicate content before starting another note.",
    "quicknote.loading": "Loading available documents…",
    "quicknote.saving": "Appending the note. Keep this view open…",
    "quicknote.saved": "The note was appended to the document.",
    "quicknote.failed":
      "The operation did not finish. Check and retry; your text is retained.",
    "quicknote.uncertain":
      "The result is uncertain and your text is retained. Check the target document first. Retrying continues only the original note.",
    "quicknote.blocked":
      "This note has stopped and your text is retained. Check the target document first. It will not be resent automatically.",
    "quicknote.scope.changed":
      "The site, account or connection changed. The target and send state were cleared; your text is retained. If you just sent it, check the original document first.",
    "quicknote.target.changed":
      "The target rule changed or is unavailable. Choose a document again; your text is retained.",
    "quicknote.target.blocked":
      "Target permissions or its rule changed. This attempt stopped and your text is retained. Check the original document, end this attempt, then select a document again.",
    "quicknote.error.generic":
      "The request could not be completed. Check your connection or document permissions.",
    quick_note_text_invalid:
      "Enter some text. If it is too long, split it into shorter notes.",
    quick_note_invalid_response:
      "The response does not match this note. The result is unconfirmed and your text is retained.",
    quick_note_ticket_missing:
      "This send expired or the service reconnected. The result can no longer be confirmed.",
    quick_note_request_conflict:
      "This note conflicts with the original content or target. Sending has stopped.",
    quick_note_request_already_used:
      "This note was already processed. Check the target document first.",
    quick_note_signin_changed:
      "Your sign-in status changed and this send stopped. Check the target document first.",
    quick_note_busy:
      "Another note is being processed. Retry this same note later.",
    selectProfile: "Choose a capture rule",
    extensionSettings: "Extension settings",
    back: "Back",
    manageProfiles: "Manage capture rules",
    profileSettingsHelp:
      "Configure destinations and append or create strategies in Doca. Multiple rules are supported.",
    handoff: "Ask AI",
    imagesHelp:
      "Content and original images are saved together. AI opens in your browser’s sidebar.",
    saveNow: "Save now",
    analyze: "Analyze with AI",
    browserSource: "Browser conversation",
    defaultProfile: "Default",
    quickCapture: "Save current page",
    quickOrganize: "Organize with AI",
    organizePrompt:
      "Read the attached material and decide whether it needs editing. First archive the original content and images using the selected capture profile. If editing is needed, improve that saved document while preserving facts, the source and images. Wait for my confirmation when approval is required.",
    pageUnavailable: "Switch to a page to reference it",
    selectionReference: "Selected page content",
    shortcutHelp:
      "Customize these in your browser’s extension shortcut settings",

    advancedConfig: "Paste site configuration",
    endpoint: "Doca server address",
    endpointHelp:
      "Use the Doca origin without /api/v1. Sign-in follows the account on that site.",
    saveEndpoint: "Save address and connect",
    clipper_invalid_origin:
      "Enter a Doca HTTPS origin. Loopback HTTP is allowed for development.",
    login: "Sign in or reconnect to Doca",
    clipper_login_required:
      "Sign in on the Doca page, then return to the extension.",
    clipper_login_invalid: "Sign-in exchange expired. Reconnect to Doca.",
    clipper_token_expired: "Verify your Doca sign-in and retry.",
    capture: "Web capture",
    assistant: "AI assistant",
    connection: "Connection",
    profile: "Capture profile",
    page: "Save entire page",
    selection: "Save selection",
    openAssistant: "Open AI sidebar",
    description:
      "Save page content and original images, then continue in Doca.",
    loadedOnly:
      "Captures loaded content, including loaded sections below the viewport.",
    settings: "Manage destinations and strategies in Doca",
    retry: "Retry previous capture",
    saving: "Saving content and original images…",
    saved: "Saved to Doca",
    open: "Open document",
    connected: "Connected",
    notConnected: "Connect your Doca",
    setup:
      "Uses this browser’s Doca sign-in. Download a site-configured extension or paste a site address configuration.",
    config: "Doca connection configuration",
    import: "Connect Doca",
    replace: "Replace connection",
    importHelp:
      "The configuration contains only a Doca address. Sign-in and capture profiles follow the account used on that site.",
    paste: "Paste the complete configuration generated by Doca",
    noProfiles: "Create a capture profile in Doca first",
    model: "Model",
    prompt: "Ask Doca to organize your material…",
    send: "Send",
    attach: "Attach current page or selection",
    sendHelp:
      "This page is attached when you send. Uncheck to exclude it. Opening the assistant sends nothing.",
    newChat: "New conversation",
    continue: "Continue in Doca",
    preparing: "Preparing page material and images…",
    working: "Working…",
    stopped: "Stopped",
    cancel: "Stop",
    approve: "Allow",
    reject: "Reject",
    approval: "Confirm operation",
    emptyChat: "Keep your page in view. Let Doca organize it.",
    emptyChatHelp:
      "Try: organize this article into symptoms, causes, diagnostic steps and solutions.",
    aiDisabled:
      "AI is disabled for this connection. Enable it in Doca’s connection settings.",
    expired:
      "The activation has expired. Generate a new configuration in Doca.",
    generalError: "The operation did not complete. Please retry.",
    account: "Current account",
    locale: "Language",
    clipper_not_connected: "Paste a Doca configuration to connect.",
    clipper_invalid_config:
      "Invalid or unsupported configuration. Your current site was kept.",
    clipper_activation_invalid:
      "Activation expired, used or revoked. Generate a new configuration.",
    clipper_connection_revoked:
      "Connection revoked. Restore this connection explicitly in Doca.",
    clipper_page_unsupported:
      "This page cannot be captured. Refresh an ordinary web page and retry.",
    clipper_selection_missing: "Select content on the page first.",
    clipper_image_failed:
      "An image could not be read. Keep the source page open and retry.",
    clipper_image_invalid:
      "An image is unsupported, invalid or over 20 MiB. Capture is incomplete.",
    clipper_images_missing:
      "Some images have not uploaded. Retry; content has not been saved.",
    clipper_conversion_warning:
      "Some page content cannot be converted completely. Capture is incomplete.",
    clipper_profile_changed:
      "The capture profile changed. Select it again and restart.",
    clipper_profile_unavailable:
      "The capture profile is unavailable. Check Doca settings.",
    clipper_request_conflict:
      "Retry differs from the original task. Start a new capture.",
    clipper_capture_expired: "The unfinished capture expired. Start again.",
    clipper_connection_failed:
      "Doca is unreachable. Check your site and network.",
    clipper_scope_denied:
      "This operation is outside the connection’s authorization.",
    clipper_assistant_disabled: "AI is disabled for this connection.",
    clipper_content_too_large:
      "Content exceeds the capture limit. Select a smaller portion.",
    clipper_too_many_images:
      "Page contains over 100 images. Select the content you need.",
    clipper_busy: "Another capture is saving. Wait for it to finish.",
    clipper_session_missing:
      "Conversation unavailable. Start a new conversation.",
    clipper_target_uninitialized:
      "Open the target document in Doca once and retry.",
  },
};
export const translate = (locale, key) =>
  messages[locale]?.[key] || messages.en[key] || key;
