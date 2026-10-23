# 浏览器助手视觉核对

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

当前归档为 Doca0.2.8 / 扩展0.2.0 / Canvas0.5.12 的第3轮实际截图，共38张，来自macOS Chrome for Testing151.0.7922.34、隔离临时profile、headless及直连localhost。失败图片和校准图片未混入成功目录。

首页保留蓝色整页/选区收录、紫色AI及右上设置，三个动作下新增可展开的快速记录。目标必须明确选择；文字、链接、追加按钮及停止/结束确认均由真实界面生成。

- 收录首页（本地产物：`browser-extension/screenshots/extension-popup-home.png`）、设置（本地产物：`browser-extension/screenshots/extension-connection.png`）。
- AI助手（本地产物：`browser-extension/screenshots/extension-assistant.png`）、300px（本地产物：`browser-extension/screenshots/extension-assistant-narrow.png`）、200%（本地产物：`browser-extension/screenshots/extension-assistant-200.png`）、审批（本地产物：`browser-extension/screenshots/extension-assistant-approval.png`）。
- 选区图标（本地产物：`browser-extension/screenshots/selection-collapsed.png`）、工具条（本地产物：`browser-extension/screenshots/selection-expanded.png`）、规则下拉（本地产物：`browser-extension/screenshots/selection-dropdown.png`）。
- 富文本追加及后来草稿（本地产物：`browser-extension/screenshots/quick-note-rich-text-saved.png`）、Markdown追加（本地产物：`browser-extension/screenshots/quick-note-markdown-saved.png`）、重开为空（本地产物：`browser-extension/screenshots/quick-note-popup-reopened.png`）。
- 发送状态丢失留稿（本地产物：`browser-extension/screenshots/quick-note-ticket-missing.png`）、其结束确认（本地产物：`browser-extension/screenshots/quick-note-ticket-missing-confirmation.png`）、目标规则停用留稿（本地产物：`browser-extension/screenshots/quick-note-target-withdrawn.png`）、其结束确认（本地产物：`browser-extension/screenshots/quick-note-target-withdrawn-confirmation.png`）。
- 渲染窗口恢复（本地产物：`browser-extension/screenshots/early-paint-resumed.png`）、创建会话窗口恢复（本地产物：`browser-extension/screenshots/early-create-session-resumed.png`）、页面准备窗口恢复（本地产物：`browser-extension/screenshots/early-prepare-page-resumed.png`）。

原有9帧动效采样仍来自应用实际CSS动画的开始/中间/结束状态，没有替换模拟动画；稳定截图取完成态，应用保留reduced-motion分支。

独立评审已逐张复核第3轮20张核心截图（原13张及7张速记图），未发现视觉阻断。300px及200%控件完整，审批标题/位置无占位符，三类恢复草稿及Markdown渲染清楚；速记成功/停止/原目标链接和底部确认均完整可读，无重叠。见静态复核及图片指纹（本地产物：`browser-extension/visual-review.json`）。静态画面不证明交互、持久化或OS路由；这些结果见[三轮收据](browser-extension.md)。headless真实执行sidePanel API，但没有可检查的原生面板target，共用AI以相同URL/hash的扩展标签页检查。历史截图与当时结论见此前IDB与授权基线（本地记录：`artifacts/verification/issue-tracker-2026-10-21/browser-extension/idb-auth-baseline/README.md`）。
