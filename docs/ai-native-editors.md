# AI 原生画布与演示工具

当前目标：Canvas 0.5.0、Slides 0.3.0-alpha.3。宿主的 `canvas_edit` / `presentation_edit` 使用现有授权、seq/epochId 乐观校验、原生 Yjs 命令、原子验证和 durable ACK；没有第二条 JSON 保存通道。

## 画布

`canvas_edit.operations` 新增宿主工作流，组合已安装组件公开的 `CanvasModel` 命令，未假定组件存在未导出的语义 SDK：

| 命令 | 输入与生成结构 |
| --- | --- |
| `createFlowchart` | id/x/y、带 id/text/x/y/width/height/shape 的 nodes、带 id/sourceId/targetId/mode/可选 label 的 edges；生成 diagram-node/body/label 和绑定端点的 connector |
| `createMindmap` | id/x/y、递归 topic{id,text,children?}、layout=right/left/balanced；生成 mindmap/mind-node/mind-edge，逻辑关系保存在 data.parentId |
| `createTable` | id/x/y、矩形 cells 字符串矩阵、可选完整 columnWidths/rowHeights；生成 board-table/table-cell/原生 Text |
| `createContainer` | id/x/y/containerType/title；phone、tablet、web、wide、standard、a4、section，生成原生 frame 容器 |
| `table` | id 为原生表格分组 ID，command 为下表命令 |

表格行列从 0 开始，区域端点均包含：

| command.kind | 字段 |
| --- | --- |
| cell | row/column/text，明确整格替换 |
| paste | row/column/cells，明确矩形整格替换，先增行列再粘贴 |
| clear / merge / split | range{startRow,endRow,startColumn,endColumn}，必须包含完整合并区域 |
| style | range/style，支持粗斜下划线、字号、文字/背景色、水平/垂直对齐，保留文字和资源 |
| resize | axis=row/column、index、size，单位像素 |
| insert-row / insert-column / delete-row / delete-column | index；不能删除最后一行列，存在合并时先拆分 |

编辑回执和首次读取的 `nativeTables` 提供最终 rows/columns/lastRowIndex/lastTwoRows、合并坐标和有限行预览。新增行后的“末两行”必须按最终 lastTwoRows 验收，不能使用增行前索引。

画布表格最多 100 行、30 列。富文本格合并尚不支持，会明确拒绝，不能清除格式绕过保护。原生表格结构必须走 `table`，直接 add/remove/place 子节点、ungroup 表格或 patch.data 覆盖行列会拒绝；整表移动、删除及基础原生绘图仍可用。

手机为 390×844，tablet 为 820×1180；内容用 `add` 并指定容器 `parentId`，坐标相对父容器。手机顶部 100、底部 30 像素避开设备装饰，平板顶部留 60 像素。图案用原生可编辑 Path/Polygon/Star/Ellipse/Text 等组合。Polygon/Line 的 points 只接受当前原生扁平数字数组或 `{x,y}` 对象数组，不接受嵌套点对；Path 使用 path 字段，SVG 的 d 会明确报错。原生合法的 parentId:null 表示根节点，无输入猜测或转换。

Rect/Ellipse/Star 默认 x/y 为外接矩形左上角。中心为 `(400,400)`、直径 280 的圆应传 `x:260,y:260,width:280,height:280`，不能直接传圆心。文字居中明确提供包围盒和 textAlign；skill 先规划主体边界，再安排五官、装饰和标签。

删除思维主题会递归删除逻辑子主题和相应思维连线；删除根主题移除整张导图。普通未选中连接器保留，仅断开被删除的端点引用。

## 演示文稿

`presentation_edit` 沿用当前原生 controller。新表格的 cell、paste、style、merge、split、clear、resize、单/多行列删除和插入均在工具 schema 与内置 skill 中说明。表格操作使用读取到的稳定 `rowIds` / `columnIds`，拆分用 `merges[].id`；不得混用画布的数字索引。

| 字段 | 单位 |
| --- | --- |
| 元素 transform、读取的文稿 size | EMU，1 CSS 像素 = 9525 EMU |
| pageSize 的 width/height | CSS 像素 |
| padding、paddingInsets、表格 resize size/extent | CSS 像素 |
| fontSize、letterSpacing | pt |

文字修改用限定 slideId/id 的 replaceText；样式用 formatText/paragraphFormat；已有正文不能用 patch.paragraphs 覆盖。原生表格只含纯文本和整格样式，无公式、格内富文本或链接。

## 读取与模型调用

演示 `document_read(slideId,elementId)` 读取单个元素，outline 带表格摘要、稳定行列 ID 和 transform。画布 outline 带 data.kind、主题/连线关系、格坐标和 textLength。完整 data 或正文仍按元素读取，不能用截断预览重建。

模板/素材工具发布对象根 schema，再按原有精确 kind 契约验证。图片工具的坐标和空元组发布为等价数组 schema，保留原有 tuple 验证、长度、范围和几何约束。没有添加旧协议适配、放宽数据校验或修改图片业务规则。

独立 AI 验收通过当前 SDK 的流式接口完整消费模型输出，减少长响应期间网关空闲超时；只读工具、固定快照、完整读取和 submit_review 校验仍沿用原规则。部分响应、截断或未提交有效记录都不能算通过。

## 用户已确认的清理范围

删除画布/PPT 工具的旧参数别名、元素类型猜测、扁平文本重建、缺失 ID/rotation 补写以及像素/EMU 自动判断。当前接口之外的调用明确失败，不自动转换。富文本和电子表格的既有规范化不在本次清理范围内。

画布 schema 1 和旧 checkpoint 保留；PPT v5 沿用拒绝策略，不转换文稿、重写 epoch、历史或待提交更新。没有数据库结构变更。回退保留原部署、依赖和产物，并保留后续数据；旧编辑器不保证能读取新写入。

## 隔离验收入口

`scripts/qa-ai-native-creativity.mts` 使用真实模型、真实 Doca 工具、临时账号、内存 SQLite、临时存储和真实浏览器。默认执行完整 PPT 及修改、流程图、思维导图、画布表格、手机/pad UI、原生矢量图案，每个场景生成后继续定向修改。

```sh
DOCA_QA_ISOLATED=1 \
DOCA_QA_KEY_FILE=/absolute/private/temporary-key-file \
DOCA_QA_MODEL=kimi-k2.7-code \
DOCA_QA_OUTPUT=artifacts/ai-native-creativity/run \
pnpm exec tsx scripts/qa-ai-native-creativity.mts
```

密钥文件由操作者在仓库外创建并限制权限，完成后删除。脚本不保存请求头、密钥或用户数据；模型跟踪、原生投影、真实截图、PPTX 往返和报告写到指定的已忽略 artifacts 目录。可用 `DOCA_QA_CASES=ppt,flowchart,mindmap,table,ui,pattern` 选择场景，用 `DOCA_QA_PORT` 分离独立运行。

独立 AI 验收器当前只验证保存和原生内容；结构检查不能冒充视觉验收。实际画面需另行检查生成的浏览器截图。生产环境、Office/WPS 视觉往返和全部输入法不属于此脚本的验证结论。
