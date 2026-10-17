import { z } from "zod";
import { canvasWorkflowSchemas, canvasTableCommand } from "./canvas-workflows.js";
import { CANVAS_ELEMENT_PROPERTIES } from "@smartdoca/canvas/model";
import { fail } from "../../shared/errors.js";
import {
  spreadsheetColor,
  validateSpreadsheetCellMatrix,
} from "./spreadsheet-cell-style.js";

export const documentFormats = [
  "rich_text",
  "markdown",
  "canvas",
  "presentation",
  "spreadsheet",
] as const;
export type DocumentFormat = (typeof documentFormats)[number];
const id = z.string().min(1).max(200),
  ids = z.array(id).min(1).max(1000);
const index = z.number().int().nonnegative(),
  count = z.number().int().positive().max(10000);
const json = z.record(z.string(), z.unknown());
const optionalId = id.optional();
const position = { parentId: optionalId, afterId: optionalId };
const op = (type: string, fields: z.ZodRawShape = {}) =>
  z.strictObject({ type: z.literal(type), ...fields });
export const richBlockTypes = [
  "paragraph",
  "code-block",
  "formula",
  "divider",
  "image",
  "video",
  "attachment",
  "card",
  "table",
  "table-row",
  "table-cell",
  "columns",
  "column",
  "flowchart",
  "mindmap",
  "link",
] as const;
const block = z
  .object({ id, type: z.enum(richBlockTypes), children: z.array(json).min(1) })
  .catchall(z.unknown());
const canvas = z
  .object({
    id: optionalId,
    tag: z.enum([
      "Rect",
      "Ellipse",
      "Text",
      "Image",
      "Line",
      "Arrow",
      "Path",
      "Polygon",
      "Star",
      "Group",
      "Frame",
    ]),
  })
  .catchall(z.unknown());
const pptKinds = [
  "text",
  "line",
  "table",
  "chart",
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "rtTriangle",
  "diamond",
  "parallelogram",
  "trapezoid",
  "pentagon",
  "hexagon",
  "octagon",
  "plus",
  "star5",
  "star6",
  "star8",
  "heart",
  "teardrop",
  "wedgeRectCallout",
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "leftRightArrow",
  "chevron",
  "homePlate",
] as const;
const pptElement = z
  .object({
    id,
    type: z.enum(["text", "shape", "image", "line", "table", "chart"]),
    transform: z.strictObject({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      rotation: z.number(),
    }),
  })
  .catchall(z.unknown());
