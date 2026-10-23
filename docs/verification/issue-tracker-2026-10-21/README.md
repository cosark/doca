# Doca 问题统一修复与验收记录

最新收尾见[正式 npm 接入与重复网站验证](npm-direct.md)及[镜像大小与增量下载](image-size.md)。五种编辑器均直接引用正式 npm：Canvas 0.5.14、Sheet 0.2.11、Slate 0.4.25、Markdown 0.4.4、Slides 0.3.0-alpha.4，编辑器补丁已全部移除。默认 100% 对应的表格单元格尺寸增大 10%，逐文档缩放在浏览器缓存；用户批准的历史缺省尺寸边界已验证。下文旧候选和失败保留各自日期与范围。

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

来源：[📚 doca问题跟进](https://doca.heyphp.com/#/r/2b36ba23-b14a-458f-bffd-5c0ef9bee86b)。原快照（本地产物：`issues.json`）共59项，使用原表行号2–60。另只读保存[问题清单2.0](https://doca.heyphp.com/#/r/d470fbbe-6064-489f-a798-d8df8bfce20c)的6行快照（本地产物：`issues-v2.json`），使用其独立行号2–7；第4行包含5个评论子项，不混入原59行编号。

**最终正式包及编译 Web 验收已完成：3335 项单测、类型及构建通过；原生两轮、Sheet 图库四轮、缩放 7 组、Canvas 原生 17 阶段/偏好 7 组、五格式评论、修复场景只读复开和打包 MV3 均通过。Doca 0.2.8 的 GitHub/DockerHub 发布与双架构镜像功能验收正在收尾；生产未部署。** UI 图片供应商 504 未返回图片、用量未知仍为外部限制，不自动重试。下文机器状态和逐行矩阵属于历史检查点，最新结论以 [npm-direct.md](npm-direct.md) 为准。

## 问题归属

| 主责 | 原表行 | 边界 |
| --- | --- | --- |
| Canvas 子包 | 14、24、25、28–32、36–37、39–41、43、52 | 原生绘制、选择、滚动、文本布局、连线、样式和字体导出提示。 |
| Sheet 子包与宿主 baseline | 6、8、23、33–34、53、56 | 超链接、尺寸、筛选投影、编辑中图片预览。筛选条件目前协作共享。 |
| Slate 子包 | 2、11 | 标题回车和流程图文字编辑。 |
| Doca 插件存储 | 7、9 | 共享业务数据库、独立命名空间和 PostgreSQL 安装。 |
| Doca 提及/身份 | 3–4、16 | 用户候选、空昵称光标和候选浮层。 |
| Doca AI | 10、12–13、15、17–18、20、22、26–27、35、38、48、54–55、59 | 消息生命周期、原生命令、生成/看图/验收、画布导出与会话来源。 |
| Doca 文件、评论、导航 | 5、19、21、44、58 | 评论控件、搜索跳转、favicon、回收站批量清理、自动评论分页。 |
| Doca 浏览器扩展 | 45、49–51 | 入口、下载/方案配置、助手和选区工具栏。 |
| Doca + 五种编辑器的预览边界 | 42、46、57 | 包提供原生图片/图表出现顺序和点击回调，宿主提供授权图库与导航。 |
| Doca + Canvas 偏好边界 | 47、60 | 包提供受控视图/新建默认属性，宿主按已批准的浏览器作用域保存。 |

已核对全部41张原图，逐图范围记录在 截图审计（本地产物：`screenshot-audit.json`）；这只是复现/归属核对，不是41次网站验收。行27的旧关系图外框/内表错位由Canvas几何与宿主AI共同处理。

行13的原图是 `ELEMENT_ID_REUSE`，主责为宿主AI原生命令/错误恢复及Canvas模型约束，不应误归为一般画布性能。行16的原图是**在线表格**的用户候选，浮层由Doca `SheetNativeMentions` 管理。行35的原图请求“将当前画面发我/导出PNG”，需要真实文件交付，而不是只返回外部图片占位文字。

行44原图的回收站“文件和文件夹”清理范围已补齐：真实网站结果（本地产物：`file-trash-browser/results.json`）通过取消、并发恢复导致409且零部分删除、重新确认后全部清理，并保留活动文件、恢复文件、其他账号回收站和独立文档回收站。普通文件夹批量软删除另列，未代替该验证。

协调会话另外发现旧单项文件夹永久删除会扫到已恢复的活动子项，已共用同一保留校验并限定只删仍在回收站的行；活动/外账号子项返回409。该新增保护另已完成独立单项网页操作：父文件夹删除后恢复子项，取消保持不变、确认返回409且零部分删除；恢复父后再次显式删除整文件夹，单项永久删除成功，原保留行不变。见最新五组收据（本地产物：`file-trash-browser/results.json`）。

## 子包发布与接入

五种编辑器的正式归档、版本和宿主安装字节已核对。详见[最终来源及网站收据](npm-direct.md)，不再使用本地候选或编辑器 patch。

| 包 | 最终 npm 版本 | 最后验收 |
| --- | --- | --- |
| Canvas | 0.5.14 | 155 文件与正式归档一致；最终编译 Web 原生 17 阶段、偏好 7 组通过。 |
| Sheet | 0.2.11 | 73 文件与正式归档一致；原生两轮、图库四轮、缩放 7 组通过；已批准默认尺寸变化外保留历史数据。 |
| Slate | 0.4.25 | 192 文件与正式归档一致；DOCX 修复上游发布，真实 DOCX/PDF 导出与重导入通过。 |
| Markdown | 0.4.4 | 正式 npm 直接引用；预览/图库、评论及 PDF 指定场景通过。 |
| Slides | 0.3.0-alpha.4 | 正式 npm 直接引用；跨页图库及五格式评论指定场景通过。 |

源码 GitHub 推送、npm 归档、Doca 安装和网站验收分别核验。源契约与项目/全局技能副本已同步。以下分版本叙述和逐行表保留历史证据，不自动改写原失败。

## 已有本轮实际网站证据

- [宿主通用检查](host-qa.md)：行3/16底部单元格候选菜单、键盘插入和重开；行19附图文件结果与来源按钮的same-hash跳转；行21五类文档类型favicon。行7/9两份真实ZIP插件从网站安装，SQLite及PG17/18重启后记录相互隔离。本轮已在收据所载安装组合（Canvas0.5.10等）分别复跑SQLite、PG17和PG18，结果均通过；检查仅覆盖这些指定场景。
- [文件/评论/图库](host-fixes.md)与浏览器结果（本地产物：`host-browser/results.json`）：420条锚定评论和6条回复自动分页、刷新期间迟到页不跳过中间页；普通文件夹批量软删除及取消；Slate0.4.24图表/照片在编辑、只读、历史、回收站预览；Canvas双图上传、重开、拖动和按钮/按键/横向滚动切换。Markdown0.4.4图/重复引用/Mermaid在四种入口通过；Sheet0.2.7结果（本地产物：`sheet-browser/results.json`）记录草稿保留、精确同格第二图和跨sheet图库。Slidesalpha4结果（本地产物：`slides-browser/results.json`）记录跨页图库及四类入口；文件清理结果（本地产物：`file-trash-browser/results.json`）覆盖行44原图。
- [原生补验收](native-qa.md)与正式收据（本地产物：`native-browser/results.json`）：行2/4/5/6/8/11/23/33/34/56在Canvas0.5.10、Sheet0.2.7、Slate0.4.24等收据所载安装组合复跑通过，含两账号普通单元格/下拉筛选、评论三种宽度和阅读态。8个文档/14客户端60秒静置零内容写入、页面异常0。
- [AI宿主记录](ai-findings.md)、浏览器结果（本地产物：`ai-browser/browser.json`）、历史/上传结果（本地产物：`ai-history/browser.json`）：手机容器真实嵌套、表格背景实际像素、授权PNG导出卡片及单文件重放、删除关联后原会话/文件保留和新建会话、图片消息刷新/收起上传，以及关闭侧栏去除session参数。

[Canvas个人偏好](canvas-preferences.md)在独立0.5.11菜单候选完成七组实际Doca网站验收，含同浏览器账号/文档隔离、未知/坏JSON原样保留、写入被拒绝时临时选择与旧记录保留、小地图导航和6份文档60秒零内容写入。窄屏菜单改为等待真实入场动画完成后严格量测，cd71菜单候选修复后的760×720边界通过；候选SHA256为cd71a8c25be56484714e20fa1075de35d756d2c0b0b550edce88d6a8dc0b7bfe，见候选收据（本地产物：`canvas-preferences-candidate-browser/results.json`）。这不是正式npm包或生产部署验收，旧0.5.10菜单量测盲点在报告中保留修正。该收据只属于cd71菜单候选，未自动延用为后来c28标题候选或后续双击修复的全项通过。

此前标题候选实际网站补验（本地产物：`ai-native-title-candidate/results.json`）对应SHA256 c28efda73348559d1edec1c93e471f5e4c9a6dfd993754503ef89c79f00b7ea5：重开保留的合成真实模型手机、Web和三表ER场景，确认Web标题可见；fit与刷新零内容写入、零模型请求、页面错误0。此前模型review声称标题可见，已被实际像素检查推翻，因此其pass未计为充分证据。该收据仅补验标题/重开范围。当时还发现容器双击openGroup/closeGroup使hitChildren视图状态进入内容；此失败随后在f2aa候选修复并另行验证，未改写c28收据。

此前同一0.5.11/f2aaada3c9f68e6821b0ec81cade786f0b235b85cc0012bd9b478794b9518920候选已顺序补验：原生16阶段及最小表格（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、个人偏好7组（历史本地记录：`../../../.local/canvas-preferences-boundaries-final-2026-10-22/results.json`）、历史预览7组（历史本地记录：`../../../.local/history-preview-boundaries-final-2026-10-22/results.json`），页面错误均为0。原生检查包括手机边框真实像素/PNG/SVG、旧wrapper继续操作/导出、两客户端及约64秒零写；最小表格12轮静置保留缺失布局字段。偏好6份文档60秒零内容写入，760×720菜单等待动画结束后边界为x22/y170.78/宽232/高541.22，已目视确认底部帮助可见。历史检查覆盖A慢B快、快照图库重置/保留、关闭/卸载取消及Canvas双图切回单图，零内容更新。这些是Vite隔离网站的精确0.5.11候选证据，不代表后来官方0.5.12完整复跑、最后压缩Web或生产验收。

旧localStorage整队列曾在真实双窗口并发中丢失adopt/恢复旧草稿，该历史失败保留。用户两次批准后已实施[独立IDB事务队列](ai-pending-idb.md)：两真实页面压力检查（本地产物：`ai-pending-idb-concurrency/results.json`）保留精确299条pending及2条墓碑，事务提交后同伴立即可读。刷新4场景（本地产物：`ai-pending-refresh/results.json`）、存储失败4场景（本地产物：`ai-pending-storage-failure/results.json`）、旧项3场景（本地产物：`ai-pending-legacy/results.json`）及网站历史5场景（本地产物：`ai-history-idb/browser.json`）共16场景通过；78项针对性检查和类型检查通过。旧localStorage只读、不自动重放，原ID、后续草稿及未知原文保留。升级/回退须关闭全部旧sender；回退停止新sender，保留新旧存储和墓碑，不自动恢复旧sender。

最终打包MV3三轮验收（本地产物：`browser-extension/summary.json`）覆盖收录、共享助手、IDB恢复、鉴权/撤权和纯文本速记，244项针对性检查及完整类型检查通过，付费模型调用0。Sheet0.2.9安装后的输出审计（本地产物：`browser-extension/sheet-0.2.9-release-delta.json`）确认100个扩展生成文件字节一致，原三轮收据不改写；该审计不是新整锁树宿主验收。headless同哈希扩展页检查侧栏UI，系统快捷键路由仍属明确限制；发布和生产验收另行记录。

真实模型验收已保存结果（本地产物：`ai-real-provider/results.json`）与供应商轨迹（本地产物：`ai-real-provider/provider-requests.json`）：显式Seedream Pro的一次2048×2048生图成功，10,864,897字节PNG保存/插入后，image_view/canvas_view和Kimi独立视觉验收通过；随后真实模型canvas_export交付卡片、PNG下载和刷新通过，生图请求数保持一次。该合成照片场景不证明旧截图中未知计费操作的历史故障已恢复，也不替代UI设计图片的特定内容验收。**本地保留的 `data/v1` 旧Lite配置副本曾返回404；这不是线上配置。** 协调会话只读检查的线上当前配置是Pro和显式profile，不应把本地旧配置结果写成线上故障，也不能把配置观察写成已部署本轮修复。

另一次专门请求UI位图的实际操作正确选用image_generate，但Pro网关约60秒后返回504：只有一次图片POST，无request ID、无返回图片，供应商用量未知。Doca保留原operation/pending call并标记image_result_uncertain，没有自动重试；见不确定结果（本地产物：`ai-ui-image-uncertain/results.json`）和请求轨迹（本地产物：`ai-ui-image-uncertain/provider-requests.json`）。**该UI图片场景尚未通过**，也没有完成对账；此前照片成功不能替代它。随后实际重开原不确定任务并刷新，费用结果待核对提示持续可见、重试禁用，原call/operation哈希不变、内容写入0、供应商请求0；见反馈及重试保护（本地产物：`ai-ui-image-uncertain/feedback-guard-browser.json`）。跨retry更换prompt/尺寸/model导致再次付费的漏洞已修，243项针对性检查和类型检查通过；此前3185项全量通过早于此修复，不能替代最后改动后的检查。

协调会话已在网关管理端关联13:25:32（UTC+8）的request966ff0951fee056e11767b9ccffc09e5：约60秒后request_canceled，未收到上游响应，全部usage仍未知。客户端原回执的requestId:null保留；管理端关联不等于取得图片或完成对账。该项为外部结果限制，不能算UI生成成功，也不把已通过的数据保留/禁重试处理写成未修Doca缺陷。

## 用户已确认的行为

- 行47/60：version1浏览器本地偏好，按网站、账号和文档隔离。缺记录保持当前行为且打开不写；未知/无效记录保留，不转换、不覆盖。视图变化不进入内容协作；默认样式仅用于未来交互新建的连线/便签。旧对象、API/AI显式对象和历史数据不回填。
- 行50：用户已撤回“一套方案”的原要求，最终保留**多个收录方案和一个默认方案**。没有批准历史方案转换或删除。
- AI待发送存储：用户两次批准IDB事务存储、旧项逐条明确继续/撤回，以及停止旧sender、保留新旧存储的升级回退方案，见[已批准规则](ai-pending-idb.md)。
- 清单2.0行6：速记仅向已有授权富文本/Markdown追加纯文本，不用AI；目标和草稿仅在本次扩展视图内存保存。
- 所有协作/删除/存储测试使用隔离合成文档与数据库；两份问题表只读。尚未执行本轮生产部署。

## 逐行进度

“通过”均限定于链接证据的检查和版本；行2/3/4/5/6/7/8/9/11/16/19/21/23/33/34/56已记录Canvas0.5.10安装组合的指定场景，其余按各自收据保留状态。当前官方Canvas0.5.12/Sheet0.2.9最后构建组合尚未验收。历史记录不因为问题表写着“已解决”就自动成为本轮验收。

| 原表行 | 负责人 | 当前状态 | 证据 |
| --- | --- | --- | --- |
| 2 | @smartdoca/slate | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`）、记录（本地产物：`slate-package-audit.json`） |
| 3 | Doca mentions/identity | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](host-qa.md)、记录（本地产物：`host-sqlite/browser.json`） |
| 4 | Doca mentions/identity | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`）、[记录](../editor-interactions-2026-10-15/README.md) |
| 5 | Doca files/comments/gallery | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`）、[记录](host-fixes.md) |
| 6 | @smartdoca/sheet | 最新静态失败：超链接插入禁用 | 最新失败（本地产物：`native-built-browser/results.json`）、[记录](native-qa.md)、记录（本地产物：`native-browser/results.json`） |
| 7 | Doca plugin storage | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](host-qa.md)、记录（本地产物：`host-sqlite/browser.json`）、记录（本地产物：`host-pg17/browser.json`） |
| 8 | @smartdoca/sheet | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`） |
| 9 | Doca plugin storage | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](host-qa.md)、记录（本地产物：`host-sqlite/browser.json`）、记录（本地产物：`host-pg17/browser.json`） |
| 10 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-history/browser.json`） |
| 11 | @smartdoca/slate | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`） |
| 12 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-browser/browser.json`） |
| 13 | Doca AI、@smartdoca/canvas | 后续补修指定范围通过；最终对齐待验 | 补修/导出（本地产物：`ai-native-metadata-repair-export/diagnosis.json`）、续写/拒绝（本地产物：`ai-native-guidance-recovery/diagnosis.json`）、严格失败（本地产物：`ai-native-official-0.5.12-failure/diagnosis.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](ai-findings.md) |
| 14 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 15 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](ai-findings.md)、记录（本地产物：`ai-browser/browser.json`） |
| 16 | Doca SheetNativeMentions UI、@smartdoca/sheet native rectangle | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](host-qa.md)、记录（本地产物：`host-sqlite/browser.json`） |
| 17 | Doca AI、@smartdoca/canvas | 后续补修指定范围通过；最终对齐待验 | 补修/导出（本地产物：`ai-native-metadata-repair-export/diagnosis.json`）、续写/拒绝（本地产物：`ai-native-guidance-recovery/diagnosis.json`）、严格失败（本地产物：`ai-native-official-0.5.12-failure/diagnosis.json`）、[记录](ai-findings.md)、标题补验（本地产物：`ai-native-title-candidate/results.json`） |
| 18 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、[记录](../ai-canvas-tools-2026-10-19/README.md)、记录（本地产物：`ai-real-provider/results.json`） |
| 19 | Doca files/comments/gallery | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](host-qa.md)、记录（本地产物：`host-sqlite/browser.json`） |
| 20 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、[记录](../ai-canvas-tools-2026-10-19/README.md)、记录（本地产物：`ai-real-provider/results.json`） |
| 21 | Doca files/comments/gallery | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](host-qa.md)、记录（本地产物：`host-sqlite/browser.json`）、记录（本地产物：`host-browser/results.json`） |
| 22 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、[记录](../ai-canvas-tools-2026-10-19/README.md)、记录（本地产物：`ai-real-provider/results.json`） |
| 23 | @smartdoca/sheet | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`） |
| 24 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 25 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 26 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-history/browser.json`） |
| 27 | Doca AI、@smartdoca/canvas diagram geometry | 后续补修指定范围通过；最终对齐待验 | 补修/导出（本地产物：`ai-native-metadata-repair-export/diagnosis.json`）、续写/拒绝（本地产物：`ai-native-guidance-recovery/diagnosis.json`）、严格失败（本地产物：`ai-native-official-0.5.12-failure/diagnosis.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](ai-findings.md)、标题补验（本地产物：`ai-native-title-candidate/results.json`）、[记录](../ai-canvas-tools-2026-10-19/README.md) |
| 28 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 29 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 30 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 31 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 32 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、焦点诊断（本地产物：`canvas-table-keyboard-diagnostic/diagnosis.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 33 | @smartdoca/sheet | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`）、记录（本地产物：`sheet-package-audit.json`） |
| 34 | @smartdoca/sheet | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`）、[记录](qa-inventory.md) |
| 35 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-browser/browser.json`）、记录（本地产物：`ai-real-provider/results.json`） |
| 36 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](qa-inventory.md) |
| 37 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/browser.json) |
| 38 | Doca AI、@smartdoca/canvas | 后续补修指定范围通过；最终对齐待验 | 补修/导出（本地产物：`ai-native-metadata-repair-export/diagnosis.json`）、续写/拒绝（本地产物：`ai-native-guidance-recovery/diagnosis.json`）、严格失败（本地产物：`ai-native-official-0.5.12-failure/diagnosis.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](ai-findings.md) |
| 39 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、焦点诊断（本地产物：`canvas-table-keyboard-diagnostic/diagnosis.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 40 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 41 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、焦点诊断（本地产物：`canvas-table-keyboard-diagnostic/diagnosis.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 42 | Doca files/comments/gallery | 最后静态指定场景通过 | 静态宿主7组（本地产物：`host-built-browser/results.json`）、[记录](host-fixes.md)、记录（本地产物：`host-browser/results.json`）、记录（本地产物：`slate-package-audit.json`） |
| 43 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](../editor-packages-2026-10-21/README.md)、[记录](../editor-packages-2026-10-21/browser.json) |
| 44 | Doca files/recycle bin | 本轮网站检查通过（待最终包组合复跑） | [记录](host-fixes.md)、记录（本地产物：`file-trash-browser/results.json`） |
| 45 | Doca browser extension | MV3三轮检查通过（待整包发布/生产） | 扩展收据（本地产物：`browser-extension/summary.json`）、[IDB](ai-pending-idb.md)、[速记](browser-extension-quick-note.md) |
| 46 | Doca image gallery、@smartdoca/slate、@smartdoca/markdown、@smartdoca/sheet、@smartdoca/slides、@smartdoca/canvas | 部分静态通过；Sheet浏览器异常待复跑 | Sheet图库失败（本地产物：`sheet-gallery-built-browser/results.json`）、Slides通过（本地产物：`slides-gallery-built-browser/results.json`）、f2aa历史7组（历史本地记录：`../../../.local/history-preview-boundaries-final-2026-10-22/results.json`）、[记录](host-fixes.md)、记录（本地产物：`host-browser/results.json`）、记录（本地产物：`slate-package-audit.json`） |
| 47 | Doca browser-scoped preferences、@smartdoca/canvas | 0.5.14 C1偏好7组通过（待正式对齐） | C1偏好（本地产物：`canvas-preferences-candidate-0.5.14-browser/results.json`）、官方偏好（本地产物：`canvas-preferences-official-0.5.12-browser/results.json`）、f2aa偏好7组（历史本地记录：`../../../.local/canvas-preferences-boundaries-final-2026-10-22/results.json`）、记录（本地产物：`coordination.json`） |
| 48 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-browser/browser.json`） |
| 49 | Doca browser extension | MV3三轮检查通过（待整包发布/生产） | 扩展收据（本地产物：`browser-extension/summary.json`）、[IDB](ai-pending-idb.md)、[速记](browser-extension-quick-note.md) |
| 50 | Doca browser extension、Doca AI session source badge | MV3三轮检查通过（待整包发布/生产） | 扩展收据（本地产物：`browser-extension/summary.json`）、[IDB](ai-pending-idb.md)、[速记](browser-extension-quick-note.md) |
| 51 | Doca browser extension | MV3三轮检查通过（待整包发布/生产） | 扩展收据（本地产物：`browser-extension/summary.json`）、[IDB](ai-pending-idb.md)、[速记](browser-extension-quick-note.md) |
| 52 | @smartdoca/canvas | 0.5.14 C1指定阶段通过（待正式/构建对齐） | C1原生17（本地产物：`canvas-candidate-0.5.14-acceptance.json`）、官方原生收据（本地产物：`canvas-official-0.5.12-browser/results.json`）、f2aa原生（历史本地记录：`../../../.local/canvas-native-boundaries-final-2026-10-22/summary.json`）、[记录](qa-inventory.md) |
| 53 | @smartdoca/sheet | 部分静态通过；Sheet浏览器异常待复跑 | Sheet图库失败（本地产物：`sheet-gallery-built-browser/results.json`）、Slides通过（本地产物：`slides-gallery-built-browser/results.json`）、[记录](host-fixes.md)、记录（本地产物：`sheet-browser/results.json`）、记录（本地产物：`sheet-package-audit.json`） |
| 54 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-history/browser.json`） |
| 55 | Doca AI | 照片通过；UI生图结果不确定 | 错误反馈/禁重试（本地产物：`ai-ui-image-uncertain/feedback-guard-browser.json`）、[记录](ai-findings.md)、照片（本地产物：`ai-real-provider/results.json`）、UI不确定结果（本地产物：`ai-ui-image-uncertain/results.json`） |
| 56 | @smartdoca/sheet | Canvas0.5.10组合指定网站场景通过（未部署生产） | [记录](native-qa.md)、记录（本地产物：`native-browser/results.json`）、记录（本地产物：`sheet-package-audit.json`） |
| 57 | Doca image gallery、@smartdoca/slate、@smartdoca/markdown、@smartdoca/sheet、@smartdoca/slides、@smartdoca/canvas | 部分静态通过；Sheet浏览器异常待复跑 | Sheet图库失败（本地产物：`sheet-gallery-built-browser/results.json`）、Slides通过（本地产物：`slides-gallery-built-browser/results.json`）、f2aa历史7组（历史本地记录：`../../../.local/history-preview-boundaries-final-2026-10-22/results.json`）、[记录](host-fixes.md)、记录（本地产物：`host-browser/results.json`）、记录（本地产物：`sheet-browser/results.json`） |
| 58 | Doca files/comments/gallery | 最后静态指定场景通过 | 静态宿主7组（本地产物：`host-built-browser/results.json`）、[记录](host-fixes.md)、记录（本地产物：`host-browser/results.json`） |
| 59 | Doca AI | 本轮网站检查通过（待最终包组合复跑） | [记录](ai-findings.md)、记录（本地产物：`ai-real-provider/results.json`）、记录（本地产物：`ai-real-provider/provider-requests.json`） |
| 60 | Doca browser-scoped preferences、@smartdoca/canvas | 0.5.14 C1偏好7组通过（待正式对齐） | C1偏好（本地产物：`canvas-preferences-candidate-0.5.14-browser/results.json`）、官方偏好（本地产物：`canvas-preferences-official-0.5.12-browser/results.json`）、f2aa偏好7组（历史本地记录：`../../../.local/canvas-preferences-boundaries-final-2026-10-22/results.json`）、记录（本地产物：`coordination.json`） |

