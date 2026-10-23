# 问题跟进表只读审计与验收矩阵

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

审计日期：2026-10-21。源快照见 issues.json（本地产物：`issues.json`），59 个问题，原表行号 2–60。本文为只读归属审计，**不是本轮修复完成或线上验收报告**。表内“历史”指仓库已有证据，仍需使用最终集成构建复跑；“待查”不能按原表的已解决状态直接关闭。

## 当前基线与证据

- Doca `0.2.7`，审计开始 HEAD `79ae92c`。锁定 Canvas `0.5.8`、Sheet `0.2.5`、Slate `0.4.23`、Markdown `0.4.3`、Slides `0.3.0-alpha.3`。
- E1：[本日编辑器集成](../editor-packages-2026-10-21/README.md)、[浏览器结果](../editor-packages-2026-10-21/browser.json)。真实 Doca + Chromium，内存 SQLite 和合成文档；Canvas 连接线平移、redo、12 端口、图片、只读授权下载、Sheet filter 创建/删除/重建/重开、两张单元格图片、60 秒零写入。包侧 27 项浏览器回归，Sheet 两项真实 Univer 引擎回归（源码和实际 npm 包）。
- E2：Canvas 上游变更（实际文件位于 `/Users/zhangsiwen/dev/aid/aidcanvas/CHANGELOG.md`）：0.5.6 修复空标签光标、列表数字、端口点击、混合修饰键；0.5.7 修复快捷样式、滚动、mention/语义删除、redo、嵌入视图菜单和表格移动手柄；0.5.8 实现未绑定连线整体平移。只有已集成并复跑目标场景后才能关闭问题。
- E3：[AI 画布验收](../ai-canvas-tools-2026-10-19/README.md)、[消息刷新报告](../ai-canvas-tools-2026-10-19/history-browser.json)。五个消息浏览器场景通过；实际模型生成 12 表 13 关系并继续修改；64 组 native routing 对照；独立图像观察与审查链路；不等同于本表每个模糊截图已重现。
- E4：[Sheet 超链接浏览器验收](../editor-package-upgrade-2026-10-16/sheet-hyperlink-browser.json)，Sheet 0.2.2 起取消/关闭/Esc/外点均零写入，保存/撤销/重做/重开通过。
- E5：[浏览器扩展当前登录验收](../browser-clipper-login-2026-10-21/README.md) 和 [第三轮](../browser-clipper-login-2026-10-21/browser-run-3.json)。网站会话登录、选区/整页、原图、追加双页同步、AI 会话已测。不能代替行 45、49–51 的新增界面要求。
- E6：[0.2.7 发布证据](../release-0.2.7/README.md)，已发布 Docker 镜像与 GitHub CI；不是 `doca.heyphp.com` 已部署最新工作树的证明。
- E7：[本轮原生网站补验收](native-qa.md)、正式收据（本地产物：`native-browser/results.json`）：2026-10-22以Canvas0.5.10/Sheet0.2.7/Slate0.4.24/Markdown0.4.4/Slidesalpha4复跑，行2/4/5/6/8/11/23/33/34/56通过；8文档/14客户端60秒零内容写入、页面异常0。仅证明这些原生场景，生产未部署。
- E8：回收站文件清理（本地产物：`file-trash-browser/results.json`）：原图的files/folders全部范围、取消、stale409无部分删除、重新确认及跨账号/文档保留边界通过。
- E9：[宿主图库/评论](host-fixes.md)、Sheet（本地产物：`sheet-browser/results.json`）、Slides（本地产物：`slides-browser/results.json`）：五格式分别有本轮记录的真实网站证据；Sheet0.2.7历史卸载警告复跑为0，最终Canvas升级后相关场景仍需复跑。
- E10：[最终包组合宿主检查](host-qa.md)、SQLite（本地产物：`host-sqlite/browser.json`）、PG17（本地产物：`host-pg17/browser.json`）、PG18（本地产物：`host-pg18/browser.json`）：2026-10-22以Canvas0.5.10/Sheet0.2.7/Slate0.4.24/Markdown0.4.4/Slidesalpha4复跑行3/7/9/16/19/21指定场景，三份收据均通过。没有生产部署，不替代其他行验收。

## 逐行归属与实际网站验收

“读图”表示源截图是准确复现的一部分。尤其泛化标题必须先看图，不能仅凭标题宣布修复。编辑和协作测试只用隔离合成数据。

