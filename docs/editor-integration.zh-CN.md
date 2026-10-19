# 编辑器集成与文件交换

[English](editor-integration.md)

当前工作区已接入五种编辑器。按安装包真实导出使用接口，目标能力与未实现项不能作为已有 API；详细职责见[接入参考](../skills/doca-editor-integration/references/integration.md)及[协同契约](collaboration-sdk-contract.zh-CN.md)。

## 已安装包与宿主适配

| 格式 | 当前安装包 | 宿主入口 |
| --- | --- | --- |
| 富文本 | @smartdoca/slate 0.4.23 | document-editor.tsx |
| Markdown | @smartdoca/markdown 0.4.3 | markdown-editor.tsx |
| 表格 | @smartdoca/sheet 0.2.4 | spreadsheet-editor.tsx |
| 画布 | @smartdoca/canvas 0.5.6 | canvas-editor.tsx |
| 幻灯片 | @smartdoca/slides 0.3.0-alpha.3 | presentation-editor.tsx |

入口位于 [文档 feature](../apps/web/src/features/documents)。包负责模型、编辑命令、撤销、格式渲染、选择与转换；宿主负责身份、ACL、上传下载、引用、用户卡片、导航、评论和协同连接。语言只影响界面，不翻译用户正文，不重建编辑器。

## 引用、资源与查找

内部文档引用保存稳定 UUID 和 `#/r/{id}` 相对位置；提及保留用户 UUID，候选使用当前用户目录策略。引用及反向引用按当前阅读权过滤，引用本身不授予访问权。

图片、附件和素材使用宿主资源回调。上传进度、取消、错误和迟到回调需绑定原目标；下载通过 `assets/:id/content?download=1` 鉴权，不把物理存储地址当永久引用。

富文本与表格向实际安装包传入稳定的 `onAttachmentPreview` 回调。富文本提供 `AttachmentElement.path/name/mimeType`；表格原生行内附件提供 `event.node.refId/label`。宿主将资产 UUID 解析为鉴权内容端点，打开共用的 `DocumentFilePreview`，只读、历史及回收站视图也接入并保留各自访问参数。富文本编辑模式先点击选中，再点击或使用预览按钮打开；只读模式单击预览。表格点击原生附件标签触发预览，现有整单元格对象渲染仍可用。预览不修改模型、协同会话或持久化格式。

查找替换通过各编辑器的模型或原生能力完成。富文本使用宿主 Slate 模型适配；其他格式使用实际安装包提供的 find/replace 或原生面板。只读、断线及演示状态不提供正文替换。没有通用公开编辑器任意修改句柄，不承诺所有格式具有相同文本范围或正则能力。

## 文件导入导出

| 格式 | 导入 | 导出与限制 |
| --- | --- | --- |
| 富文本 | DOCX、Markdown、PDF | DOCX、Markdown、PDF；复杂布局可能简化，不支持旧 DOC |
| Markdown | Markdown、PDF（转换） | Markdown、PDF；不打包完整离线素材 |
| 表格 | XLSX | XLSX；不支持对象可降级并告警，不承诺完整 Office 保真 |
| 画布 | PNG/JPEG/WebP/SVG 图片素材 | PNG/SVG；导入不恢复原生图层 |
| 幻灯片 | PPTX（最大 30 MB） | PPTX；基础文字、图形、表格和图片，复杂母版/动画可简化，不支持旧 PPT |

导入创建新文档和新谱系，资产重新授权绑定；不覆盖正在编辑的文档。转换警告向用户展示。PDF 导出走浏览器/组件生成链路，不代表完整 Office 排版还原。实现见 [file-transfer.tsx](../apps/web/src/features/documents/file-transfer.tsx)，职责和验收见[文件交换契约](editor-file-exchange-contract.zh-CN.md)。

## 评论与业务扩展

永久锚点与在线光标不同。五种格式按各自协议提供内容评论；表格使用稳定行列 ID 与原生 capture/resolve/reveal 方法，校验结构变化与已删除目标。未知插件元素保留原有不透明数据并展示错误占位，不自动转换或删除。

模板、素材和文档元素由已安装提供者贡献，默认没有提供者。富文本原子行内和表格整单元格插件元素已实现，不提供通用块或表格浮动对象。见[元素契约](plugin-editor-elements.zh-CN.md)和[模板素材](creation-resources.zh-CN.md)。

## 验证范围

