> 历史验收：本文记录上线前的 v1 激活方案。当前登录机制已由[网站会话方案](../browser-clipper-login-2026-10-21/README.md)替换，安装请使用[最新说明](../../browser-assistant.zh-CN.md)。

# 浏览器助手首版验收（2026-10-21）

实现已完成；未发布商店扩展、未部署到用户服务器。使用方式见[浏览器助手](../../browser-assistant.zh-CN.md)，待发布说明见[release-notes.md](release-notes.md)。

本次全部数据来自合成账户、隔离 SQLite / PostgreSQL 库及临时文件存储，没有使用用户文档。浏览器每轮使用新的扩展安装目录、一次性激活配置和 Chromium 用户目录，结束后销毁凭证和临时存储。

## 结果

| 检查 | 结果与证据 |
| --- | --- |
| 全量回归 | 303 个文件通过、3 个跳过；3060 项通过、10 项跳过。该轮尚未收录随后新增的 5 项后台边界测试，后者另行全部通过。见 [full-tests.txt](full-tests.txt) |
| 最终功能回归 | 6 个文件、23 项通过：收录/图片/追加、凭证与撤销、数据库增量、AI 边界、DOM 提取、扩展后台消息与重试、包许可。见 [feature-tests.txt](feature-tests.txt) |
| PostgreSQL 17 / 18 | 各 14 项通过，覆盖收录、追加、原图、凭证撤销、AI 和增量协调。见 [17](postgres-17.txt)、[18](postgres-18.txt) |
| 类型、构建、语言 | TypeScript 无诊断；Web 生产构建成功（原有大包提示仍存在）；语言测试 30 项通过；扩展 JS 语法检查与 diff 空白检查通过。见 [typecheck.txt](typecheck.txt)、[web-build.txt](web-build.txt)、[i18n.txt](i18n.txt) |
| 实际扩展连续复跑 | 最终版本连续 3 轮通过，页内错误为 0。见 [汇总](browser-repeated-summary.json)、[第 1 轮](browser-run-1.json)、[第 2 轮](browser-run-2.json)、[第 3 轮](browser-run-3.json) |
| 服务端结果回读 | 每轮 3 次收录完成；3 张保存图片逐字节与来源 PNG 一致；追加保留原文；撤销后文档仍存在；AI 作业实际完成。见 [第 1 轮](server-run-1.json)、[第 2 轮](server-run-2.json)、[第 3 轮](server-run-3.json) |
| 正式旧版升级 | 正式 `smartdoca/doca:0.2.6` 创建的 SQLite / PostgreSQL 17 / 18 数据由当前源码升级。原有 124 张表的行摘要一致，五张新表为空，代际不变；之后每种引擎并发启动 3 次均通过。见 [汇总](released-upgrade-summary.json)、[SQLite](sqlite-released-upgrade.json)、[PG17](pg17-released-upgrade.json)、[PG18](pg18-released-upgrade.json) |

正式镜像标识：`smartdoca/doca@sha256:3d9ee2e114ac1d5d52fdbf5f76aa7cc1758e1935742ad1dcbb0d31ffa6e44860`。旧镜像仅用于创建旧数据以及提供隔离浏览器运行环境；扩展、Web 和服务端均来自当前工作树。

## 实际浏览器操作

Linux Chromium 154.0.8037.92 实际加载从 Doca 下载并解压的 Manifest V3 扩展，自动激活并显示账户。通过真实鼠标操作触发闭合 Shadow DOM 的选区工具栏并保存图文，随后收录整页，在两个打开的 Markdown 编辑窗口中观察同一追加增量。

AI 扩展页面走宿主真实 runner、模型选择与会话接口，等待模拟模型回复；宿主数据库再次确认作业 completed。模型服务使用 `tests/ai-mock.ts`，不包含付费供应商调用。这里验证的是扩展页面与侧栏共用的会话界面；未单独证明品牌浏览器原生侧栏的打开与布局行为。

Doca 页面生成替换配置，在扩展表单中先导入未知版本，确认原连接继续可用；再粘贴有效配置激活，确认旧密钥返回 401。最后通过 Doca 撤销全部连接，确认扩展断开、旧 token 拒绝收录；刷新已追加的文档仍能读取原文和新增内容。

## 自动测试覆盖