## 最后编译Web与全量检查 — 2026-10-23

此前冻结检查点为319个文件通过、2个文件跳过，3327项测试通过、7项跳过、0失败，见JSON（历史本地记录：`../../../.local/release-0.2.8/full-regression-final.json`）和日志（历史本地记录：`../../../.local/release-0.2.8/full-regression-final.log`）。JSON中的364是reporter suite计数，不是测试文件数。Web构建成功，index SHA256为bdf45a1b8fdfaa39a59e78df26fa9ab25ad83164d7dc9914ccfc5fbaaf0a2b64。

同一正式包组合和真实压缩Web隔离服务已通过宿主7组（本地产物：`host-built-browser/results.json`）、Slides图库3组（本地产物：`slides-gallery-built-browser/results.json`）、五格式评论（本地产物：`comments-v2-built-browser/results.json`）和Sheet复制/下拉3组（本地产物：`sheet-v2-built-browser/results.json`），各自错误数组为空。评论5客户端61,006ms正文/checkpoint/seq/WS零写入、DOM身份不变；Sheet4页/2文档60秒零写入。评论构建审计（本地产物：`comments-v2-built-browser/build-audit.json`）与Sheet完整验收指纹（本地产物：`sheet-v2-built-browser/acceptance-fingerprint.json`）记录原产物和源码范围。

