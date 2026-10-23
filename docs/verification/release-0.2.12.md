# Doca 0.2.12 发布验收

2026-10-23，本次修复浏览器助手导航后抓取脚本尚未响应导致的 `clipper_page_unsupported`。宿主版本为 0.2.12，浏览器扩展版本为 0.2.1。

## 修复与定向验证

抓取只访问当前 HTTP(S) 标签页顶层框架。没有接收器时注入扩展自带的 `capture.js`、`select.js`、`content.js`，立即执行并重试一次；明确的选区错误不触发补载，受限页面和拒绝注入仍失败。内容脚本防止重复注册工具栏及消息监听器。

141 项相关测试通过，覆盖脚本缺失、空响应、注入拒绝、重试次数、重复注入、当前标签页/页内路由、助手传输及服务器打包；下载包断言包含 `scripting` 权限。修复阶段 TypeScript 和扩展构建通过。

复用脚本 `node tests/qa-browser-extension-navigation.mjs` 在隔离 Chromium MV3、合成站点及独立浏览器存储中验证：先在第一页发送，再导航到阻塞解析、尚无接收器的第二页；在 `document_idle` 前补载并发送，随后页内路由发送、切换另一标签页抓取。三条消息使用同一会话、每条提交一次，网页没有重载。旧版 background 在同一场景返回与用户截图相同的 `clipper_page_unsupported`；修复版通过。该用例验证实际扩展消息传输和抓取脚本，不调用真实模型，不代替完整对话界面验收。

## 发布检查

正式 GitHub Release、双架构 Docker Hub 镜像与公开附件的结果将在发布完成后记录，当前不将尚未完成的检查记为通过。原始报告、日志、归档、测试浏览器存储及截图均位于忽略目录 `artifacts/verification/release-0.2.12/` 和 `artifacts/verification/browser-extension-navigation/`。

本次没有数据库结构或数据格式变化，不转换、删除或回填已有数据，不发布 npm SDK。生产站点尚未部署。用户需要下载并重新加载扩展 0.2.1 才能使用本次修复。