| 原表行 | 主责/协作 | 已有证据与仍需实际操作的验收 |
| --- | --- | --- |
| 2 | Slate | E7通过：H1/H2末尾、H3中间和空H4 Enter均创建无title正文新块，原文字保留、双页同步/重开无回声。当前native结构为paragraph/title，不以旧heading-one fixture冒充实际标题；最终包组合已复跑。 |
| 3 | Doca SheetNativeMentions + Sheet native rect | 原图明确是Sheet单元格的候选菜单。E10最终包组合底部单元格ArrowUp保留、Enter原子提及/重开通过。检查未新增扩展IME/ACL场景的证明。 |
| 4 | Doca identity/presence + Slate | E7空display_name两账号通过：2px×18px有色光标和服务端公开ID标签可见；selection零写入，真实编辑可同步且接收无回声。 |
| 5 | Doca comments UI | E7通过1600/760/390px开关和键盘；空/有评论、编辑/阅读态图标、计数与抽屉截图已人工复看。 |
| 6 | Sheet | E4历史与E7当前0.2.7均通过四种取消零写/无回声；确认后可撤销重做重开。 |
| 7 | Doca plugin storage | E10最终包组合从网站安装两个合成ZIP插件并重启，在独立SQLite/PG17/18分别证明同表名同ID的记录按命名空间隔离、保留。未重设用户插件库。 |
| 8 | Sheet 默认尺寸 + Doca baseline | E7当前0.2.7新建与原生追加sheet均为19.8行高/79.2列宽，刷新不变；本轮不回填历史baseline或改明确尺寸语义。 |
| 9 | Doca plugin storage | E10最终包组合在专用PG17/18分别从界面安装两份真实ZIP、重启并确认公开插件端点各自记录；原业务数据库未使用。 |
| 10 | Doca AI history UI | E3 五场景；全屏和画布侧栏发送图片、刷新、延迟旧快照、失败重试、收起上传；消息全程不消失/不重复发。 |
| 11 | Slate diagram workspace | E7当前0.4.24实际工作区双击节点/边标签全选20/19字符，输入替换、工作区撤销重做、保存、peer工作区和重开通过。 |
| 12 | Doca AI spreadsheet tool | 两张原图明确是bgColor未显示后退回圆点字符替代，不能把圆点当填色修复。当前原生 `s.bg.rgb`、拒绝错误颜色字段与真实Doca黄/蓝像素已通过；最终补清色、保留文字/样式、刷新和peer。 |
| 13 | Canvas model ID lifecycle / Doca AI mutation | 已实际读取原图，手机UI画布右侧红色 `ELEMENT_ID_REUSE`；需分别复现 native复制/撤销重做与AI删除再新增旧ID。宿主当前已有明确的ID重用拒绝说明，不代表交互根因已消失。原图页面截图保存在 `.local/issue-tracker-screenshots/row13.png`。 |
| 14 | Canvas runtime/performance | 0.5.3 已降低平移投影；大量元素左右持续滚动、选择操作、帧时序观察；读图确定密度。 |
| 15 | Doca AI native workflows | 新建手机容器后内容真实 `parentId`/native nesting；移动/缩放容器后内容随动，导出/重开/peer；不能以视觉覆盖位置冒充结构嵌套。 |
| 16 | Doca SheetNativeMentions UI + Sheet native rect | 原图是在线表格网格上的3人候选+取消按钮遮挡编辑区域。E10最终包组合1200×620视口A30实测菜单比实际input高6px且完整在视口内，ArrowUp/Enter和重开通过。其他视口/缩放范围不能由这张截图推定。 |
| 17 | Doca AI canvas workflow | E3 部分；读报错图，使用同命令类别生成 UI，错误字段返回准确且整批不部分写入。 |
| 18 | Doca AI image inspection | E3 实模型证据；主模型无视觉时通过配置的图片识别模型，真实图片像素到观察模型、观察到验收模型。读图核对具体提示。 |
| 19 | Doca file-search/navigation | 原图全局搜索文件结果无法跳转。E10最终包组合实际上传文档附图，搜索结果行与来源按钮均关闭搜索并导航到当前same-hash文档，seq不变。 |
| 20 | Doca AI acceptance | 原图要求读真实像素后独立验收，不能以工具回执代替。本轮显式Pro生成的完整照片已由image_view/canvas_view和独立Kimi审核，供应商轨迹证明只调用一次；原UI图特定内容场景仍与照片分开验收。 |
| 21 | Doca app/favicon | E10最终包组合五种无emoji文档favicon与各格式源SVG一致，逐个刷新仍保持，内容零写入。此次检查未把emoji增删额外场景计入通过范围。旧0.2.2站点图标证据不复用。 |
| 22 | Doca AI attachment transport | E3；从画布侧栏上传图片给非视觉模型，主请求不带图片，工具观察能使用图片；错误可重试。 |
| 23 | Sheet filter UI | E7按A1:B5启用native filter后切D8，仅活动单元格框，原图过滤大框不残留；真实复选弹层与后续过滤/重开通过。E1另覆盖删除/重建。 |
| 24 | Canvas connection ports | 0.5.6/E1；12 端口、椭圆/菱形轮廓、resize 后端口、鼠标选指定 port、peer。 |
| 25 | Canvas keyboard | 0.5.6；Cmd+A、Ctrl+A 正常，Ctrl+Cmd+A 不做 canvas select all；rich-text 编辑内仅选文字，宿主其它输入不被劫持。 |
| 26 | Doca AI history/attachment transport | 原图是助手消息和非视觉模型图片错误，归属Doca AI。五场景历史/上传生命周期本轮网站复跑通过；消息缩略图、提交/重开与图片路由独立于scene图片加载。 |
| 27 | Doca AI canvas workflow + Canvas diagram geometry | 原图数据库关系图的video_books旧wrapper外框与内表几何不一致，且显示默认蓝色Frame标题。除E3的12表/13关系及native命令验证，最终需要Canvas旧wrapper实际resize/继续修改/导出；照片生成验收不能代替数据库图质量。 |
| 28 | Canvas rich label/layout | 0.5.6；空文字光标后实际输入、缩放和 viewport 偏移，与 readonly 文字基线一致；读图。 |
| 29 | Canvas rich list/layout | 0.5.6；便签有序列表1/9/10/多行/不同字号，编辑与退出/重开基线一致；读图。 |
| 30 | Canvas connector gesture | 0.5.8/E1；拖动途中连续跟随而非 release 跳变；直/曲/手动折线、zoom/nested、一次 commit、撤销重做、已连接端点不误平移；需动态观察。 |
| 31 | Canvas port gesture | 0.5.6；点击/微抖无连线，超过拖动阈值才出现预览与创建；取消零写入。 |
| 32 | Canvas table handle | 0.5.7；手柄始终表格左上，不因滚动贴视口左上；viewport外与缩放；读图。 |
| 33 | Sheet filter projection | E7当前0.2.7两账号普通单元格和dropdown修改均触发本地/peer隐藏，dropdown撤销/重做及两类刷新通过；接收无echo。 |
| 34 | Sheet 已有协作产品行为 | 当前filter range/criteria共享、cachedFilteredOut派生不协作；E7两账号实际证实共享条件、双方修改与刷新。没有改成个人filter或改变协议/持久语义。 |
| 35 | Doca AI snapshot delivery | 已实际读取原图：请求“将当前画面发我”，结果只有“外部图片”文字，随后请求“导出为PNG”。准确验收是canvas_export真实授权PNG/文件卡片、完整范围、下载和刷新，而不是改为照片生图。另有照片生图需求在行55单列。 |
| 36 | Doca export warning presentation + Canvas font export | 已实际读取原图：黄色 `FONT_NOT_EMBEDDED_SYSTEM_FALLBACK` 提示，并非确认对话框或下载失败。`file-transfer.tsx` 的reportWarnings直接展示SDK message；应核查下载成功、中文可读、系统字体回退限制使用人类可读文案，不能通过隐藏真实保真限制伪装成功。原图页面截图 `.local/issue-tracker-screenshots/row36.png`。 |
| 37 | Canvas view UI | 0.5.7/E1 嵌入菜单已有；最终网站展开 dots/grid/background/outline/minimap，不盖住宿主 AI 入口。 |
| 38 | Doca AI workflow + Canvas model boundary | 原图的失败详情未展开，无法从截图追溯具体tool/cause。ID/字段/整批原子性回归通过不等于所有历史偶发错误根因已证明；新场景需保留完整命令与可展开错误证据。 |
| 39 | Canvas history | 0.5.7/E1；diagram/note/table 拖/resize，undo，等静置/hover后 redo仍可用；连续 undo/redo、peer、重开。 |
| 40 | Canvas mentions async + Doca directory | 0.5.7；输入 @ 即出 loading；慢请求/乱序/取消；选用户后离开文本模式可删除整便签、撤销恢复，Doca ACL 用户候选。 |
| 41 | Canvas wheel/pointer | 0.5.7；滚动经过 port、rich media、table handle 不停止；保留 native 垂直文字滚动；零内容 commit。 |
| 42 | Doca shared image viewer + package callbacks | E1图片gallery；Canvas/Sheet/Slate/Markdown同样缩放/旋转/退出/授权，读/编辑只读；需同屏比较。 |
| 43 | Canvas quick style | 原图同时选中两个图形，快捷线宽/虚线必须同时作用于两者的可见body；与更多面板一致，undo/redo/reopen，不能用单选测试关闭该原图。 |
| 44 | Doca recycle-bin files/folders | 原图files/folders范围已由E8实际网站覆盖：独立清理确认取消、并发恢复导致stale409零部分删除、再次确认全部清理；活动/恢复文件、其他账号和独立文档回收站保留。仅用合成可丢弃数据。 |
| 45 | Doca account/navigation | 浏览器助手入口在MCP后，宽/窄屏图标baseline、active状态；读图。 |
| 46 | Slate/Markdown native preview + Doca viewer | 区分包内图/流程图/思维导图 preview 与 host图库；放大后鼠标拖动、touch/pointer pan、缩放、退出，内容零写入，readonly。包API缺口应上游修而不是DOM补丁。 |
| 47 | Canvas menu + view prefs，Doca scoped storage | 原图菜单被宿主右侧eye/comment按钮覆盖；最终须检查跨宿主overlay stacking。0.5.8背景/grid仅view state，不保留；用户已同意browser/site/account/document隔离的version1偏好，等待最终包API与宿主接入验证。minimap item click已调用revealElements，也须实际验证。 |
| 48 | Doca AI session/resource lifecycle | 合成关联文档删除后旧会话可读/可继续，新建正常；权限撤销仍不暴露旧正文，原消息/附件不被删除。自动删除关联若写历史持久关系需单列兼容方案。 |
| 49 | Doca browser assistant settings | 下载地址醒目；统一方案配置和查看链接，在关闭AI/无权限时保持正确UI；读图。 |
| 50 | Doca browser extension + shared AI UI | 首屏AI、无原生select、真正自定义下拉、收录当前页/AI优化决策、当前页引用、扩展origin标记、宿主配置的方案；这些超出现有E5。用户最终明确保留多方案和一个默认，原“一套”要求已撤回，不实施历史方案迁移/删除。真实 MV3 扩展操作/侧栏宽度/快捷键。 |
| 51 | Doca browser extension content toolbar | 真实来源页选择内容，右下仅小Doca图标、可关闭、展开完整菜单、键盘触发；不遮内容、不破坏原站事件，窄屏和跨滚动。 |
| 52 | Canvas note alignment | 已实际读取原图：黄色空便签的对齐菜单，center/middle已选，红框指向left/top按钮。必须测从center/middle改回left/top，编辑与退出/reload/peer一致；已有TextAlignmentControl本身不证明应用正确。 |
| 53 | Sheet native rich-image interaction + Doca gallery | E1脚本特意 `Escape` 退出编辑再预览，因此**不能证明编辑中第二次点击大图**。最终专测 active cell编辑第一点选图、第二点gallery，拖拽不误打开、双图、readonly。 |
| 54 | Doca route/session UI | 从带session的URL关侧栏，history replace/remove参数，保留其它query，刷新不重开；全屏返回/页面导航/浏览器前后退。 |
| 55 | Doca AI image generation/intention | 两图涉及生图意图、验收与一次uncertain错误。当前显式Pro照片生成/插入/独立审核/PNG交付已通过；UI图片请求不能改成native UI冒充完成。截图缺原job/call/operation，未知计费历史根因不能推断或自动重试；新成功请求不证明旧调用恢复。 |
| 56 | Sheet native local filters | E7当前0.2.7按原图状态排除已解决，dropdown由待解决改已解决后本地/peer立即隐藏，undo恢复、redo再隐藏、reload保留；另测无数据验证的普通输入，由第二账号修改也同步隐藏。 |
| 57 | Doca image collection/gallery API + editor callbacks | E9五格式各有多图导航、原生重复出现位置、授权、只读/历史/回收站证据。Sheet0.2.7含草稿/同格第二图/跨sheet，Slidesalpha4含复用asset的跨页。最终Canvas组合仍须复跑相关范围；gallery不扫描他人图片。 |
| 58 | Doca comment paging UI | 超过页大小合成评论，滚动底部自动加载直到完整；重叠请求去重、锚点滚到未加载评论、resolved/replies、失败重试；不再人工“加载更多”。 |
| 59 | Doca AI oversized image inspection | 原图验收/读取图像失败；宿主允许20MiB而Canvas原生IO只收10MiB。当前合成噪声图及真实10,864,897字节PNG均经限1600px临时预览成功进入image_view/canvas_view/独立审核；保留原bytes并明确细节限制。最终组合复跑，缺图/截断/审查失败不能通过。 |
| 60 | Canvas creation preferences + Doca scoped settings | 用户已同意browser/site/account/document隔离version1偏好，只影响未来交互新建连线/便签的现有native属性。旧元素、显式API/AI对象、导入和远端投影不重写。最终测保存默认、刷新、新建、未知记录保留、双账号双文档隔离和零内容写入。 |