原生静态验收（本地产物：`native-built-browser/results.json`）当前因行6超链接“插入链接”禁用失败；Sheet图库（本地产物：`sheet-gallery-built-browser/results.json`）虽完成5个功能断言，仍因null.getSheetBySheetId浏览器异常失败。两项均未关闭，不能把断言数或单测通过当作整套通过。生产部署独立记录，不是本次GitHub/Docker发布的前置条件。

两项已定位到Sheet原生边界：超链接焦点诊断（本地产物：`native-link-focus-failure/diagnosis.json`）证明前台页面仍有焦点时，原生DOCS_NORMAL抢回输入，显示文字留空而地址有效；图库卸载诊断（本地记录：`artifacts/verification/issue-tracker-2026-10-21/sheet-gallery-lifecycle-diagnostic/README.md`）证明Univer0.25.1验证提示的debounce完成回调在预览销毁后访问空workbook。图库普通4轮中2红2绿，额外待处理悬停/键盘关闭也失败。等待Sheet项目新包后，原生8组须两独立轮、图库完整5组至少4轮并覆盖待处理悬停关闭；旧失败收据保留。

## Canvas官方原生与真实模型补验 — 2026-10-23

另已核对官方Canvas0.5.12的独立范围：原生16阶段（本地产物：`canvas-official-0.5.12-browser/results.json`）15过、table撤销1失败；偏好7组（本地产物：`canvas-preferences-official-0.5.12-browser/results.json`）全部通过，6文档60秒零写。二者不能互相替代。表格焦点诊断（本地记录：`artifacts/verification/issue-tracker-2026-10-21/canvas-table-keyboard-diagnostic/README.md`）证明真实移动柄拖拽后焦点仍留在缩小button，Meta+z被0.5.12控件隔离过滤。三个几何指标通过不能把该场景标绿。PR18的两行修复仅在真实pointerdown归还本Canvas焦点，保留button/input隔离；0.5.13已正式安装且原16阶段/偏好7组通过，额外最小表格工具切换后撤销失败，见交付追加记录（本地产物：`subpackage-releases.json`）。

