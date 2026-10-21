# 浏览器助手：跟随网站登录验收（2026-10-21）

按用户明确批准，在首次上线前替换 v1 激活包 / 180 天 token。当前实现采用公开 v2 站点配置、Doca 同源登录页、60 秒单次授权码 + SHA-256 verifier、绑定确切网站会话的 10 分钟受限凭证。支持插件直接编辑服务地址、自动重新验证、退出失效，以及撤销后显式恢复。当前使用方式见[浏览器助手](../../browser-assistant.zh-CN.md)。

所有测试使用合成账户、隔离数据库和临时存储，没有使用用户文档。每轮浏览器创建独立扩展安装目录和 Chromium 用户目录，结束后销毁临时凭证和文件。原先的 [v1 验收](../browser-clipper-2026-10-21/README.md)仅作设计历史。

## 测试结果

| 检查 | 结果 |
| --- | --- |
| 全量回归 | 本轮 304 个文件通过、3 个跳过；3073 项通过、10 项跳过。见 [full-tests.txt](full-tests.txt)。随后新增的 v1 保留用例由下方最终回归另行覆盖 |
| 功能 / 语言 | 7 个文件、57 项通过，见 [feature-tests.txt](feature-tests.txt) |
| 最终认证回归 | 新增预上线数据保留、Cookie 限制下轮询缓存等后，3 个文件 16 项通过，见 [final-regression.txt](final-regression.txt) |
| PostgreSQL 17 / 18 | 收录、AI、会话和结构用例各 18 项通过：[17](postgres-17.txt)、[18](postgres-18.txt)；新增结构保留用例各 4 项通过：[17](schema-postgres-17.txt)、[18](schema-postgres-18.txt) |
| 类型 / 构建 | TypeScript 无诊断；Web 与 Canvas renderer 生产构建成功。现有 Vite 大包提示保留 |
| 真扩展连续复跑 | Linux Chromium 154.0.8037.92 最终连续 3 轮通过，页内错误为 0：[汇总](browser-repeated-summary.json)、[1](browser-run-1.json)、[2](browser-run-2.json)、[3](browser-run-3.json) |
| 原图 / 内容回读 | 每轮 3 次收录完成，3 张图片保存字节与来源 PNG 相同；追加保留原文且实时广播，撤销保留文档，AI 作业 completed：[1](server-run-1.json)、[2](server-run-2.json)、[3](server-run-3.json) |
| 正式旧版升级 | 正式 `smartdoca/doca:0.2.6` 创建的 SQLite / PostgreSQL 17 / 18 数据升级后，原 124 张表摘要不变，七张新增表为空，代际不变；各并发启动 3 次通过：[汇总](released-upgrade-summary.json)、[SQLite](sqlite-released-upgrade.json)、[PG17](pg17-released-upgrade.json)、[PG18](pg18-released-upgrade.json) |

## 实际浏览器流程

真实加载 Doca 下载的扩展 ZIP，确认包内只包含站点地址。浏览器最初未登录，打开插件后进入 Doca 正常登录页面，输入合成账户后自动返回，选区工具栏图文保存和整页收录均成功。追加内容同时进入两个已打开的 Markdown 编辑窗口，epoch 与原文保留。

AI 扩展页面调用真实宿主 runner、会话、模型选择和计量流程，等待模拟模型回复；宿主数据库再次确认作业完成。将客户端短期授权时间置为过期后，已有网站登录会话自动重新授权，无需输入密码，旧 token 失效。

网站退出后插件变为未登录。重新登录同一安装恢复原连接；再切换到第二个账户，确认原账户草稿不出现、连接 ID 不同、个人方案不外泄；切回原账户恢复原草稿。插件地址输入拒绝 `/api/v1` 路径并保留原配置，输入根地址后连接成功。未知版本配置保留原站点。Doca 页面撤销全部当前账户连接后，授权请求拒绝，不会自动新建连接绕过撤销，原文档继续存在。

## 自动边界与数据保留

- 授权码仅消费一次，错误 verifier、过期授权码、无网站登录、错误网站 Cookie、停用账户拒绝。token 仅限专用命名空间，不作为普通网站 / 手机 / MCP 凭证。
- 会话退出使既有 token 失效，并取消进行中的浏览器 AI 作业；同一对话的网站普通任务不被插件撤销影响。跨宿主执行通过心跳及操作边界复查。
- 撤销安装后，再次网站登录也不自动恢复；网站显式恢复后才能重新换取凭证。
- 同一网站会话自动续期复用连接，另一个账户使用独立安装绑定。草稿按站点和连接保留；消息重试复用冻结请求，不重新读取新活动页。
- 消息来源限定当前扩展和确切的 Doca 登录标签页、origin、state、期限；其他页面或标签页伪造回调被拒绝。
- Cookie 限制环境通过顶层同源页面验证；被动轮询仅缓存 30 秒内的证明，避免无限弹出授权页，用户写操作重新验证。
- 新表从空开始；独立用例保留预上线 v1 连接行及哈希，增加空会话表后旧凭证仍拒绝。未知表、丢失已安装字段/表等差异停止启动，不产生部分新增。没有删表、清空用户数据或迁移旧凭证。

## 截图与范围

[插件收录](screenshots/extension-capture.png)、[服务地址编辑](screenshots/extension-connection.png)、[AI 对话](screenshots/extension-assistant.png)、[收录方案](screenshots/doca-profiles.png)、[连接管理](screenshots/doca-connections.png)、[窄屏](screenshots/doca-connections-narrow.png)、[选区工具栏](screenshots/selection-toolbar.png)、[追加文档](screenshots/append-live-document.png)。截图已实际查看。

沿用 Doca 现有视觉，前轮独立[界面评审](../browser-clipper-2026-10-21/visual-review.md)提出的页签选中态、重复文案和 AI 字段标签问题已修正。本轮局部流程自检，未另行打分；未提供完整动态录屏，不声称动态视觉通过。720px 既有账户侧栏长标签存在孤字换行。

未验证品牌 Chrome / Edge 的人工安装与原生侧栏界面、企业 SSO / 代理 / 隐私策略矩阵、真实模型供应商和真实站点登录图片矩阵。AI 使用模拟模型，无付费供应商调用。整页不包含未加载数据、iframe、关闭的 Shadow DOM、虚拟列表、SVG、画布或视频完整归档。

## 复现与发布

`tests/browser-clipper*.test.ts`、`tests/browser-assistant.test.ts`、`tests/browser-extension*.test.ts` 覆盖认证与收录，`DOCA_TEST_POSTGRES` 指向专用测试库时每用例使用独立 schema。浏览器脚本为 `scripts/qa-browser-clipper.mts` / `scripts/qa-browser-clipper-browser.mjs`，使用隔离内存数据库、39474/39475 空闲端口，以及缓存的正式 0.2.6 镜像中的 Chromium 运行当前源码。正式升级脚本为 `scripts/qa-browser-clipper-released.mjs`，使用专用 PG17/18 容器和新建的 `clipper_login_released_upgrade` 库，不接受用户数据库 URL、不覆盖已有库。

当前功能纳入 0.2.7 发布准备；最终镜像、GitHub 和 Docker Hub 结果以[发行验证](../release-0.2.7/README.md)为准。该记录不宣称已经部署用户服务器。
