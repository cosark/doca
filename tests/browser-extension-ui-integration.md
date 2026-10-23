# 浏览器扩展与共用 AIChat 接入约定（2026-10-23）

扩展本地构建并挂载网站的同一个 `AIChat`。当前用户已确定：网页右侧常驻「收录当前页面 / 收录选中区域 / Doca 助手 / 设置」四个图标，整组支持上下拖动并保存位置；点击收录后在气泡确认方案，选中文字不再额外出现浮层。设置打开独立扩展页，包含方案管理入口及后台地址。浏览器 popup 保留原收录入口；聊天只挂在浏览器 sidePanel，不在 popup 重复嵌入。

- AI 负责人维护共享 UI/runtime、pending runner、`browser-assistant-entry.tsx` 和受限 assistant 路由；扩展负责人维护 `apps/browser-extension/**`、ZIP 打包及真实 MV3 验收。
- Vite 入口为 `apps/web/src/features/ai/browser-assistant-entry.tsx`，输出本地 `generated/assistant.js`、CSS、chunks/assets，全部加入 MV3 ZIP，不加载远程脚本。
- 实际导出 `mountBrowserAssistant(element, config)`，返回 `update(config)`、`compose(text)`、`unmount()`。`compose` 只填充并聚焦共用 Sender，不发送请求；未完成挂载时在本次内存中等待。账号/连接/方案版本变化会重新挂载边界。
- `config` 为 `{ userId, connectionId, origin, sessionId, profile: { id, revision, name }, page: { title, url }, locale?: "zh" | "en", request, captureCurrentPage, onSessionChange, openDoca? }`。
- `request(path, method?, body?, signal?)` 使用共享 `/ai/...` 词汇，由 background 严格映射到 `/browser-clipper/assistant/ui/...`。Bearer、短凭证续期和登录/撤销归 background；UI 不接裸令牌，不使用网站 cookie API 或 iframe。
- 当前 UI 端点包含 options、sessions（支持 `profileId` 列表过滤）、session detail（`page` 或只读 `pendingId`）、create session、messages、job cancel/approval。session detail 另返回权威 `browserProfile: { id, revision }`。普通网站继续使用原 `/ai` 路径和 EventSource。
- 每次真正发送前先读取 session detail，核对其当前方案 ID/版本与选中方案；不匹配、凭证失效或缺失绑定都在 capture 前拒绝。`captureCurrentPage()` 返回 `{ captureRequestId, title, url }`。同一消息 ID 的并发发送/本次内存重试复用一个 Promise。page/locale 更新保留此映射；连接/方案边界变化清空本次组件状态。
- `pendingId` 只读核对会查该 ID 的已接收 job 和原 user message，覆盖最近 30 jobs / 24 messages 之外的情况。已接收且内容一致便结束本地重放，不重 capture、不再次 POST；内容不一致或无法证明则保留队列项并提示检查/撤回。embedded runner 只自动处理当前打开 session，切换后保留其他队列，切回原会话且匹配原方案才能继续。
- 立即发送同样先将完整原 ID / 正文 / 远程附件 / 引用写入现有 pending 队列并读回验证，才清输入；写入失败保留原输入。createSession 前用现有 `draft` 队列，重开后由用户对原项点“立即发送”继续，不能先恢复 composer 再换新 ID。该格式没有 draft 的 profileId，因此只显式移动当前原项，不将其他历史 draft 自动赋予当前方案。网站未上传完的本地附件在完整远程快照准备好前保留 composer，不生成缺附件的自动重放项。主发送与 runner 共用内存 hold / navigator lock；后续新草稿不会被旧项继续操作清空。
- 其他方案的历史仍可在相应选择下查看；服务器所有浏览器读、事件、计数及操作以 `binding.job_ids` 为限。模型只读绑定的原始历史，不读取或改写混合网站续聊的共享摘要，不重放旧 promptContext。普通网站能继续原会话，历史不会删改。
- 快速收录首页、常驻工具条与规则确认气泡由扩展提供；模型、消息、Markdown、进度、审批和输入器使用共享 AIChat。扩展权限外的资源选择、上传、个人设置及资产下载控件不会在共享视图发起网站请求；文档链接打开配置的 Doca origin。
- 对话列表只显示正在发送、失败及已接收消息；待发送列表只显示尚在等待的消息。同一消息不同时出现在两处。此调整仅改变视图投影，不删除 IndexedDB 恢复副本、不调整原发送和接收核对协议。工具条位置使用独立的本机 `dockPosition` 数值偏好，不迁移原配置或队列。
- 现有 extension session storage 的 `{ origin, connectionId, profileId, id }` 与 pending queue keys/shapes 保留，不新增 DB、持久字段、兼容 reader 或数据迁移。多方案保留且有一个默认方案。

实际 MV3 布局、键盘、账号/方案切换、续期/撤销与三次最终浏览器验收由扩展会话维护。应用工具限制下不绕过授权通道跨会话发消息；此文件提供共享工作区可审查的当前接口。