Canvas0.5.12真实模型流程（本地产物：`ai-native-official-0.5.12-failure/diagnosis.json`）的手机、Web、三表两关系生成/review及网站reload零写通过，但续写删除重建了既有Text ID。独立review把“全部ID”弱化成核心ID误判通过，严格本地断言拦住整体失败，纠错/导出原轮未执行。原失败库保留；后续保留precontinue JSON的新合成板续写及明确补修/导出已取得指定范围收据，不重跑三次生成；原失败不改写，详见下节。既有outline的UTF16长度和review指令已加强，50项focused及1项document-read检查通过，无新API/字段/格式；它们不是实际续写通过。此轮语言/视觉有真实token消耗，生图调用0不等于全部模型零成本。

## C1候选与后续AI补修 — 2026-10-23

最新Canvas0.5.14 C1收据（本地产物：`canvas-candidate-0.5.14-acceptance.json`）在同一155文件、SHA256 ffd4201e877e36192b3982234c138d9c21a73c9cd6c27037eef582d92cfabb93上，原16加minimal-table共17阶段及偏好7组全部通过，errors为空，静置至少60秒零写。显式工具选择与自动complete的焦点处理分开，未放宽输入/控件隔离。原0.5.12/0.5.13失败保留，C1暂不等于正式0.5.14或最终编译Web。

