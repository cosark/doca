# 浏览器助手当前接入验收（2026-10-22）

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

当前候选为 **Doca 0.2.8 / 浏览器扩展 0.2.0 / Canvas 0.5.12**。首页收录、共用 AI、已批准的 IndexedDB 队列、当前 v2 授权及新增速记，已使用同一冻结源码、生成资源和测试脚本，**连续完成三轮真实 MV3 验收**。12文件244项针对性测试、全 TypeScript 检查和扩展构建通过。源码与生成资源汇总 SHA-256 为 `615ec4139fe4a2b27d056636a8ba55748259ec9cb37414c946e1642a084f8e59`。

负责人会话：`01a159e9-05a8-76a2-986b-e6ba38821b17`。本工作区由主协调会话统一提交与发布，本子任务不提交、不推送、不发布镜像。

此前布局验收、当时的针对性测试和三轮收据均保留在此前布局基线（本地记录：`artifacts/verification/issue-tracker-2026-10-21/browser-extension/previous-layout-baseline/README.md`），其机器摘要（本地产物：`browser-extension/previous-layout-baseline/summary.json`）及源码指纹只描述历史版本，不能覆盖当前 IDB 候选。

## 当前实现

- popup 首页先选收录规则，再执行「收录当前页面 / 收录选中区域 / 交给 AI」。右上角设置提供规则入口、后台地址、配置替换和语言；保留多规则及一个默认规则，不合并或转换历史规则。
- 「交给 AI」通过真实 `chrome.sidePanel.setOptions/open` 打开右侧面板，传递所选规则及 revision。popup 不加载 React AI，也不在打开时调用模型。sidePanel 本地打包并挂载网站相同的 `AIChat`，复用 Markdown、模型、进度、审批、输入器及历史；发送时默认读取当前页面，没有附加页面复选框。
- 网站登录/注销、连接撤销、短凭证续期、原图保存及配置端点仍使用现有 v2 授权契约。服务端表和收录 receipt 的冻结格式不变；浏览器 AI 待发送队列使用下述已获明确同意的 IDB 方案，不再采用旧 localStorage 整表写入器。
- 私有账户导航按 MCP 后插入浏览器助手，图标按同一栅格对齐；平台规则/连接页上方一直显示已配置扩展下载。

问题表对应关系：

| 行 | 当前决定及验收内容 |
| --- | --- |
| 45 | 浏览器助手入口位于 MCP 后，图标对齐。 |
| 49 | 下载入口一直突出显示；平台管理收录规则并查看连接。 |
| 50 | 用户后续决定为首页选规则及三个动作，AI 在右侧打开；保留多规则和一个默认规则。原表中的「点开就是 AI」「只有一套方案」已被取代，不做旧数据合并。 |
| 51 | 选区右下只显示可关闭的 Doca 图标，点击展开规则与动作；下拉支持键盘操作。快捷键验证范围见限制。 |

## 扩展速记

首页三个收录动作下新增可展开的「快速记录」。用户明确选择一个当前启用追加规则已经授权的富文本或 Markdown 文档，输入纯文字后直接追加，不调用 AI、不读取网页、不上传图片、不改收录规则。不会自动选择第一篇或默认规则目标。原有正文、原生 epoch 与历史保留；Markdown 使用普通源码并遵循当前编辑器的渲染行为。

目标、文字、原请求 ID 与发送状态只在当前 UI 实例内存。关闭再打开为空；切换站点、账户或连接时清除绑定、保留当前文字并提示，迟到的列表、准备或成功结果不能恢复旧目标或清除新草稿。仅完整匹配当前请求、目标和原生回执的成功响应可清除已发送文字，后来输入的新文字保留。

写入分为既有 v2 凭证下的专用 prepare/commit；后台只开放三个固定速记路径给扩展 UI，网页内容脚本不得调用，不增加通用资源权限。提交结果不明只允许用户重试同一请求与票据；凭证、规则、权限变化或票据缺失/过期时停止并保留文字及目标链接，不自动换 ID 或重新准备。结束本次尝试需明确操作，界面说明应先核对文档。没有浏览器存储写入或新持久格式。

[速记扩展验收](browser-extension-quick-note.md)与[后端契约](../../browser-quick-note.md)记录了目标授权、严格响应校验、进程内票据及故障边界；[后端双页验收](browser-quick-note.md)独立保留，不代替本页的已安装扩展结果。

## 已批准的待发送队列与刷新恢复