## 需要先明确的持久化与兼容边界

1. **行47/60已获用户同意**：仅同一浏览器，按网站/账号/文档隔离的version1视图与创建偏好，不写CRDT/SQL。无记录保持当前行为且打开不写；未知/无效记录保留，不转换、不覆盖。回滚关闭新偏好读写并保留记录和后续文档写入。Canvas只接实际已发布的受控props/callback，不读取宿主身份、cookies或localStorage。
2. **创建默认的范围**：仅对未来交互新建连线/便签物化现有native属性；旧元素、API/AI显式JSON、导入和远端投影不回填。旧上游提案里的账号page-state或跨画布默认不代表本会话批准结果；最终以coordination.approvedPreferencePolicy为准。
3. **行 34**：当前 filter 是协作共享产品语义。改变为每人独立会修改持久化和协作协议，不能以一个疑问条目自行重设。可先回答当前行为并用两用户页证明。
4. **行 48**：先分析现有session-resource关联与ACL；显示层过滤不可用关联与持久化解除关系不是同一行为。若改变旧会话关系的读取或批量回填，必须列出保留/转换/拒绝和回滚；不可为恢复会话而放松原正文权限。
5. 已发现既有兼容代码：Canvas name-only diagram识别、Sheet虚拟recovery sheet与native默认、AI参数normalization、旧侧栏偏好值读取、旧历史读器。它们由历史约定管理，本次只读审计没有删除、迁移或重设计。