升级前核对安装产物的 README、导出类型和 schema；使用隔离文档验证真实文件往返、只读、素材授权、双页同步、回执和重载。不能从单个单元格测试推断全部表格操作收敛，也不能从构建通过推断设备验收完成。早期接入与验收记录保留在[研发资料](research.zh-CN.md)。

## 富文本图块与上传 — 2026-10-10

工具栏通过已安装 0.4.13 的 `commands.insertBlock` 插入完整流程图和思维导图元素，不用 `toggleBlock` 把段落变成缺少图数据的块。图块评论和 AI 引用使用现有整块锚点，不在图内标签里增加用户提及。上传适配器将实际已传输字节转成 `UploadContext.onProgress` 的 0–1 比例；服务端成功前不显示完成，保留原生占位、取消、重试和撤销流程。

AI 修改先读完整图块，不能从大纲标签重建。节点填充、边框、文字颜色分别用 `fillColor`、`color`、`textColor`；连线颜色、粗细用 `color`、`thickness`。自由端点按当前 SDK 使用空 source/target ID 与 `sourcePoint`/`targetPoint` 数值坐标，非空未知 ID 仍拒绝。修改 nodes、edges 或 mindData 时，在同一原生事务中使生成的 SVG 及派生边界失效；仅改显示宽度保留预览。不增加旧格式适配、自动转换或迁移，既有历史读取代码保持原样。

## 已发布表格包对接 — 2026-10-10

宿主 0.1.18 锁定 npm 制品 `@smartdoca/sheet` 0.2.0-rc.19。工具栏「数据验证」与「插入 → 下拉列表」分别使用各自入口。公开声明及 Yjs/model/XLSX 入口与 rc.18 字节一致；宿主继续使用已导出的菜单扩展、资源、稳定锚点和协作 API。宿主同步已导出的 `session.setReadOnly` API，模式切换后绘制前刷新能力快照，不重建工作簿或 Y.Doc。插件元素插入通过原生菜单扩展接入 `SPREADSHEET_MENU_PATHS.toolbarEnd`。这次仅对接界面与制品，不改变 codec、schema、epoch、outbox，不转换持久化数据或新增兼容行为。已有历史读取与显式宿主基线维护命令保持原规则。包与宿主回归使用隔离工作簿和文档，构建成功不代表全部表格操作已完成协作验收。

## Slate 与 Canvas 发布包接入 — 2026-10-13

宿主 0.1.23 锁定 npm 实际产物 `@smartdoca/slate` 0.4.14 与 `@smartdoca/canvas` 0.4.3。Slate codec/Yjs/headless/conversion 字节及公开入口映射不变，Canvas model/IO 字节及公开入口映射不变。DOCX 补丁绑定新版 Slate 产物。宿主保持稳定会话与资源回调，权限、presence、锚点、原始 checkpoint、epoch 和待确认消息 ID 的归属不变。包在视图中重绘过期图形预览，不产生内容写入。

用户明确选择不保证旧流程图兼容；不增加宿主旧节点适配、自动转换、历史字段回填或数据删除。新版图形、实心箭头几何、手动 routeMode/vertices 和端点锚点使用已发布的原生模型，AI 校验与手册接收并保留这些字段。旧编辑器不保证显示新字段，应保留旧部署及升级前备份；宿主数据库回退另按已审定的知识册存储流程执行。原有历史读取与规范化辅助代码仍在原路径，本次不重新设计它们。

隔离宿主回归覆盖原生字段校验、持久与重复 ACK、远端无回声、撤销重做、checkpoint 恢复、画板引擎单例注册及 DOCX 往返。浏览器及最终发行检查写入 0.1.23 验证附件；模型测试不代表已验收每个新版图形手势或全部画板操作。

Canvas 0.4.3 还包含用户已明确同意的视图规则：0.8 到 3 的数值文字行高按字号倍数显示，其他数值仍是像素。加载、选区、尺寸和空闲不回写模型，普通文字编辑保留原数值，仅用户显式修改行高时保存原生百分比值。不增加宿主迁移、回填或存量数据删除。浏览器验收验证 32 px 字号的 1.5 行高显示为 48 px、文字编辑后原数值保留、空闲零写入、双副本同步与重载；回退时不保证旧界面呈现。

## Slate 与表格包升级 — 2026-10-14