[AI pending IDB 升级、数据保留与回滚契约](ai-pending-idb.md)记录了用户明确批准的方案。新发送使用 `doca-ai-pending` 数据库 version 1、`entries` 对象存储及严格 `recordVersion: 1`。作用域使用目标 Doca 的 canonical HTTP(S) origin、真实账户 ID 和实际扩展 connectionId，记录还保留明确的 profile ID/revision 与原 messageId，不能把其他规则的消息重新绑定到当前规则。

完整消息先在短 IDB 事务中提交，待 `transaction.oncomplete` 才消费输入器。会话绑定、接受及撤回均条件更新当前记录；接受后保留 `accepted` 墓碑及 `serverJobId`，不自动清除。旧 `doca.ai.pending-send.<user>` 原文只读保留，已识别旧项通过单独的显式继续/撤回界面处理，不自动迁移、合并、排空或作为 IDB 失败的 fallback。未知版本、异常结构或存储失败保留原数据并拒绝发送。升级与回滚须先停止发送并关闭所有旧页面和扩展；旧、新发送器同时运行不在支持范围内，具体边界见批准契约。

共享 UI 的隔离验证已覆盖三个发送前窗口及丢响应恢复（本地产物：`ai-pending-refresh/results.json`）。打包扩展的正式 MV3 三轮均验证了以下断言：

- 在渲染等待、创建 session 前、`assistantPreparePage` 前刷新，严格只读探针核对同一原 messageId、完整 payload/hash、profile/revision 和 session 绑定；恢复后保留后来输入的新草稿，每项只产生一个成功消息 POST、一个成功页面准备及一个服务器 job。
- 刷新先打开另一规则，原 pending 不显示、不投递，回到原规则才恢复。未绑定 session 的草稿显式点击「立即发送」；已绑定当前 session 的 pending 按批准契约自动 drain，不额外发明恢复条件。
- POST 已接受但 UI 丢失响应时，刷新后通过精确 `pendingId` 只读对账将原 pending 转为 accepted 墓碑，核对 `serverJobId` 与原 ID；不新增捕获尝试、页面准备或消息 POST，不重复创建任务。
- 探针先用 `indexedDB.databases()` 确认库存在且 version 1，再 open version 1，使用 `entries` readonly 事务及 `[canonicalOrigin, rawUserId, actualConnectionId]` 的 scope 索引。库不存在只等待，不创建；意外升级立即 abort。旧 localStorage 原文前后逐字节一致，不借探针改写存储。

原先普通立即 Send 的 POST 前丢稿问题已由获批 IDB 事务方案修复，不再列作当前开放问题。共享 UI 的隔离收据与本轮 MV3 收据分别保留，前者不代替打包扩展的实际结果。

## 已完成的集成修复

### 空会话 SQL 500

此前真实 MV3 发现，新建但尚无 job 的会话 GET detail 返回500，后续成功回复仍留下错误 Alert。空授权集合使用 `eb.val(false)` 时，真实 Kysely/SQLite 产生不支持的布尔绑定。四处改为同语义的 `eb.or([])`：`services/ai/conversation.ts` 两处，`routes/browser-assistant.ts` UI 列表及原 base 详情各一处。隔离真实 SQLite 回归同时包含外部范围消息，断言新空会话 base/UI/list 均200且不泄露外部数据；没有表、字段或持久格式变化。共享文件其余改动仍由 AI 负责人维护并交主协调审查。

### 冻结审批描述与规则授权边界

`createBrowserClipper.describeCapture` 是内部只读描述，复用原严格 v1 冻结 snapshot 的 `usable` 校验、同一标题计算和目标权限。`browser_capture` 按实际提交描述补齐现有 `create_documents` 所需 path/items/formats，显示冻结标题及故障知识库位置，消除 `{items}` 占位符。completed receipt 仍走原 commit 幂等结果，不解析已清空 payload，也不再申请重复创建审批。回归覆盖冻结 create/append、live 规则编辑、只读/越权、标题限制及 completed 重试无重复文档；未迁移历史审批或改变直接 commit 的冻结重试语义。

background 不复用旧/缺 revision 的选区，保留原 pending 并报规则已变化。UI submit、material read、capture（含 completed）均严格核对 snapshot ID/revision 与 session binding，不匹配则拒绝，不创建任务或审批、不暴露材料。共用原 strict v1 parser，没有旧格式默认值、自动转换或清除历史。

### 登录、令牌轮换与外壳刷新