const textEdit = { index, deleteCount: index, text: z.string() };
const textStyle = z.strictObject({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  code: z.boolean().optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
});
const table = { tableId: id };
const range = z.strictObject({
  sheetId: id,
  startRow: index,
  endRow: index,
  startColumn: index,
  endColumn: index,
});
const floatBase = {
  id: optionalId,
  anchor: range,
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
};
const schemas = {
  markdown: z.union([op("append", { text: z.string() }), op("text", textEdit)]),
  rich_text: z.union([
    op("append", { text: z.string() }),
    op("text", { blockId: id, ...textEdit }),
    op("link", {
      blockId: id,
      index,
      length: count,
      url: z.string().min(1).max(2000),
    }),
    op("formatText", {
      blockId: id,
      index,
      length: count,
      style: textStyle,
      unset: z.array(z.string()).optional(),
    }),
    op("insertBlock", { ...position, block }),
    op("setBlock", {
      blockId: id,
      properties: json,
      unset: z.array(z.string()).optional(),
    }),
    op("moveBlock", { blockId: id, ...position }),
    op("deleteBlock", { blockId: id }),
    op("insertTable", { rows: count, columns: count, ...position }),
    op("insertColumnsLayout", {
      count: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      ...position,
    }),
    ...["insertRows", "insertColumns"].map((t) =>
      op(t, {
        ...table,
        count,
        referenceId: optionalId,
        side: z.enum(["before", "after"]).optional(),
      }),
    ),
    ...["deleteRows", "deleteColumns"].map((t) => op(t, { ...table, ids })),
    op("merge", { ...table, rowIds: ids, columnIds: ids }),
    op("split", { ...table, mergeIds: ids }),
    ...["resizeRow", "resizeColumn"].map((t) =>
      op(t, { ...table, id, size: z.number().positive() }),
    ),
    op("setCellStyle", {
      ...table,
      cellIds: ids,
      style: z.strictObject({
        align: z.enum(["left", "center", "right"]).optional(),
        verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
        backgroundColor: z.string().optional(),
      }),
    }),
    op("setTextStyle", {
      ...table,
      cellIds: ids,
      style: textStyle,
      unset: z.array(z.string()).optional(),
    }),
    op("clearCells", { ...table, cellIds: ids }),
    op("setCellContent", {
      ...table,
      cellId: id,
      children: z.array(block).min(1),
    }),
    op("paste", { ...table, rowId: id, columnId: id, payload: json }),
    op("deleteTable", table),
    op("insertColumn", {
      layoutId: id,
      columnId: id,
      side: z.enum(["before", "after"]),
    }),
    op("deleteColumn", { layoutId: id, columnId: id }),
  ]),
  canvas: z.union([
    op("add", { element: canvas, parentId: id.nullable().optional() }),
    op("patch", { id, patch: json }),
    op("remove", { ids }),
    op("place", {
      id,
      parentId: id.nullable().optional(),
      beforeId: optionalId,
    }),
    op("group", { ids }),
    op("ungroup", { id }),
    op("text", { id, ...textEdit }),
    ...canvasWorkflowSchemas,
  ]),
  presentation: z.union([
    op("addSlide", { after: optionalId, slide: json.optional() }),
    op("deleteSlide", { slideId: id }),
    op("insert", { slideId: id, element: pptElement }),
    op("add", { slideId: id, kind: z.enum(pptKinds) }),
    op("patch", { slideId: id, id, patch: json }),
    op("remove", { slideId: id, ids }),
    op("moveSlide", { slideId: id, before: id.nullable().optional() }),
    op("slideProperty", {
      slideId: id,
      field: z.enum(["background", "notes", "name"]),
      value: z.string(),
    }),
    op("align", {
      slideId: id,
      ids,
      axis: z.enum(["left", "center", "right", "top", "middle", "bottom"]),
    }),
    op("table", {
      slideId: id,
      id,
      command: z.union([
        z.strictObject({
          kind: z.literal("cell"),
          row: id,
          column: id,
          value: z.string(),
          expected: z.string().optional(),
        }),
        z.strictObject({
          kind: z.enum(["insert-row", "insert-column"]),
          after: id.nullable(),
        }),
        z.strictObject({
          kind: z.enum(["delete-row", "delete-column"]),
          target: id,
        }),
        z.strictObject({
          kind: z.enum(["delete-rows", "delete-columns"]),
          targets: ids,
        }),
        z.strictObject({
          kind: z.enum(["clear", "merge"]),
          rows: ids,
          columns: ids,
        }),
        z.strictObject({ kind: z.literal("split"), targets: ids }),
        z.strictObject({
          kind: z.literal("style"),
          rows: ids,
          columns: ids,
          style: json,
        }),
        z.strictObject({
          kind: z.literal("resize"),
          axis: z.enum(["row", "column"]),
          sizes: z
            .array(
              z.strictObject({
                target: id,
                size: z.number().min(1).max(100000),
              }),
            )
            .min(1)
            .max(100),
          extent: z.number().min(1).max(100000).optional(),
        }),
        z.strictObject({
          kind: z.literal("paste"),
          row: id,
          column: id,
          payload: json,
        }),
      ]),
    }),
    op("replaceText", {
      query: z.string().min(1),
      text: z.string(),
      slideId: optionalId,
      id: optionalId,
    }),
    op("formatText", { slideId: id, ids, marks: json }),
    op("paragraphFormat", { slideId: id, ids, format: json }),
    op("pageSize", {
      width: z.number().min(100).max(10000),
      height: z.number().min(100).max(10000),
    }),
    op("distribute", {
      slideId: id,
      ids,
      axis: z.enum(["horizontal", "vertical"]),
    }),
    op("arrange", {
      slideId: id,
      ids,
      action: z.enum(["front", "back", "forward", "backward"]),
    }),
    ...["group", "ungroup", "duplicate"].map((t) =>
      op(t, { slideId: id, ids }),
    ),
    op("duplicateSlides", { ids }),
    op("setSlidesHidden", { ids, hidden: z.boolean() }),
    op("createSection", { name: id, ids }),
    op("renameSection", { id, name: id }),
    op("deleteSection", { id }),
    op("assignSection", { ids, sectionId: id.nullable() }),
  ]),
  spreadsheet: z.union([
    op("cells", {
      sheetId: id,
      cells: z.record(
        z.string().regex(/^\d+$/),
        z.record(z.string().regex(/^\d+$/), json.nullable()),
      ),
    }),
    op("structure", {
      edit: z.strictObject({
        sheetId: id,
        axis: z.enum(["row", "column"]),
        action: z.enum(["insert", "delete"]),
        index,
        count,
      }),
    }),
    op("mutation", { id, params: json }),
    op("putFloatingObject", {
      input: z.union([
        z.strictObject({
          ...floatBase,
          kind: z.literal("image"),
          assetId: id,
          name: z.string(),
        }),
        z.strictObject({
          ...floatBase,
          kind: z.literal("chart"),
          type: z.enum(["line", "column", "bar", "pie"]),
          title: z.string(),
          source: range,
          colors: z.array(z.string()).optional(),
        }),
      ]),
    }),
    op("updateFloatingGeometry", {
      id,
      patch: z.strictObject({
        offsetX: z.number().optional(),
        offsetY: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      }),
    }),
    op("removeFloatingObject", { id }),
  ]),
};