当前工作区锁定 npm 实际产物 `@smartdoca/slate` 0.4.15 与 `@smartdoca/sheet` 0.2.1。公开入口映射和依赖不变；Slate codec/Yjs/headless/conversion 字节不变，现有 DOCX 样式补丁绑定 0.4.15。AI 节点校验接收有限数值的 `angle`（度），编辑手册保留该字段。原生图片首次点击选中、再次点击预览，点击其他位置后重新从选中开始。

用户明确同意：CRDT 追加工作表（包括升级前追加的）及虚拟空恢复工作表采用默认行高 18 px、列宽 72 px。不可变 baseline 中已有工作表保留原尺寸字段，缺省字段也不回填；显式行列尺寸继续覆盖默认值。宿主新建工作表同样采用 18/72。此决定只改变投影及默认显示，不回写、转换或删除已有 seed、baseline、checkpoint、epoch、评论和待确认消息 ID。schema 6 与精确协议拒绝规则不变。既有最后工作表的虚拟恢复、历史读取和规范化辅助代码留在原路径，不重新设计。

延续此前已确认的不保证旧流程图兼容，不增加旧节点适配或字段回填。旋转使用已发布原生模型；旧编辑器可能忽略角度，旧表格包可能显示不同默认尺寸。保留上一版 registry 制品、依赖版本、补丁和锁文件用于包回退，服务端和 Web 一起更新；宿主数据库回退另遵循已审定的存储流程。

验收使用真实 rc.19 包生成的不可变样本、隔离宿主数据库和浏览器文档，覆盖原字节保留、已批准尺寸、旋转字段校验/ACK/无回声/撤销/恢复、稳定锚点、只读、文件往返及空闲选区零写入。制品审计及检查结果记录在 `docs/verification/editor-package-upgrade-2026-10-14/report.json`，源码升级记录见[待发布说明](releases/pending-editor-package-upgrade.zh-CN.md)。不据此声称全部图形手势、所有表格操作或原生设备已验收。

## 表格超链接补丁 — 2026-10-15

宿主 0.1.25 锁定实际 npm 制品 `@smartdoca/sheet` 0.2.2。与 0.2.1 相比，公开入口、依赖契约和类型声明不变，Yjs／model／XLSX 运行 JavaScript 字节相同（部分 source map 有差异）。超链接弹窗取消后正确恢复原生草稿，原生移除链接命令沿用 inlineLink 能力及只读检查。宿主继续使用稳定编辑器／会话、资源回调、原生操作和持久 ACK 队列。本补丁不改变 schema 6、不可变 baseline、epoch、checkpoint 或待确认更新身份，不增加数据转换或兼容适配；回退保留原依赖锁定及 lockfile。制品审计和隔离验证记录见 `docs/verification/sheet-package-upgrade-2026-10-15/`。

## 原生编辑器升级 — 2026-10-16

宿主 0.1.27 锁定实际 npm 制品 `@smartdoca/slate` 0.4.18 和 `@smartdoca/sheet` 0.2.3。入口及依赖契约不变，Slate codec/Yjs/headless/conversion 字节与 0.4.15 相同；原 DOCX 补丁内容不变，绑定到 0.4.18。宿主接收新增原生图形、节点／连线样式及可选 `canvasSettings`，AI 命令校验并保留这些字段。原生图示编辑采用新版工作区、纸张自动扩展、焦点草稿 Ctrl/Cmd+S 保存及浮动工具栏选择修复。

用户已明确同意新版 19.8／79.2 默认尺寸和图形行为。新建宿主文档、CRDT 追加工作表（含历史追加表）及虚拟恢复表采用行高 19.8／列宽 79.2 像素。不可变 baseline 原字段及其缺省状态保留，显式行列尺寸保留；不转换 baseline、seed、checkpoint、epoch、序号、待确认消息身份及单元格数据。打开旧图不改写原字段，缺省画布设置仅影响原生视图，明确保存图示才写入新版图形字段／设置。预览重绘仅更新视图。富文本 schema 3、表格 schema 6 和持久 ACK／outbox 语义不变；已有历史读取器及规范化器保留，不重新设计。

回退保留原依赖、lockfile、补丁和部署。旧编辑器可能显示不同默认尺寸／样式或忽略新增字段，不新增历史流程图兼容承诺。恢复时保留后续写入；恢复旧备份会丢失升级后编辑。包含真实已发布 0.1.26 数据库的隔离验证见 `docs/verification/editor-package-upgrade-2026-10-16/`。