AI续写补验（本地产物：`ai-native-guidance-recovery/diagnosis.json`）保留实际41个ID，并以一次当前有效live-ID命令验证INVALID_ELEMENT_ID原子拒绝，未测试该次请求的deleted-ID tombstone。标题修正曾丢掉手机metadata，单次标准retry的review也漏检，二者仍为失败/partial。随后明确补修与四PNG交付（本地产物：`ai-native-metadata-repair-export/diagnosis.json`）精确恢复手机data，仅改请求的标题，保留所有41个ID及其他场景字段；4个文件签名/尺寸/哈希、下载及人工像素均验证。

原补修导航循环因空白点击后增加emptyText而失败，原收据保留；双击的精确时序未捕获，不宣称已证明被动reload写入。由准确model-after JSON新建当前格式QA资源后，纯open/reload、真实Hand/fit/Select及再次reload均为零写/零frames/零provider/errors为空。此前model_connection_failed已证明源自QA tracedFetch宽泛文字匹配后在fetch前抛断言，产品model.ts无修复。三段既有guide/reviewer修正共57项focused及TSC通过，无新API、格式或自动metadata合并。四轮合计88+38+10+18=154次语言/视觉HTTP调用，生图0，真实token费用不为0；未触碰独立UI504任务。浏览器/renderer仍是捕获的0.5.12编译产物，host model单列0.5.13，最后正式包及新构建只读复开仍待验。