登录桥单独在 `document_start` 安装监听，其他内容脚本保持 `document_idle`，防止网页先发送一次授权结果而监听尚不存在。[Chrome 官方注入时序](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)说明前者在页面脚本之前执行。授权 tab 先建 about:blank、持久化原 flow.tabId，再导航授权 URL；静默验证期间出现显式登录会在内存中提升本次 interactive 意图，避免自动探测关闭人类登录页，后续新探测仍非交互。协议、PKCE、来源/state/tab 校验和既有存储形状不变；真实 Chromium fixture 以首段 inline 回调验证桥的时序。

当前 v2 协议中，服务器交换令牌后，旧 token 已失效而新 token 可能尚未写入扩展，导致在途请求401被共享 UI 当作撤销。`background.request` 仅在第一次401后等待已有授权流程，确认 origin、connectionId 相同且 token 确已变化，才按原 path/method/body 重放一次，每次仍核验 expected scope。GET/审批 POST 和交换响应尚未落库的窗口均有回归；未换 token、换账号、换站点、403/409及第二次401仍拒绝，不新增登录流程或持久字段。

随后受控回归证实另一处旧网站 `/session` 响应竞态：探针发出后，当前 token、账户连接或站点可能已经切换，晚到的旧200不能返回旧账号，晚到的旧401也不能触发额外认证。授权探针现在在响应 headers/body、读取 proof、bootstrap 及调用 startLogin 前重新核对当前站点与 grant 的 version/origin/connectionId/token/expiresAt；任何交错都按当前授权重新判断，不接受过期快照。旧200/401 × token/account/site 的6个受控失败先复现，再以9个新增回归验证修复；其中还覆盖401 body延后返回，以及同 grant 的真实401、连接撤销仍按原契约处理。原授权回归37项通过；加入速记后的当前 background 共64项通过，未增加协议字段、持久形状或旧格式兼容分支。

外壳 focus/visible/storage 刷新始终非交互；刷新单飞并用 generation 拒绝旧 state 覆盖 action 后的新账户、语言及提示。断连卸载共享 AI，重连恢复原规则。旧 assistantPending 不覆盖显式规则，慢加载后更新页面和 locale，不新增 storage shape。

## 当前验证与正式三轮

表内为各轮最终指纹核验的2026-10-22北京时间。每轮从平台实际下载 ZIP，安装到 macOS 原生 Chrome for Testing151.0.7922.34 的隔离临时 profile，headless直连localhost，无Docker转发，不使用用户文档或日常浏览器资料。模型为确定性 fixture，没有真实供应商或付费调用。

| 轮次 | 状态 | 确认时间 | 网页完成收录 / 原图一致 | 速记追加 / 原生回执 | 收据 |
| --- | --- | --- | --- | --- | --- |
| 1 | 通过 | 23:23:54 | 4 / 4 | 2 / 每项1 | 浏览器（本地产物：`browser-extension/runs/round-1/browser-report.json`）、服务端（本地产物：`browser-extension/runs/round-1/server-report.json`）、指纹（本地产物：`browser-extension/runs/round-1/freeze-report.json`）、日志（本地产物：`browser-extension/runs/round-1/run.txt`） |
| 2 | 通过 | 23:25:04 | 4 / 4 | 2 / 每项1 | 浏览器（本地产物：`browser-extension/runs/round-2/browser-report.json`）、服务端（本地产物：`browser-extension/runs/round-2/server-report.json`）、指纹（本地产物：`browser-extension/runs/round-2/freeze-report.json`）、日志（本地产物：`browser-extension/runs/round-2/run.txt`） |
| 3 | 通过 | 23:25:42 | 4 / 4 | 2 / 每项1 | 浏览器（本地产物：`browser-extension/runs/round-3/browser-report.json`）、服务端（本地产物：`browser-extension/runs/round-3/server-report.json`）、指纹（本地产物：`browser-extension/runs/round-3/freeze-report.json`）、日志（本地产物：`browser-extension/runs/round-3/run.txt`） |

每轮速记独立验证富文本及 Markdown 各一条增量、原文和 epoch 保留、各仅一个原生 receipt。富文本真实提交成功后丢失 UI 响应，重试原票据返回 changed:false 且序号不增加；后输草稿仍在。未知票据及平台停用目标规则均由真实后端返回409，保留文字及冻结链接，不自动重新准备或切换目标。重开 UI 无目标、文字或票据；速记阶段 AI job、模型调用、网页快照、收录 receipt 和图片资产均为0。

既有每轮4次网页完成收录、4张原图逐字节一致、双副本追加、规则隔离、Markdown、审批及语言/窄屏/缩放/登录/注销/续期/撤销均保留。三个 POST 前刷新窗口各恢复原 ID、完整 payload/profile/session 绑定，严格各1个消息 POST、1个页面准备、1个服务器 job；接受后丢响应通过精确 pendingId 对账，没有新增捕获尝试或消息 POST。