## 思维导图工作区升级 — 2026-10-16

宿主 0.1.29 锁定实际 npm 制品 `@smartdoca/slate` 0.4.20，包含 0.4.19 的图形／媒体交互修复。公开入口、依赖和宿主组件／handle 声明不变；codec、Yjs、headless、conversion 运行时代码与 0.4.18 字节相同，原 DOCX 补丁内容不变并绑定到 0.4.20。AI 指导保留完整原生思维导图，包括 `structure`、`theme`、`background`、节点 `fontSize`／`bold` 和 `style:"underline"`。

用户已明确同意新版原生思维导图默认显示作用于已有文档。打开旧图或重新生成版本 6 预览只改变视图，不回写原节点、checkpoint、epoch 或待确认更新身份。工作区打开后不保存关闭不产生内容提交；明确保存才通过现有 Slate/Yjs outbox 与落库 ACK 提交原生草稿和预览。不迁移、不补写历史字段、不新增旧样式适配；现有历史读取及规范化辅助逻辑保留原路径，不重新设计。schema 3 与精确协议检查不变，没有 SQL 变更。

保留 0.1.28 部署、原包制品、版本锁定、补丁和 lockfile 供回退。旧编辑器可能忽略新样式／设置或显示不同默认值。恢复时保留后续写入；恢复升级前备份会丢失其后的编辑。测试只使用隔离的合成文档／数据库；范围及限制见 `docs/verification/slate-workspace-upgrade-2026-10-16/`。

## 三编辑器升级 — 2026-10-17

Doca 固定安装实际 npm 包 `@smartdoca/slate` 0.4.22、`@smartdoca/slides` 0.3.0-alpha.3。Canvas 使用不可变的 `vendor/smartdoca-canvas-0.5.0-75e637df1a75.tgz`：npm 0.5.0 的库构建误删了 Slate 与纯文本内部编辑器注册模块，AidCanvas 源码已通过 sideEffects 声明修复，宿主使用重建产物。这个修复包和源码改动尚未发布 npm。

Slate 新增五页元素配色，进入图形标签编辑时全选文字。codec/Yjs/headless 字节与 0.4.20 一致，原有 DOCX 补丁原样绑定到 0.4.22。Canvas 保持 `aidcanvas-yjs` schema 1；图片和附件回调保存稳定资产 ID，传递真实进度和取消信号，并接入宿主鉴权预览，包括历史、回收站、审计只读视图。服务端校验新增富文本媒体引用属于当前文档。临时画布 presence 完整转发经过校验的相对文字位置和场景鼠标坐标，身份及颜色仍由服务端决定；支持仅鼠标消息，不复用永久评论锚点。

Slides 要求 codec revision 6。客户端与服务端统一严格协商 `eppt-yjs-v6`，文档 schema 2 / protocol 1 不变。用户明确选择**只支持新文稿**：旧 `eppt-yjs-v5` 文稿和旧客户端拒绝打开或接入，原 checkpoint、增量、epoch、历史和待提交消息标识原样保留。不增加旧 codec 读取、编码标识改写、自动转换、迁移或 SQL 结构变更。宿主接受原生文字边距与表格字段；AI 表格命令通过原生 controller 支持合并/拆分、样式、尺寸、清空、粘贴与批量删行列。单元格仍是纯文本加整格样式。

部署时服务端与 Web 必须同步更新。保留旧部署、版本锁定、补丁、锁文件与安装产物；旧程序不承诺读取新功能写入，恢复前须保留后续数据。本次没有修改用户数据库或部署。隔离验收、哈希、截图和边界见 `docs/verification/three-editor-upgrade-2026-10-17/`。


## AI 原生画布和演示工作流 — 2026-10-17

宿主 AI 画布工具通过已安装 Canvas 0.5.0 的公开 `CanvasModel` 命令组合实现 `createFlowchart`、`createMindmap`、`createTable`、`createContainer`，生成原生 schema-1 场景；`table` 通过 `applyScene` 执行有界的零基单元格、区域、行列和尺寸操作。这是宿主 AI 工作流，不是新增的组件 SDK 导出。基础原生绘图仍可使用；禁止通过直接增删/放置表格子节点、解组或覆盖元数据绕过表格结构命令。删除逻辑思维主题时递归删除后代与思维连线，保留普通连接器并断开已删除引用。