## 问题清单2.0：新增6行

独立来源行号和机器状态位于coordination.json的issuesV2，不改变原59行统计；第4行五子项分别保留验收范围。

| 2.0来源行 | 归属 | 当前状态与证据 |
| --- | --- | --- |
| 2 复制报错 | Sheet子包 | 正式0.2.9静态网站通过（本地产物：`sheet-v2-built-browser/results.json`）：复制/剪切、越界拒绝零部分写、原剪切缓存重试、撤销/重做/重载及同伴零回声。 |
| 3 评论删除误删画布元素 | Canvas原生键盘 + Doca评论 | 正式0.5.12/Sheet0.2.9的五格式静态评论（本地产物：`comments-v2-built-browser/results.json`）通过；Canvas保持选中，实际键盘/剪贴板操作零正文误改。 |
| 4 评论五子项 | Doca评论、布局及永久标记分页 | 发送loading；新输入框/已发消息定位；标题与滚动；侧栏占据页面且避开AI；开侧栏前永久标记，五项在五格式静态网站（本地产物：`comments-v2-built-browser/results.json`）通过。5客户端61,006ms零写/零错误，多宽及mobile通过。 |
| 5 评论上传图片 | Doca评论上传 | 静态网站（本地产物：`comments-v2-built-browser/results.json`）慢上传/发送状态、错误保留草稿、Doca文件取图及发布图片可见通过，见[报告](comments-v2.md)。 |
| 6 浏览器速记 | Doca授权追加 + 扩展 | 获批纯文本/已有目标/仅内存；[host28测试与真实双页丢ACK](browser-quick-note.md)和[MV3三轮](browser-extension-quick-note.md)通过，零AI调用；五分钟进程内ticket及关闭视图丢弃临时状态为明确边界。 |
| 7 删除下拉 | Sheet子包 | 正式0.2.9静态网站通过（本地产物：`sheet-v2-built-browser/results.json`）：单/多选局部删除、混合区域保值样式、普通格/公式栏/F2输入与只读；C2列表草稿退格目视确认后取消零写，不要求浮层Enter提交非法列表值。 |