- 原图上传字节、MIME/尺寸限制、缺图原子拒绝、结构化表格与图片导入、相同请求只保存一次。
- 富文本及 Markdown 追加保留原文和 epoch，多次/并发收录不相互覆盖，提交后通过现有协同广播更新。
- 方案 revision 变化拒绝旧准备请求；已接受任务使用冻结快照，提交时重新检查连接、目标和权限。
- 单次激活、密钥轮换、一个/全部撤销、作废未使用配置、禁止 Cookie 顶替、限制专用 API、来源检查、停用账户。
- 撤销浏览器 AI 作业不删除会话，也不取消同一会话中随后由网站发起的普通作业。作业执行、工具边界、审批/取消都重新校验当前授权。
- 真实宿主 AI runner 的受限工具目录、分页材料读取、越范围资源读取拒绝、计量记录、执行中撤销；未启用 AI 的连接拒绝助手入口。
- 后台区分扩展标签页和网页消息；未知配置保留原凭证及材料；切换站点后拒绝旧任务投递；方案消失时拒绝替换为默认；消息重试复用冻结请求，不再读取或上传新活动页。
- 新表从空开始、原用户和配置保留；重复/并发启动；未知表或已安装表丢失时拒绝，且没有部分新增写入。

## 截图与界面评审

[选区工具栏](screenshots/selection-toolbar.png)、[扩展收录](screenshots/extension-capture.png)、[AI 对话](screenshots/extension-assistant.png)、[收录方案](screenshots/doca-profiles.png)、[连接管理](screenshots/doca-connections.png)、[720px 连接管理](screenshots/doca-connections-narrow.png)、[追加后实时文档](screenshots/append-live-document.png)。独立只读视觉评审及剩余限制见 [visual-review.md](visual-review.md)。

最终截图已实际查看。动态未提供完整录屏，未作动态视觉通过结论。720px 既有账户导航的长标题存在孤字换行；本功能区未见遮挡或横向溢出。

## 复现

```sh
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/vitest/vitest.mjs run tests/browser-clipper.test.ts tests/browser-clipper-schema.test.ts tests/browser-assistant.test.ts tests/browser-extension-capture.test.ts tests/browser-extension-background.test.ts tests/package-licensing.test.ts --maxWorkers=2
```

为 PostgreSQL 17 / 18 分别设置专用 `DOCA_TEST_POSTGRES` 再运行前三个数据库相关文件。测试助手为每个用例创建隔离 schema；不要指向用户业务库。

浏览器验收脚本 `scripts/qa-browser-clipper.mts` 创建内存数据库与临时存储，使用 `scripts/qa-browser-clipper-browser.mjs` 驱动隔离 Docker Chromium。先将当前 Web 构建到 `.local/browser-clipper-qa/web`，脚本使用空闲端口 39474/39475，以及本地缓存的上述正式镜像。执行三次，每轮须 exit 0，分别保存两份 JSON 回读报告。

正式旧版升级脚本是 `scripts/qa-browser-clipper-released.mjs` / `scripts/qa-browser-clipper-upgrade.mjs`。前者仅使用固定名称 `doca-clipper-qa-pg17/18` 的专用容器，在新建的 `clipper_released_upgrade` 库和 `.local/browser-clipper-release-*` 空目录生成测试数据；已存在的库会拒绝重复创建，不覆盖旧数据。不要将脚本改指向业务库。保留的摘要排除唯一预期变化的 `schema_baseline.structure_json` 安装足迹，其他原行、正文状态和代际参与比较。

CI 数据库工作流已加入浏览器相关触发路径和 PostgreSQL 17/18 测试。五张新增表的来源、保存和恢复边界见[数据库升级约定](../../database-schema-evolution.zh-CN.md)。

## 明确未验证或未交付

- Chrome / Edge 品牌浏览器的人工安装及原生侧栏打开验收、企业签名分发、扩展商店发布、Firefox。
- 实际模型供应商、企业 SSO / 代理、真实站点的防盗链图片与登录图片矩阵。
- 任意网页的视觉复刻、未加载数据、iframe、关闭的 Shadow DOM、虚拟列表、SVG、画布和视频完整归档。
- 知识库内「设为收录位置」快捷入口；当前统一在个人设置选择位置。
- 动态视觉录屏、服务器部署以及旧二进制降级。降级需另外审阅数据保全方案，不删除新表或用户数据。