演示工具沿用 Slides 0.3.0-alpha.3 原生 controller 及 revision-6 表格操作。元素 transform 和文稿 size 使用 EMU，pageSize、文字 padding/paddingInsets、表格 resize 使用 CSS 像素，字号和字间距使用 pt。演示局部读取支持 slideId+elementId；outline 返回表格稳定行列 ID、预览与几何，画布返回语义类型、关系、格坐标与文字长度。

用户明确同意删除画布/PPT 工具的旧参数别名、自动元素猜测、扁平文字重建与像素/EMU 自动判断；旧调用形状明确拒绝，失败不写入。不转换现有场景、不增加历史读取器、不改画布 schema 或已有 Slides codec 拒绝规则，不重写 checkpoint、epoch、历史及待提交消息身份。无关的富文本/电子表格输入规范化保持原路径。回退保留旧部署和依赖产物，恢复前保留后续写入，旧组件不保证理解新写入。工具契约与隔离验收入口见 `docs/ai-native-editors.md`。


AI 读取/编辑回执补充有界的当前原生表格事实，包括最终行列数、末行索引及合并矩形；结构修改后的区域验收按最终坐标核对。Polygon/Line 的点使用当前组件声明的扁平数字数组或点对象数组，嵌套点对明确拒绝；Path 使用 path，不接受 SVG 的 d。错误回执指出实际字段，不增加别名或隐式转换。根节点 add 接受当前模型原生的 parentId:null。

## Canvas 0.5.2 正式包对接 — 2026-10-17

Doca 0.1.31 锁定正式 npm 包 `@smartdoca/canvas` 0.5.2，替代上文临时 0.5.0 tarball；临时包退出运行依赖和构建路径，上一源代码快照保留恢复依据。公开导出、依赖和声明签名相同，声明差异只有一处表格布局注释；模型运行代码逐字节一致。不增加历史读取器、原场景转换、字段补写、codec/schema 变更或 checkpoint/outbox 替换。

新包修复连续中文输入、平移缩放时工具条跟随，并按内容撑高表格行。文字与行几何通过同一原生协同撤销事务保存。宿主继续使用稳定模型、已认证资源与 presence 回调、持久化 ACK 队列。源码、浏览器、镜像及发布证据位于 `docs/verification/release-0.1.31/`；此前 0.5.0 记录保留为当时的验收依据，不代表 0.5.2 全部操作均已验证。

## Canvas 附件预览回调 — 2026-10-18 / Canvas 0.5.3

AidCanvas 源码新增可选 `CanvasEditorProps.onAttachmentPreview(resource: CanvasResource): void | Promise<void>`，沿用 slatetsx 的宿主预览命名。独立附件、富文本内附件和文件工具栏共用此回调；每次点击读取最新 props。附件优先调用它，未提供时调用现有 `onResourcePreview`；图片继续调用 `onResourcePreview`。同步异常和 Promise 失败交给 `onError`。预览只传稳定资源元数据，不解析地址、不写内容或触发协同事务；下载仍由宿主 `resources.resolveDownloadUrl` 鉴权。只读允许这些宿主操作。