## 当前剩余范围（2026-10-23 最终验收后）

- GitHub Release、部署资源与 DockerHub 双架构镜像正在发布，实际镜像功能、摘要及压缩大小以发布回执为准。
- UI 生图外部限制：504 无返回图，网关取消且用量未知，未对账、不自动重试。数据保留、提示和禁重试处理已通过，不宣称 UI 生成成功。
- Mastra memory 保留仍然必要的第三方反射补丁；当前 core 不具备新版 memory 所需的导出，不进行未经批准的 SDK/存储升级。五种编辑器已无本地补丁。
- 生产站点未部署。关闭全部旧 sender、保留新旧队列和后续数据的升级/回退要求继续有效。

先前列为待办的 Sheet 超链接/销毁回调、Canvas 正式包/最小表格、AI 最终编译只读重开、全量及 MV3 对齐均已取得最终收据，见 [npm-direct.md](npm-direct.md)。历史失败仍按原版本保留。

## 最终关闭条件

1. 子包给出真实GitHub/npm交付回执；Doca安装同一归档并核对实际声明/模型/codec边界。
2. 使用最终源码和最终包组合，在隔离的真实Doca网站逐行执行复现。每个改变的操作类别包括保存/刷新、undo/redo、peer/readonly和授权边界；view/selection/scroll/resize静置60秒零内容写入。
3. 五格式图集与浏览器扩展用实际公开UI验收；已获授权的生成质量用真实结果及完整像素检查。未决计费调用保留限制，不为补验而自动重试；mock、保存回执和构建不能代替生成成功。
4. 完成最终类型、适当回归、构建和源契约同步；回收站文件清理等新发现范围必须有专门证据。
5. 生产部署及站点实际验收单独记录，当前未部署；它不是本次GitHub/Docker发布的前置条件。保留原数据库、文件、配置和后续写入，隔离编译Web验收不等于生产升级。