const wireOperation = z
  .object({
    type: z.string().min(1).max(60),
    sheetId: z.string().min(1).max(200).optional(),
    sheet: z.string().min(1).max(200).optional(),
    sheetName: z.string().min(1).max(200).optional(),
    cells: z.any().optional(),
    values: z.any().optional(),
    data: z.any().optional(),
    edit: z.any().optional(),
    id: z.string().optional(),
    params: z.any().optional(),
    input: z.any().optional(),
    patch: z.any().optional(),
    text: z.string().optional(),
    blockId: z.string().optional(),
    block: z.any().optional(),
    element: z.any().optional(),
  })
  .passthrough();

const wireCells = z
  .union([
    z
      .array(
        z
          .object({
            row: index,
            column: index,
            v: z
              .union([z.string(), z.number(), z.boolean(), z.null()])
              .optional(),
            f: z.string().nullable().optional(),
            s: z
              .object({
                bg: spreadsheetColor
                  .nullable()
                  .optional()
                  .describe('背景色，例如 {rgb:"#FFCC00"}；null 清除背景色'),
                cl: spreadsheetColor
                  .nullable()
                  .optional()
                  .describe('文字颜色，例如 {rgb:"#333333"}'),
                bl: z.number().optional(),
                n: z.object({ pattern: z.string() }).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
    z.record(z.string(), z.record(z.string(), json.nullable())),
  ])
  .describe(
    '必须提供实际单元格数据。优先使用 [{row:0,column:0,v:"表头"},{row:1,column:0,f:"=SUM(B2:B4)"}]。只改背景用 [{row:0,column:0,s:{bg:{rgb:"#FFCC00"}}}]，省略 v/f 可保留文字和公式。零基坐标，禁止 null 或空数组。',
  );

const presentationTableSchema = schemas.presentation.options.find(
  (schema) => schema.shape.type.value === "table",
)!;
const presentationWireFields = {
  slideId: z.string().min(1).max(200).optional(),
  after: z.string().min(1).max(200).optional(),
  before: z.string().min(1).max(200).nullable().optional(),
  slide: z.any().optional(),
  kind: z.string().min(1).max(40).optional(),
  ids: z.array(z.string().min(1).max(200)).max(1000).optional(),
  marks: z.any().optional(),
  query: z.string().optional(),
  field: z.string().min(1).max(40).optional(),
  value: z.any().optional(),
  command: (presentationTableSchema.shape as any).command.optional(),
  axis: z.string().min(1).max(20).optional(),
  format: z.any().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  hidden: z.boolean().optional(),
  name: z.string().max(200).optional(),
  sectionId: z.string().min(1).max(200).nullable().optional(),
  action: z.string().min(1).max(20).optional(),
};

// Publish the native shape without moving execution checks ahead of the existing
// normalization boundary. validateEditOperations remains the authoritative check.
const { $schema: _nativeBlockSchema, ...nativeBlockParameters } =
  block.toJSONSchema();
const nativeBlockWire = z.any().meta(nativeBlockParameters);
const richTextWireFields = {
  type: wireOperation.shape.type.describe(
    "每种命令只传该命令允许的字段。insertBlock 只用 type、block、parentId、afterId，不能带 blockId；insertTable 只用 type、rows、columns、parentId、afterId，不能带 table、tableId、cells。",
  ),
  blockId: wireOperation.shape.blockId.describe(
    "已有文字或块的 ID，仅 text、link、formatText、setBlock、moveBlock、deleteBlock 使用。insertBlock 新节点的 ID 放在 block.id，不能传本字段。",
  ),
  block: nativeBlockWire
    .optional()
    .describe(
      'insertBlock 的原生节点对象，例如 {id:"新唯一ID",type:"paragraph",title:"h2",children:[{text:"章节标题"}]}，不能传 JSON 字符串。',
    ),
  parentId: optionalId.describe("结构命令的已读取父容器 ID，可省略"),
  afterId: optionalId.describe(
    "结构命令插入在此块后；可用本批前面新插入的 block.id",
  ),
  rows: count.optional().describe("insertTable 行数，顶层正整数"),
  columns: count.optional().describe("insertTable 列数，顶层正整数"),
  tableId: optionalId.describe(
    "已有表格命令的表 ID，必须从 document_read 获取；insertTable 不允许此字段",
  ),
  cellId: optionalId.describe(
    "setCellContent 的真实单元格 ID，取 outline 的 cells[].id",
  ),
  children: z
    .array(nativeBlockWire)
    .optional()
    .describe(
      'setCellContent 的原生块数组，每个块必填新唯一 id、type、children。例如 [{id:"新唯一ID",type:"paragraph",children:[{text:"内容"}]}]。不要把 required 等 JSON Schema 字段放进节点；insertBlock 的 children 应放在 block 内。',
    ),
  index: index.optional(),
  deleteCount: index.optional(),
  length: count.optional(),
  url: z.string().optional(),
  properties: z
    .any()
    .optional()
    .describe("setBlock 的属性对象，不能更换 id 或 children"),
  style: z.any().optional(),
  unset: z.array(z.string()).optional(),
  count: count.optional(),
  referenceId: optionalId,
  side: z.enum(["before", "after"]).optional(),
  ids: ids.optional(),
  cellIds: ids.optional(),
  rowIds: ids.optional(),
  columnIds: ids.optional(),
  mergeIds: ids.optional(),
  size: z.number().positive().optional(),
  rowId: optionalId,
  columnId: optionalId,
  payload: z.any().optional(),
  layoutId: optionalId,
};

export function editToolSchema(format: DocumentFormat) {
  const operation =
    format === "spreadsheet"
      ? wireOperation.extend({ cells: wireCells.optional() })
      : format === "presentation"
        ? wireOperation.extend(presentationWireFields)
        : format === "rich_text"
          ? wireOperation.extend(richTextWireFields)
          : format === "canvas"
            ? wireOperation.extend({
                x: z.number().optional(), y: z.number().optional(),
                parentId: z.string().nullable().optional(), beforeId: optionalId,
                ids: ids.optional(), index: index.optional(), deleteCount: index.optional(),
                nodes: z.array(z.any()).optional(), edges: z.array(z.any()).optional(),
                topic: z.any().optional(), layout: z.enum(["right", "left", "balanced"]).optional(),
                containerType: z.enum(["phone", "tablet", "web", "wide", "standard", "a4", "section"]).optional(),
                title: z.string().optional(), columnWidths: z.array(z.number()).optional(), rowHeights: z.array(z.number()).optional(),
                command: canvasTableCommand.optional(),
              })
            : wireOperation;
  // Keep union checks out of the wire schema: Mastra reports those as a bare
  // "Invalid input". Named fields still have to be listed, otherwise providers
  // drop sheetId/cells or slideId and the model only retries with type.
  return z
    .object({
      resourceId: z.string().uuid(),
      seq: index,
      epochId: id,
      sheetId: z.string().min(1).max(200).optional(),
      cells: (format === "spreadsheet" ? wireCells : z.any()).optional(),
      operations: z
        .array(operation)
        .min(1)
        .max(80)
        .describe(
          '直接传 JSON 对象数组，例如 [{type:"append",text:"正文"}]，不能将数组序列化成带引号的字符串。80 限制的是操作数量，不是字符数；类型错误时应修正数组形状，不能靠缩短正文解决。',
        ),
    })
    .passthrough();
}
const fields: Record<string, string[]> = {
  paragraph: ["title", "list", "checked", "quote", "indentation", "listOrder"],
  "code-block": ["language", "code"],
  formula: ["source"],
  image: ["path", "alt", "width", "caption", "showCaption", "displayStyle"],
  video: ["path", "name", "mimeType", "width"],
  attachment: ["name", "path", "size", "mimeType"],
  card: ["color", "icon"],
  table: ["columns", "merges"],
  "table-row": ["height"],
  "table-cell": ["rowId", "columnId", "backgroundColor", "verticalAlign"],
  columns: ["showDividers"],
  column: ["width"],
  link: ["url"],
  flowchart: [
    "width",
    "aspectRatio",
    "nodes",
    "edges",
    "canvasSettings",
    "contentWidth",
    "contentHeight",
    "previewSvg",
    "previewVersion",
  ],
  mindmap: [
    "width",
    "aspectRatio",
    "mindData",
    "contentWidth",
    "contentHeight",
    "previewSvg",
    "previewVersion",
  ],
};
const diagramTextStyle = {
  fontFamily: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
};
const diagramNodeStyle = z.object({
  ...diagramTextStyle,
  aspectRatioLocked: z.boolean().optional(),
  rounded: z.boolean().optional(),
  shadow: z.boolean().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
});
const diagramMarker = z.enum([
  "none",
  "classic",
  "block",
  "open",
  "diamond",
  "circle",
]);
const diagramEdgeStyle = z.object({
  ...diagramTextStyle,
  textColor: z.string().optional(),
  parentId: id.optional(),
  lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
  lineJump: z.enum(["none", "arc", "gap", "cubic"]).optional(),
  jumpSize: z.number().nonnegative().optional(),
  arrowSize: z.number().nonnegative().optional(),
  sourceArrowSize: z.number().nonnegative().optional(),
  targetArrowSize: z.number().nonnegative().optional(),
  sourceOffset: z.number().optional(),
  targetOffset: z.number().optional(),
  sourceArrow: diagramMarker.optional(),
  targetArrow: diagramMarker.optional(),
  labelPosition: z.number().optional(),
});
const diagramCanvasSettings = z.strictObject({
  view: z
    .strictObject({ zoom: z.number().positive(), x: z.number(), y: z.number() })
    .optional(),
  grid: z.boolean().optional(),
  gridSize: z.number().positive().optional(),
  pageView: z.boolean().optional(),
  paper: z.enum(["a4", "a3", "letter"]).optional(),
  landscape: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  connectionArrows: z.boolean().optional(),
  connectionPoints: z.boolean().optional(),
  guides: z.boolean().optional(),
  minimap: z.boolean().optional(),
});
const assert = (ok: unknown, message: string) => {
  if (!ok) fail(400, message);
};
// Same URL policy as the editor's insertLink: http(s)/mailto/tel/site paths only.
export const LINK_URL_PATTERN = /^(https?:\/\/|mailto:|tel:|\/|#)/i;
export function assertLinkUrl(url: unknown) {
  assert(
    typeof url === "string" && url.length <= 2000 && LINK_URL_PATTERN.test(url),
    "链接必须是 http(s)、mailto、tel 或站内地址",
  );
}
export function validateRichNode(
  node: any,
  seen = new Set<string>(),
  depth = 0,
) {
  assert(
    depth < 64 && node && typeof node === "object" && !Array.isArray(node),
    "富文本节点结构无效",
  );
  if (typeof node.text === "string" && node.type === undefined) {
    assert(
      Object.keys(node).every((k) => k === "text" || k in textStyle.shape),
      "文字叶子包含未知属性",
    );
    const { text: _, ...style } = node;
    assert(textStyle.safeParse(style).success, "文字样式值无效");
    return;
  }
  assert(
    richBlockTypes.includes(node.type),
    `不支持富文本类型 ${String(node.type)}；代码块必须用 code-block，code 保存源码，children:[{text:""}]`,
  );
  assert(
    typeof node.id === "string" && node.id && !seen.has(node.id),
    "块 ID 缺失或重复",
  );
  seen.add(node.id);
  const allowed = new Set([
    "id",
    "type",
    "align",
    "children",
    ...(fields[node.type] ?? []),
  ]);
  const unknownProperties = Object.keys(node).filter((k) => !allowed.has(k));
  const diagramStyleHint =
    node.type === "flowchart"
      ? "；配色写在 nodes 中：fillColor=填充、color=边框、textColor=文字，连线颜色写在 edges[].color，不在图块顶层写 style/color/backgroundColor"
      : "";
  assert(
    !unknownProperties.length,
    `${node.type} 包含未知属性 ${unknownProperties.join("、")}，请遵循原生元素格式${diagramStyleHint}`,
  );
  assert(
    Array.isArray(node.children) && node.children.length,
    "块必须包含 children",
  );
  if (node.type === "code-block") {
    assert(
      typeof node.code === "string",
      "code-block 必须把源码放在 code 字符串，不能放在 children 中",
    );
    assert(
      node.children.length === 1 && node.children[0].text === "",
      'code-block 的 children 必须是 [{text:""}]',
    );
    assert(
      node.language === undefined || typeof node.language === "string",
      "代码语言必须是字符串",
    );
  }
  if (["image", "video", "attachment"].includes(node.type))
    assert(
      typeof node.path === "string" && node.path,
      "媒体元素必须使用已授权资源 path",
    );
  if (node.type === "formula")
    assert(typeof node.source === "string", "公式必须提供 source");
  if (node.type === "link") assertLinkUrl(node.url);
  if (node.type === "flowchart") {
    assert(
      Array.isArray(node.nodes) && Array.isArray(node.edges),
      "流程图必须提供 nodes 和 edges",
    );
    assert(
      node.canvasSettings === undefined ||
        diagramCanvasSettings.safeParse(node.canvasSettings).success,
      "流程图 canvasSettings 必须使用原生画布设置",
    );
    const shapes = new Set(
      "cube chevron trapezoid callout folder crescent circle ellipse triangle hexagon pentagon octagon star cross cloud server browser swimlane rectangle block-arrow process decision terminator database document multiple-documents data subprocess manual-input preparation delay display storage connector off-page-connector merge card paper-tape actor use-case class object interface component package state activity lifeline boundary control entity group note text mind-topic".split(
        " ",
      ),
    );
    const nodeIds = new Set<string>();
    for (const n of node.nodes) {
      assert(
        diagramNodeStyle.safeParse(n).success,
        "流程图节点样式必须使用原生字段值",
      );
      assert(
        n &&
          typeof n.id === "string" &&
          n.id &&
          !nodeIds.has(n.id) &&
          typeof n.label === "string" &&
          Number.isFinite(n.x) &&
          Number.isFinite(n.y),
        "流程图节点需要唯一 id、label 和数值坐标",
      );
      assert(
        n.shape === undefined || shapes.has(n.shape),
        `未知流程图节点形状 ${n.shape}`,
      );
      assert(
        n.angle === undefined ||
          (typeof n.angle === "number" && Number.isFinite(n.angle)),
        "angle 必须为有限数值角度",
      );
      assert(
        n.arrowDirection === undefined ||
          ["right", "down", "left", "up"].includes(n.arrowDirection),
        "未知实心箭头方向",
      );
      assert(
        n.arrowRoute === undefined ||
          ["straight", "elbow", "step"].includes(n.arrowRoute),
        "未知实心箭头路径",
      );
      for (const field of ["arrowThickness", "arrowHeadSize"])
        assert(
          n[field] === undefined ||
            (typeof n[field] === "number" &&
              Number.isFinite(n[field]) &&
              n[field] > 0),
          `${field} 必须为正数像素值`,
        );
      assert(
        n.arrowBend === undefined ||
          (typeof n.arrowBend === "number" &&
            Number.isFinite(n.arrowBend) &&
            n.arrowBend >= 0 &&
            n.arrowBend <= 100),
        "arrowBend 必须为 0 到 100 的百分比",
      );
      nodeIds.add(n.id);
    }
    const edgeIds = new Set<string>();
    const endpoint = (target: unknown, point: unknown) => {
      if (typeof target !== "string") return false;
      if (target) return nodeIds.has(target);
      if (!point || typeof point !== "object" || Array.isArray(point))
        return false;
      const position = point as { x?: unknown; y?: unknown };
      return (
        typeof position.x === "number" &&
        Number.isFinite(position.x) &&
        typeof position.y === "number" &&
        Number.isFinite(position.y)
      );
    };
    const anchor = (value: any) => {
      if (value === undefined) return true;
      const name = typeof value === "string" ? value : value?.name;
      if (typeof name !== "string" || !name.trim() || name.length > 64)
        return false;
      if (typeof value === "string") return true;
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      if (Object.keys(value).some((key) => key !== "name" && key !== "args"))
        return false;
      return (
        value.args === undefined ||
        (value.args &&
          typeof value.args === "object" &&
          !Array.isArray(value.args) &&
          Object.values(value.args).every(
            (arg) =>
              typeof arg === "string" ||
              typeof arg === "boolean" ||
              (typeof arg === "number" && Number.isFinite(arg)),
          ))
      );
    };
    for (const e of node.edges) {
      assert(
        diagramEdgeStyle.safeParse(e).success,
        "流程图连线样式必须使用原生字段值",
      );
      assert(
        e &&
          typeof e.id === "string" &&
          e.id &&
          !edgeIds.has(e.id) &&
          endpoint(e.source, e.sourcePoint) &&
          endpoint(e.target, e.targetPoint),
        "流程图连线必须使用唯一 id，端点连接现有节点或提供 sourcePoint/targetPoint 数值坐标",
      );
      assert(
        e.lineType === undefined ||
          ["smoothstep", "straight", "bezier", "step"].includes(e.lineType),
        "未知流程图连线类型",
      );
      assert(
        e.arrow === undefined || ["none", "end", "both"].includes(e.arrow),
        "未知流程图箭头类型",
      );
      assert(
        e.routeMode === undefined || e.routeMode === "manual",
        "未知流程图路径模式",
      );
      assert(
        anchor(e.sourceAnchor) && anchor(e.targetAnchor),
        "连线锚点必须使用名称与可序列化参数",
      );
      assert(
        e.vertices === undefined ||
          (Array.isArray(e.vertices) &&
            e.vertices.every((point: any) => endpoint("", point))),
        "连线路径控制点必须为数值坐标",
      );
      edgeIds.add(e.id);
    }
  }
  if (node.type === "mindmap")
    assert(
      node.mindData?.nodeData?.id &&
        typeof node.mindData.nodeData.topic === "string",
      "思维导图必须提供 mindData.nodeData",
    );
  node.children.forEach((n: any) => validateRichNode(n, seen, depth + 1));
}
export function validateEditOperations(format: string, operations: any[]) {
  assert(
    documentFormats.includes(format as DocumentFormat),
    "当前资源不是可编辑文档",
  );
  const schema = schemas[format as DocumentFormat];
  for (const operation of operations) {
    const command = schema.options.find(
      (option) => option.shape.type.value === operation?.type,
    );
    assert(
      command,
      typeof operation?.type === "string"
        ? `不支持 ${format} 命令 ${String(operation.type)}，${format === "rich_text" && operation.type === "remove" ? '删除块请用 {type:"deleteBlock",blockId:"已读取的块ID"}；' : ""}请读取 capabilities.operations`
        : `${format} 命令缺少 type 字段，请读取 capabilities.operations`,
    );
    const parsed = command!.safeParse(operation);
    assert(
      parsed.success,
      `${format} 的 ${String(operation.type)} 参数不合法：${(
        parsed.error?.issues ?? []
      )
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "参数"} ${issue.message}`)
        .join("；")
        .slice(
          0,
          1500,
        )}；该命令字段：${Object.keys(command!.shape).join("、")}；请按 capabilities 中该命令的参数重试`,
    );
    if (format === "spreadsheet" && operation.type === "cells") {
      const cells = (parsed.data as { cells?: Record<string, unknown> }).cells;
      validateSpreadsheetCellMatrix(cells);
      assert(
        cells &&
          Object.values(cells).some(
            (row) => row && typeof row === "object" && Object.keys(row).length,
          ),
        'cells 不能为空。请传入 [{row:0,column:0,v:"表头"},{row:0,column:1,f:"=A1"}]，常量只写 v，公式只写 f，不要写 f:null 或省略号。',
      );
    }
    if (
      format === "spreadsheet" &&
      operation.type === "mutation" &&
      operation.id === "sheet.mutation.set-range-values"
    )
      validateSpreadsheetCellMatrix(operation.params?.cellValue);
    if (format === "rich_text") {
      if (operation.type === "insertBlock") validateRichNode(operation.block);
      if (operation.type === "setCellContent")
        operation.children.forEach((n: any) => validateRichNode(n));
      if (operation.type === "setBlock") {
        assert(
          !("id" in operation.properties) &&
            !("children" in operation.properties),
          "setBlock 不能更换 id 或 children；请使用文字/结构命令",
        );
        assert(
          !(operation.unset ?? []).some((k: string) =>
            ["id", "type", "children"].includes(k),
          ),
          "不能移除节点身份或类型",
        );
      }
    }
    if (format === "canvas") {
      const check = (element: any, partial = false) => {
        assert(element && typeof element === "object", "画板元素无效");
        assert(
          Object.keys(element).every(
            (k) =>
              CANVAS_ELEMENT_PROPERTIES.includes(k) ||
              k === "text" ||
              (!partial && ["id", "children"].includes(k)),
          ),
          `画板元素包含未知属性：${Object.keys(element).filter(k => !CANVAS_ELEMENT_PROPERTIES.includes(k) && k !== "text" && !(!partial && ["id", "children"].includes(k))).slice(0,8).join("、")}。Path 的原生路径字段是 path，不是 SVG 的 d；颜色用 fill/stroke。不要保留错误字段后反复提交。`,
        );
        if (element.tag !== undefined || !partial)
          assert(canvas.safeParse(element).success, "未知画板元素类型");
        if (element.points !== undefined) {
          const points = element.points, minimum = element.tag === "Polygon" ? 3 : 2;
          const flat = Array.isArray(points) && points.length >= minimum * 2 && points.length % 2 === 0 && points.every((n: unknown) => typeof n === "number" && Number.isFinite(n));
          const objects = Array.isArray(points) && points.length >= minimum && points.every((p: any) => p && typeof p === "object" && !Array.isArray(p) && Number.isFinite(p.x) && Number.isFinite(p.y));
          assert(flat || objects, 'points 必须是原生扁平数组 [x1,y1,x2,y2,…] 或 [{x,y},…]；不接受 [[x,y],…]，后者会保存成不可见图形。');
        }
        if (partial) {
          assert(
            element.tag === undefined && element.name === undefined,
            "patch 不能改变画板元素类型或原生工具分类",
          );
        } else if (element.name) {
          const names: Record<string, string[]> = {
            Rect: ["rect", "square", "diagram-body"],
            Ellipse: ["ellipse", "circle", "diagram-body"],
            Text: ["text", "frame-title"],
            Image: ["image"],
            Line: ["line", "arrow"],
            Arrow: ["arrow"],
            Path: ["path", "special-shape", "connector", "template-edge", "mind-edge", "diagram-body"],
            Polygon: ["polygon"],
            Star: ["star"],
            Group: ["group", "mindmap", "board-table"],
            Frame: ["frame", "mind-node", "diagram-node", "table-cell", "note", "card", "connector-label"],
          };
          assert(
            names[element.tag]?.includes(element.name) ||
              (element.data?.kind === "container-decoration" && typeof element.name === "string" && element.name.startsWith("container-")),
            "name 必须是匹配 tag 的原生工具分类；可省略由系统补齐，不能填写描述性名称",
          );
        }
        element.children?.forEach((n: any) => check(n));
      };
      if (operation.type === "add") check(operation.element);
      if (operation.type === "patch") check(operation.patch, true);
    }
  }
}