此可选 API 已随 [`@smartdoca/canvas` 0.5.3](https://www.npmjs.com/package/@smartdoca/canvas/v/0.5.3) 发布，之前的 0.5.2 类型声明不包含它。公开 tarball 与已测试的 Node 22/npm 10 产物逐字节一致；隔离 React 18 宿主的公共类型检查和四项浏览器场景通过，覆盖最新回调、异常、只读鉴权、对端内容不变及窄屏文件工具栏跟随。Canvas 演示和示例宿主接入；生产 Doca 保持已安装的 0.5.2 包和既有适配器。本轮未修改 Doca 运行时、依赖锁、资产权限、schema、codec、checkpoint 或传输；后续升级产物和适配需要单独验收。

## Canvas inline integration and Slate upgrade — 2026-10-18

Doca 0.1.32 pins the published Slate 0.4.23 and the published registry artifact `@smartdoca/canvas` 0.5.4, which includes Canvas 0.5.3. Slate public declarations, codec/Yjs/headless/conversion bytes match 0.4.22; the identical DOCX patch is rebound. The owner approved current Leafer mind-map display defaults for existing maps. Open/close and preview regeneration remain view-only; explicit save uses the native tree.

Canvas `richTextExtensions` now supports `inline:true`, optional `suggestions:{trigger,search(query,{signal})}` and `matchPaste`/`paste(text,{signal})`. Inline nodes store `{type:'inline',inline:{id,type,label,data},children:[{text:''}]}` in schema-1 rich paragraphs and one U+FFFC marker in native text. The package owns selection, live insertion ranges, debouncing, menu keys, atomic clipboard/deletion/undo, label rendering/export and unknown opaque JSON. Doca supplies directory/ACL checks, user cards, stable reference UUIDs, same-origin document title lookup, notifications and reference indexing. Pending lookup/paste, UI and resolved URLs remain view state. Closed/deleted/readonly targets cannot accept late insertion. Formatting and inline metadata retain existing whole-field LWW semantics.

Active and readonly/history/trash/audit surfaces supply stable `onAttachmentPreview` callbacks to the shared authorized viewer; images retain `onResourcePreview`, and download URLs remain host-authorized. No new transport, autosave, schema/codec, DDL, migration, backfill, historical adapter or epoch/checkpoint/outbox rewrite is introduced. The owner approved no older-client rendering guarantee for new inline metadata. Preserve existing and later data and retain the 0.1.31 deployment, pins, patch and lockfile for recovery. Verification is recorded in `docs/verification/release-0.1.32/` and the native Canvas browser tests; no user documents or databases are used.


## Canvas 0.5.5 host integration — 2026-10-18

Doca 0.2.1 pins the official npm `@smartdoca/canvas` 0.5.5. This patch removes the rich paragraph menu's code-block action and scopes inline/suggestion CSS under the canvas root. Public exports, dependencies, declarations, model and codec remain unchanged from 0.5.4. The host continues the existing inline and resource callbacks; this integration adds no adapter, persisted-format conversion, history rewrite or new compatibility behavior. The title/emoji and access-tag changes are host presentation only. Published-package hashes and isolated browser/image checks are recorded in `docs/verification/release-0.2.1/`.

## Canvas 0.5.6 与 Sheet 0.2.4 对接 — 2026-10-20

当前代码锁定正式 npm 包 `@smartdoca/canvas` 0.5.6、`@smartdoca/sheet` 0.2.4。公开入口及宿主使用的声明不变；Canvas model 和 Sheet model/Yjs/XLSX 与上一版逐字节一致。Canvas 私有渲染声明和 IO 分包引用有变化；Sheet 将已有 0.25.1 运行时的 `@univerjs/drawing-ui`、`@univerjs/sheets-filter` 声明为直接依赖。

用户明确同意上游对旧图形的视图规则：包含 diagram-body、仅有 frame/diagram-node 名称且没有冲突 kind/显式容器角色的包装识别为图形，隐藏重复外框填充/描边和生成的 Frame 标题，并令图形、文字尺寸跟随包装；显式容器和无形状名的自定义路径保留其角色与轮廓。已有椭圆/菱形端点按新轮廓显示，原四个中点端口索引不变并新增八个端口。打开、选中、视口变化和关闭不得回写原模型/checkpoint；显式缩放或编辑通过原生协同事务与撤销栈保存。不批量转换、不补字段、不变更 DDL、schema/codec、epoch、checkpoint 或待确认消息身份。Canvas 保持 aidcanvas-yjs/schema 1，Sheet 保持 exlsx-cell-registers/schema 6，未知版本继续精确拒绝。

Canvas 图片先选中再预览；复制 PNG 像素通过宿主 resolveDownloadUrl 鉴权，阅读模式也可用。历史/回收站预览保留原有访问参数，服务端仍拒绝不支持的审计资源访问。Sheet 使用包内原生筛选渲染及当前内联图片几何/预览，不修复传入的文档数据。资产 UUID、ACL、临时 presence、永久锚点、持久 ACK 和原 update 保持原归属。已有历史读取器、虚拟工作表恢复、规范化代码和已批准显示默认值仅审计，不扩展其兼容行为。

回退依据为原 Canvas 0.5.5 / Sheet 0.2.3 制品、依赖和锁文件（源码提交 589a3589820770d218bea418fe7c93cd10583f95）；制品身份见 docs/verification/editor-packages-2026-10-20/package-audit.json。服务端与 Web 一起更新，回退前保留后续写入，不承诺旧界面与新图形行为一致。验证只使用隔离数据库/文档，未部署；通过项目及未覆盖范围见[接入验证](verification/editor-packages-2026-10-20/README.md)。