机器摘要（本地产物：`browser-extension/summary.json`）、源码/资源指纹（本地产物：`browser-extension/source-fingerprints.json`）、测试指纹（本地产物：`browser-extension/qa-fingerprints.json`）和每轮逐文件核验一致，覆盖190个输入文件、100个生成文件及5个 QA/关键测试输入。共享 AI 资源 SHA-256 仍为 `aaf39eef9627d15fee1f3ae7b669f6b7345e29c1f498f20d95bf36fafc40db79`，每轮 ZIP 独立 SHA 见收据。依赖重编译审计（本地产物：`browser-extension/transitive-bundle-audit.json`）验证当前已安装依赖下100个输出与冻结资源逐字节相同；2183是输出chunk中的模块数，其中没有Sheet或Canvas模块条目，环境版本不代替对应子包的主任务验收。

244项测试日志（本地产物：`browser-extension/unit-tests.txt`）、TypeScript零诊断收据（本地产物：`browser-extension/typecheck.json`）、构建日志（本地产物：`browser-extension/build.txt`）及[38张成功截图](browser-extension-visual.md)已归档。历史的IDB与授权三轮基线（本地记录：`artifacts/verification/issue-tracker-2026-10-21/browser-extension/idb-auth-baseline/README.md`）完整保留。两次速记校准运行只用于完善测试类型与截图视野，不混入新正式三连；独立审查发现的异常 ACK 字段类型强转已在最终冻结前修复并补回归。

此前Docker转发诊断仍见链路证据（本地产物：`browser-extension/fixture-transport-verification.json`）：请求体到达转发端，但新TCP socket未连接宿主机，强制IPv4与agent:false仍失败；未断言DNS/keepalive根因。当前原生三轮不经过该桥接，也未为此增加生产POST重试。

## Sheet 0.2.9 发布依赖补验

最终依赖已安装官方 Sheet 0.2.9，Canvas 仍为0.5.12。相对上面的190输入冻结基线，仅 `package.json`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 变化；其余187个选定源码、100个生成文件及5个QA输入均未变化。原机器摘要、源码/QA指纹、三轮收据及原依赖审计保持原样，`615ec…` 仍只代表原验收快照，不作为新锁树的整树验收指纹。

使用最终已安装依赖运行原 `write:false` 审计，实际转换7931个模块；100个输出包含2183个chunk模块，逐文件名与字节哈希均匹配原生成资源，聚合 SHA-256 仍为 `aaf39eef9627d15fee1f3ae7b669f6b7345e29c1f498f20d95bf36fafc40db79`。输出chunk模块清单没有 Sheet 或 Canvas SDK 条目；该清单不等同于全部解析/转换模块。字节一致结论来自重新编译而非版本推断。见依赖变更收据（本地产物：`browser-extension/sheet-0.2.9-release-delta.json`）、本次重编译审计（本地产物：`browser-extension/sheet-0.2.9-transitive-bundle-audit.json`）及构建日志（本地产物：`browser-extension/sheet-0.2.9-build-audit.txt`）。

本次只补依赖输出核验，没有修改扩展业务、共享AI或速记后端，也没有新增三轮浏览器测试。Sheet model/Yjs/XLSX、宿主补验及最终整个项目的发布验证仍由主协调任务分别记录。

## 验证限制

- 模型供应商为确定性 fixture，实际经过 runner 和 material-read，**没有真实供应商或付费模型验证结论**。若主协调另有真实模型收据，应独立记录，不能与本轮模拟模型收据混淆。
- headless Chromium 可以真实执行 sidePanel API，但未暴露可检查的原生面板 target。共享 AI 的交互及窄屏/200%截图来自相同 URL/hash 的扩展标签页 fixture，不等同于原生侧栏全部视觉验收。
- OS 全局快捷键仅验证 manifest 和 dispatch，没有模拟系统级按键路由。
- 上述 IDB 变更有明确的数据保留与回滚边界；不能声称旧、新发送器可安全并行，也不能在回滚时重新开启旧发送器。原表、文档和服务器聊天历史没有被转换。

复现命令（隔离数据库、账户和 Chromium）：

```sh
node node_modules/tsx/dist/cli.mjs tests/qa-browser-extension-issues.mts .local/browser-extension-idb-final/recheck
```

当前候选之外若再次改变共享 AI 入口、存储或共用组件，须重建扩展 bundle 并重新验收；此页不能覆盖后续源码。提交、GitHub 与 DockerHub 发布由主协调任务统一完成。