## 最终网站验收执行建议

- 每条最终记录使用原行号，保存 reproduction、实现仓库/commit、npm版本和integrity、Doca依赖pin、测试场景、网页截图/动态证据、结果以及未验证项。问题不能因上游发布或build成功就标完成。
- 先构建最终前端，使用专用空数据库/临时文件store、合成账号和文档，在真实Doca网站验证（可复用 `createApp` + `vite` 的现成脚本）。关闭HMR或使用production build，避免其他会话热更新导致 idle/生命周期测试失真。
- 主要现成入口：`qa-editor-packages-2026-10-20.mts`（port39436）、`qa-ai-history-refresh.mts`（port39428）、`qa-ai-canvas-routing.mts`、`qa-rich-diagrams.cjs`、`qa-browser-clipper.mts` + `qa-browser-clipper-browser.mjs`、`qa-remote-cursor-label.cjs`、`qa-mention-*.cjs`。脚本当前选择器和产物目录应独立，不覆盖历史证据。
- 至少用同账号两个独立标签和另一个账号，受影响操作验证commit/ACK、重开、undo/redo、readonly、无echo；idle/selection/scroll/resize 60秒零内容写入。每个改变的操作类别单独验证。
- 核查报告中 mock vs 真模型：E5 使用 `tests/ai-mock.ts`，E3 用实际配置供应商。最终涉及“生成不符合预期”的项目仍需要真实模型与真实输入/输出图像证据；不能用mock内容质量作为验收。
- 行44和所有协作编辑都只能操作合成文档。用户提供的问题表只能读取，不能作为破坏性或协作测试目标。

## 本机运行/部署事实

- 审计时没有发现 Doca开发服务器监听；4186的cwd为 `/Users/zhangsiwen/dev/slatetsx`，4187为其 `diagram-interaction-fixes` worktree，5188为 `/Users/zhangsiwen/dev/efig`。这些不是本次Doca服务，不应停止。Docker还有7700/8080/18380/18123端口，未检查其数据或更改容器。
- `docs/deployment.md` 规定server/Web一起更新、保留数据库/file volume/master key，使用0.2.7 published image。健康返回只证明进程，不证明editor、AI renderer或当前生产前端版本。
- `.github/workflows/release.yml` 负责tag正式GitHub Release及Web/deploy assets；`release-image.yml`负责原生amd64/arm64构建验证与发布。0.2.7证据说明 Docker Hub发布secrets已删除；未来发布须重新提供，不能假定有发布凭证。
- 尚未验证 `https://doca.heyphp.com` 的部署版本、SSH/部署入口或实际生产功能。后续只读审计使用Chrome既有登录态读取用户指定表格的原截图，补明实际错误、对象和操作界面；未改用户数据或产品代码。
