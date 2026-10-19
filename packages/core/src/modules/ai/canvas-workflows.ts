import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CanvasModel, SceneNode } from "@smartdoca/canvas/model";
import { fail } from "../../shared/errors.js";
import { canvasConnectorRoute, canvasConnectorLabel, autoCanvasConnector } from "./canvas-connectors.js";
import { nativeCanvasElement } from "../../shared/canvas-elements.js";

// Host AI workflows compose the shipped public CanvasModel commands. These are
// not extra editor-package exports or another persistence/transport channel.
const id = z.string().min(1).max(160);
const number = z.number().finite();
const size = number.min(28).max(10000);
const text = z.string().max(100000);
const position = { id, x: number, y: number };
const matrix = z
  .array(z.array(text).min(1).max(30))
  .min(1)
  .max(100)
  .refine(
    (rows) => rows.every((row) => row.length === rows[0]!.length),
    "表格每行列数必须一致",
  );
type Topic = { id: string; text: string; children?: Topic[] };
const topic: z.ZodType<Topic> = z.lazy(() =>
  z.strictObject({
    id,
    text,
    children: z.array(topic).max(30).optional(),
  }),
);
const range = z.strictObject({
  startRow: z.number().int().nonnegative(),
  endRow: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
});
export const canvasTableCommand = z.union([
  z.strictObject({
    kind: z.literal("cell"),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    text,
  }),
  z.strictObject({
    kind: z.literal("paste"),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    cells: matrix,
  }),
  z.strictObject({ kind: z.enum(["clear", "merge", "split"]), range }),
  z.strictObject({
    kind: z.literal("style"),
    range,
    style: z.strictObject({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      fontSize: number.min(10).max(96).optional(),
      color: z.string().optional(),
      backgroundColor: z.string().optional(),
      align: z.enum(["left", "center", "right"]).optional(),
      verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("resize"),
    axis: z.enum(["row", "column"]),
    index: z.number().int().nonnegative(),
    size,
  }),
  z.strictObject({
    kind: z.enum([
      "insert-row",
      "insert-column",
      "delete-row",
      "delete-column",
    ]),
    index: z.number().int().nonnegative(),
  }),
]);
export const canvasWorkflowSchemas = [
  z.strictObject({
    type: z.literal("createFlowchart"),
    ...position,
    nodes: z
      .array(
        z.strictObject({
          ...position,
          text,
          width: size,
          height: size,
          shape: z.enum(["rounded", "rect", "ellipse", "diamond"]),
          fill: z.string().optional(),
          stroke: z.string().optional(),
        }),
      )
      .min(1)
      .max(100),
    edges: z
      .array(
        z.strictObject({
          id,
          sourceId: id,
          targetId: id,
          label: z.string().max(200).optional(),
          mode: z.enum(["straight", "elbow"]),
          autoRoute: z.boolean().optional().describe("true 自动选择原生折线端口和避开卡片的绕行，不再提供 sourcePort/targetPort/offset；mode 填 elbow"),
          autoLabel: z.boolean().optional().describe("新标签默认自动避让；false 明确居中。true 与 labelOffset 不能同时提供"),
          sourcePort: z.enum(["top", "right", "bottom", "left"]).optional(),
          targetPort: z.enum(["top", "right", "bottom", "left"]).optional(),
          offset: number.optional().describe("仅 elbow 且两端同为 top/bottom 或同为 left/right 时生效；前者绕行 x，后者绕行 y，混合端口不支持此参数"),
          labelOffset: z.strictObject({ x: number, y: number }).optional()
            .describe("标签相对连线路径中点的偏移（像素），用于避开卡片与其他连线；不改变箭头端点"),
        }),
      )
      .max(200),
  }),
  z.strictObject({
    type: z.literal("createMindmap"),
    ...position,
    topic,
    layout: z.enum(["right", "left", "balanced"]),
  }),
  z.strictObject({
    type: z.literal("createTable"),
    ...position,
    cells: matrix,
    columnWidths: z.array(size).max(30).optional(),
    rowHeights: z.array(size).max(100).optional(),
  }),
  z.strictObject({
    type: z.literal("createContainer"),
    ...position,
    containerType: z.enum([
      "phone",
      "tablet",
      "web",
      "wide",
      "standard",
      "a4",
      "section",
    ]),
    title: z.string().max(200),
    children: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
  }),
  z.strictObject({ type: z.literal("table"), id, command: canvasTableCommand }),
  z.strictObject({
    type: z.literal("diagramNode"), id,
    width: size.optional(), height: size.optional(),
    fill: z.string().optional(), stroke: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("diagramEdge"), id,
    autoLabel: z.boolean().optional(),
    autoRoute: z.boolean().optional(),
    sourcePort: z.enum(["top", "right", "bottom", "left"]).optional(),
    targetPort: z.enum(["top", "right", "bottom", "left"]).optional(),
    mode: z.enum(["straight", "elbow"]).optional(),
    offset: number.nullable().optional(),
    labelOffset: z.strictObject({ x: number, y: number }).optional(),
  }),
] as const;

interface N extends SceneNode {
  id: string;
  data?: Record<string, any>;
  children?: N[];
}
const fontFamily = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
const uuid = () => randomUUID();
const label = (
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
): N => ({
  id,
  tag: "Text",
  name: "text",
  text,
  x,
  y,
  width,
  height,
  fontFamily,
  fontSize: 16,
  fill: "#1f2329",
  verticalAlign: "middle",
  editable: true,
  ...extra,
});
export function canvasSceneNodes(root: SceneNode): N[] {
  const all: N[] = [];
  const visit = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      all.push(node as N);
      visit(node.children ?? []);
    }
  };
  visit(root.children ?? []);
  return all;
}

/** Bounded, current-state facts for index-based table commands and acceptance. */
export function canvasTableSummary(value: any) {
  if (!value?.scene) return [];
  return canvasSceneNodes(value.scene)
    .filter((n) => n.data?.kind === "table")
    .slice(0, 20)
    .map((table) => {
      const rows = table.data!.rows,
        columns = table.data!.columns;
      const previewRows = new Set(
        [0, 1, rows - 2, rows - 1].filter((row) => row >= 0 && row < rows),
      );
      return {
        id: table.id,
        rows,
        columns,
        lastRowIndex: rows - 1,
        lastTwoRows: rows >= 2 ? [rows - 2, rows - 1] : null,
        merges: cellsOf(table)
          .filter((c) => c.data!.rowSpan > 1 || c.data!.columnSpan > 1)
          .map((c) => ({
            row: c.data!.row,
            column: c.data!.column,
            rowSpan: c.data!.rowSpan ?? 1,
            columnSpan: c.data!.columnSpan ?? 1,
          })),
        rowPreview: [...previewRows]
          .sort((a, b) => a - b)
          .map((row) => ({
            row,
            cells: cellsOf(table)
              .filter((c) => c.data!.row === row)
              .sort((a, b) => a.data!.column - b.data!.column)
              .map((c) => ({
                column: c.data!.column,
                text: String(textOf(c).text ?? "").slice(0, 80),
                coveredBy: c.data!.coveredBy,
              })),
          })),
      };
    });
}

/** A native table is a semantic object: raw child edits must not bypass its axes. */
export function assertCanvasPrimitiveOperation(model: CanvasModel, op: any) {
  if (
    !["add", "patch", "remove", "place", "group", "ungroup"].includes(op.type)
  )
    return;
  const scene = model.getValue().scene,
    all = canvasSceneNodes(scene),
    byId = new Map(all.map((n) => [n.id, n]));
  const parents = new Map<string, string>();
  for (const n of all)
    for (const child of n.children ?? []) parents.set(child.id, n.id);
  const ancestors = (id: string) => {
    const result: N[] = [];
    for (let n = byId.get(id); n; n = byId.get(parents.get(n.id)!))
      result.push(n);
    return result;
  };
  const reject = () =>
    fail(
      400,
      '画布表格结构必须使用 table 工作流：新增一行用 {type:"table",id:表格ID,command:{kind:"insert-row",index:当前行数}}，再用 paste 填充；不能 add/remove/place 表格子节点或 patch.data/单元格几何。',
    );
  if (
    ["add", "place"].includes(op.type) &&
    op.parentId &&
    ancestors(op.parentId).some((n) => n.data?.kind === "table")
  )
    reject();
  if (op.type === "patch") {
    const target = byId.get(op.id);
    if (target?.data?.kind === "diagram-node" &&
        ["width", "height"].some(key => key in op.patch))
      fail(400, `流程节点尺寸请用 {type:"diagramNode",id:"${op.id}",width:目标宽度,height:目标高度}，同步调整外框、内部图形与文字边界；单独 patch 外层 Frame 会导致显示尺寸不一致。移动节点仍用 patch x/y。`, { code: "canvas_diagram_resize_required" });
    if (target?.data?.kind === "diagram-node" &&
        (("fill" in op.patch && op.patch.fill !== "transparent") ||
          ["stroke", "strokeWidth"].some(key => key in op.patch))) {
      const body = target.children?.find(child => child.data?.kind === "diagram-body");
      fail(400, `流程节点外层 Frame 必须保持透明；填色和边框请 patch 内部 diagram-body${body ? `（id:${body.id}）` : "，先完整读取节点"}，不要给外框叠加色块。`, { code: "canvas_diagram_style_required" });
    }
    const chain = ancestors(op.id),
      owner = chain.find((n) => n.data?.kind === "table");
    if (
      owner &&
      ("data" in op.patch ||
        (owner.id !== op.id &&
          ["x", "y", "width", "height"].some((key) => key in op.patch)))
    )
      reject();
  }
  const ids: string[] = op.ids ?? (op.id ? [op.id] : []);
  if (["remove", "place", "group", "ungroup"].includes(op.type))
    for (const id of ids) {
      const chain = ancestors(id),
        owner = chain.find((n) => n.data?.kind === "table");
      if (!owner) continue;
      if (
        op.type === "ungroup" ||
        (owner.id !== id &&
          !(
            op.type === "remove" &&
            chain.some((n) => ids.includes(n.id) && n.id !== id)
          ))
      )
        reject();
    }
}
function diagram(op: any): N {
  for (const node of op.nodes) {
    const lines = node.text.trim() ? node.text.split(/\r\n|\r|\n/).length : 0;
    const minimumHeight = lines * 24 + 24;
    if (lines && node.height < minimumHeight)
      fail(400, `流程节点 ${node.id} 含 ${lines} 行文字，16px 字号至少需要 ${minimumHeight}px 高度（含上下边距）；请增高，并为自动折行留出额外空间。尚未保存本批修改。`, { code: "canvas_diagram_node_invalid" });
  }
  for (let i = 0; i < op.nodes.length; i++) for (let j = i + 1; j < op.nodes.length; j++) {
    const a = op.nodes[i], b = op.nodes[j];
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
      fail(400, `流程节点 ${a.id} 与 ${b.id} 的矩形边界重叠；请调整 x/y 或尺寸并保留走线空间。尚未保存本批图形。`, { code: "canvas_diagram_overlap" });
  }
  const nodes: N[] = op.nodes.map((n: any) => ({
    id: n.id,
    tag: "Frame",
    name: "diagram-node",
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    fill: "transparent",
    editable: true,
    hitChildren: false,
    data: { kind: "diagram-node", shape: n.shape },
    children: [
      {
        id: uuid(),
        tag:
          n.shape === "diamond"
            ? "Path"
            : n.shape === "ellipse"
              ? "Ellipse"
              : "Rect",
        name: "diagram-body",
        x: 0,
        y: 0,
        width: n.width,
        height: n.height,
        ...(n.shape === "diamond"
          ? {
              path: `M${n.width / 2} 0L${n.width} ${n.height / 2}L${n.width / 2} ${n.height}L0 ${n.height / 2}Z`,
            }
          : {}),
        fill: n.fill ?? "#eaf1ff",
        stroke: n.stroke ?? "#3370ff",
        strokeWidth: 1.5,
        cornerRadius: n.shape === "rounded" ? 8 : 0,
        editable: false,
        data: { kind: "diagram-body" },
      },
      label(uuid(), n.text, 14, 12, n.width - 28, n.height - 24, {
        textAlign: "center",
        data: { kind: "node-label" },
      }),
    ],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const occupied = [...(op.labelOccupied ?? [])];
  const routed: { x: number; y: number }[][] = [];
  const edges: N[] = op.edges.flatMap((inputEdge: any) => {
    let edge = inputEdge;
    if (edge.autoRoute) {
      if (edge.mode !== "elbow" || [edge.sourcePort, edge.targetPort, edge.offset].some(v => v !== undefined))
        fail(400, "autoRoute 使用原生 elbow 自动选择端口与绕行，请省略 sourcePort/targetPort/offset", { code: "canvas_diagram_node_invalid" });
      edge = { ...edge, ...autoCanvasConnector(nodes.map(n => ({ id: n.id, x: Number(n.x), y: Number(n.y), width: Number(n.width), height: Number(n.height) })), edge.sourceId, edge.targetId, routed) };
    }
    const a = byId.get(edge.sourceId),
      b = byId.get(edge.targetId);
    if (!a || !b || a === b)
      fail(400, "流程图连线必须引用本次已定义的不同节点 ID");
    const vertical =
      Math.abs(Number(b.y) - Number(a.y)) > Math.abs(Number(b.x) - Number(a.x));
    const forward = vertical
      ? Number(b.y) >= Number(a.y)
      : Number(b.x) >= Number(a.x);
    const ports: Record<string, { x: number; y: number }> = {
      top: { x: 0.5, y: 0 },
      right: { x: 1, y: 0.5 },
      bottom: { x: 0.5, y: 1 },
      left: { x: 0, y: 0.5 },
    };
    const sourceAnchor =
      ports[edge.sourcePort] ??
      (vertical
        ? { x: 0.5, y: forward ? 1 : 0 }
        : { x: forward ? 1 : 0, y: 0.5 });
    const targetAnchor =
      ports[edge.targetPort] ??
      (vertical
        ? { x: 0.5, y: forward ? 0 : 1 }
        : { x: forward ? 0 : 1, y: 0.5 });
    const from = {
      x: Number(a.x) + Number(a.width) * sourceAnchor.x,
      y: Number(a.y) + Number(a.height) * sourceAnchor.y,
    };
    const to = {
      x: Number(b.x) + Number(b.width) * targetAnchor.x,
      y: Number(b.y) + Number(b.height) * targetAnchor.y,
    };
    const route = canvasConnectorRoute(from, to, sourceAnchor, targetAnchor, edge.mode, edge.offset);
    routed.push(route.points);
    const { middle, path } = route;
    const result: N[] = [
      {
        id: edge.id,
        tag: "Path",
        name: "connector",
        path,
        stroke: "#646a73",
        strokeWidth: 1.5,
        editable: true,
        data: {
          kind: "connector",
          sourceId: a.id,
          targetId: b.id,
          sourceAnchor,
          targetAnchor,
          from,
          to,
          mode: edge.mode,
          startHead: "none",
          endHead: "arrow",
          ...(edge.offset !== undefined ? { offset: edge.offset } : {}),
        },
      },
    ];
    if (edge.label) {
      if (edge.autoLabel && edge.labelOffset !== undefined)
        fail(400, "autoLabel 与 labelOffset 不能同时提供", { code: "canvas_diagram_node_invalid" });
      const boxId = uuid();
      // Field names such as source_family_id must remain on one readable line.
      const labelWidth = Math.max(96, 12 + Array.from(edge.label as string)
        .reduce((width, char) => width + (/[^\u0000-\u00ff]/.test(char) ? 13 : 8), 0));
      const labelOffset = edge.labelOffset ?? (edge.autoLabel === false ? { x: 0, y: 0 } : canvasConnectorLabel(route, labelWidth, 28,
        (op.labelObstacles ?? nodes).map((n: any) => ({ x: Number(n.x), y: Number(n.y), width: Number(n.width), height: Number(n.height) })), occupied));
      occupied.push({ x: middle.x - labelWidth / 2 + labelOffset.x, y: middle.y - 14 + labelOffset.y, width: labelWidth, height: 28 });
      result[0]!.data!.labelId = boxId;
      result.push({
        id: boxId,
        tag: "Frame",
        name: "connector-label",
        x: middle.x - labelWidth / 2 + labelOffset.x,
        y: middle.y - 14 + labelOffset.y,
        width: labelWidth,
        height: 28,
        fill: "#ffffff",
        hitChildren: false,
        editable: true,
        data: { kind: "connector-label", ownerId: edge.id,
          offset: labelOffset },
        children: [
          label(uuid(), edge.label, 5, 4, labelWidth - 10, 20, {
            fontSize: 13,
            textAlign: "center",
            textWrap: "none",
            data: { kind: "node-label" },
          }),
        ],
      });
    }
    return result;
  });
  return {
    id: op.id,
    tag: "Group",
    name: "group",
    x: op.x,
    y: op.y,
    children: [...edges.filter(n => n.data?.kind === "connector"), ...edges.filter(n => n.data?.kind === "connector-label"), ...nodes],
  };
}
function mindmap(op: any): N {
  const nodes: N[] = [],
    edges: N[] = [];
  const colors = [
    "#3370ff",
    "#36a872",
    "#e5a329",
    "#9254de",
    "#e76560",
    "#28a6a6",
  ];
  const span = (topic: Topic): number =>
    Math.max(
      64,
      (topic.children ?? []).reduce((sum, t) => sum + span(t), 0),
    );
  let budget = 0;
  const add = (
    topic: Topic,
    parent: N | null,
    x: number,
    y: number,
    direction: number,
    colorIndex: number,
    depth: number,
  ): void => {
    if (++budget > 200 || depth > 12)
      fail(400, "思维导图最多 200 个主题、12 层");
    const width = Math.min(
      260,
      Math.max(parent ? 144 : 160, topic.text.length * 16 + 32),
    );
    const node: N = {
      id: topic.id,
      tag: "Frame",
      name: "mind-node",
      x,
      y,
      width,
      height: 48,
      fill: parent ? "#f0f5ff" : colors[0],
      stroke: colors[colorIndex % colors.length],
      strokeWidth: parent ? 1 : 0,
      cornerRadius: 5,
      editable: true,
      hitChildren: false,
      data: {
        kind: "mind-node",
        parentId: parent?.id ?? "",
        root: !parent,
        colorIndex,
        collapsed: false,
      },
      children: [
        label(uuid(), topic.text, 14, 8, width - 28, 32, {
          fontSize: parent ? 16 : 18,
          fontWeight: parent ? 400 : 600,
          fill: parent ? "#1f2329" : "#ffffff",
          textAlign: "center",
          data: { kind: "node-label" },
        }),
      ],
    };
    nodes.push(node);
    if (parent) {
      const from = {
        x: Number(parent.x) + (direction > 0 ? Number(parent.width) : 0),
        y: Number(parent.y) + 24,
      };
      const to = { x: x + (direction > 0 ? 0 : width), y: y + 24 };
      edges.push({
        id: uuid(),
        tag: "Path",
        name: "mind-edge",
        stroke: colors[colorIndex % colors.length],
        strokeWidth: 2,
        path: `M${from.x} ${from.y}L${(from.x + to.x) / 2} ${from.y}L${(from.x + to.x) / 2} ${to.y}L${to.x} ${to.y}`,
        editable: false,
        hittable: false,
        data: { kind: "mind-edge", sourceId: parent.id, targetId: topic.id },
      });
    }
    const children = topic.children ?? [];
    for (const side of parent || op.layout !== "balanced"
      ? [direction]
      : [1, -1]) {
      const list = children.filter(
        (_: Topic, i: number) =>
          parent || op.layout !== "balanced" || (i % 2 === 0 ? 1 : -1) === side,
      );
      let top =
        y + 24 - list.reduce((sum: number, t: Topic) => sum + span(t), 0) / 2;
      for (const child of list) {
        const h = span(child),
          childWidth = Math.min(
            260,
            Math.max(144, child.text.length * 16 + 32),
          );
        add(
          child,
          node,
          x + (side > 0 ? width + 72 : -childWidth - 72),
          top + h / 2 - 24,
          side,
          parent ? colorIndex : children.indexOf(child),
          depth + 1,
        );
        top += h;
      }
    }
  };
  add(op.topic, null, 0, 0, op.layout === "left" ? -1 : 1, 0, 0);
  return {
    id: op.id,
    tag: "Group",
    name: "mindmap",
    x: op.x,
    y: op.y,
    editable: false,
    hitSelf: false,
    data: { kind: "mindmap", layout: op.layout, originX: 0, originY: 0 },
    children: [...edges, ...nodes],
  };
}
function cell(row: number, column: number, text: string): N {
  return {
    id: uuid(),
    tag: "Frame",
    name: "table-cell",
    x: 0,
    y: 0,
    width: 140,
    height: 46,
    fill: row === 0 ? "#eaf1ff" : "#ffffff",
    stroke: "#cfd3d8",
    strokeWidth: 1,
    editable: false,
    hitChildren: false,
    data: { kind: "table-cell", row, column },
    children: [
      label(uuid(), text, 12, 10, 116, 26, {
        fontSize: 14,
        fontWeight: row === 0 ? 600 : 400,
        verticalAlign: "top",
        data: { kind: "cell-label" },
      }),
    ],
  };
}
const cellsOf = (table: N) =>
  (table.children ?? []).filter((n) => n.data?.kind === "table-cell");
const cellAt = (table: N, row: number, column: number) =>
  cellsOf(table).find((n) => n.data!.row === row && n.data!.column === column);
const textOf = (cell: N) =>
  cell.children?.find((n) => n.tag === "Text") ??
  fail(400, "表格单元格缺少原生文字节点");
function layoutTable(table: N) {
  const data = table.data!,
    widths = data.columnWidths as number[],
    heights = data.rowHeights as number[];
  if (
    !Array.isArray(widths) ||
    !Array.isArray(heights) ||
    widths.length !== data.columns ||
    heights.length !== data.rows
  )
    fail(400, "请读取当前原生表格完整的 columnWidths/rowHeights");
  const cells = cellsOf(table),
    coverage = new Map<string, string>();
  for (const c of cells)
    for (let r = c.data!.row; r < c.data!.row + (c.data!.rowSpan ?? 1); r++)
      for (
        let col = c.data!.column;
        col < c.data!.column + (c.data!.columnSpan ?? 1);
        col++
      )
        if (r !== c.data!.row || col !== c.data!.column)
          coverage.set(`${r}:${col}`, c.id);
  for (const c of cells) {
    const d = c.data!,
      row = d.row,
      col = d.column,
      coveredBy = coverage.get(`${row}:${col}`);
    if (coveredBy) d.coveredBy = coveredBy;
    else delete d.coveredBy;
    c.x = widths.slice(0, col).reduce((a, b) => a + b, 0);
    c.y = heights.slice(0, row).reduce((a, b) => a + b, 0);
    c.width = widths
      .slice(col, col + (d.columnSpan ?? 1))
      .reduce((a, b) => a + b, 0);
    c.height = heights
      .slice(row, row + (d.rowSpan ?? 1))
      .reduce((a, b) => a + b, 0);
    c.visible = !coveredBy;
    c.overflow = "hide";
    const t = textOf(c);
    t.width = Math.max(12, Number(c.width) - 24);
    t.height = Math.max(12, Number(c.height) - 20);
  }
}
function createTable(op: any): N {
  const rows = op.cells.length,
    columns = op.cells[0].length;
  if (
    (op.columnWidths && op.columnWidths.length !== columns) ||
    (op.rowHeights && op.rowHeights.length !== rows)
  )
    fail(400, "表格尺寸数组必须与行列数一致");
  const table: N = {
    id: op.id,
    tag: "Group",
    name: "board-table",
    x: op.x,
    y: op.y,
    editable: true,
    hitSelf: false,
    data: {
      kind: "table",
      rows,
      columns,
      columnWidths: op.columnWidths ?? Array(columns).fill(140),
      rowHeights: op.rowHeights ?? Array(rows).fill(46),
    },
    children: op.cells.flatMap((row: string[], r: number) =>
      row.map((t, c) => cell(r, c, t)),
    ),
  };
  layoutTable(table);
  return table;
}
function container(op: any): N {
  const presets: Record<string, [number, number, number]> = {
    phone: [390, 844, 46],
    tablet: [820, 1180, 24],
    web: [1280, 800, 8],
    wide: [800, 450, 0],
    standard: [800, 600, 0],
    a4: [595, 842, 0],
    section: [480, 320, 8],
  };
  const [width, height, radius] = presets[op.containerType]!;
  return {
    id: op.id,
    tag: "Frame",
    name: "frame",
    x: op.x,
    y: op.y,
    width,
    height,
    fill: "#ffffff",
    stroke: "#b8bec9",
    strokeWidth: 1,
    cornerRadius: radius,
    overflow: "hide",
    editable: true,
    lockRatio: op.containerType !== "section",
    data: {
      kind: "container",
      containerType: op.containerType,
      title: op.title,
      gap: 24,
      padding: 28,
    },
    children: [
      label(
        uuid(),
        op.title,
        op.containerType === "phone" ? 26 : 20,
        op.containerType === "phone" ? 62 : 14,
        width - 52,
        24,
        {
          name: "frame-title",
          fontSize: 14,
          fill: "#646a73",
          data: { containerPart: "title" },
        },
      ),
      ...(op.children ? op.children.map(nativeCanvasElement) : []),
    ],
  };
}

function tableEdit(table: N, command: z.infer<typeof canvasTableCommand>) {
  if (table.data?.kind !== "table") fail(400, "目标不是原生画布表格");
  const data = table.data,
    rows = Number(data.rows),
    columns = Number(data.columns);
  const at = (r: number, c: number) =>
    cellAt(table, r, c) ?? fail(400, "表格行列越界，请读取当前表格");
  const set = (c: N, text: string) => {
    const t = textOf(c);
    t.text = text;
    // This is an explicit whole-cell replacement, matching native plain paste.
    if (t.data) delete t.data.richText;
  };
  if (command.kind === "cell") {
    const c = at(command.row, command.column);
    if (c.data!.coveredBy) fail(400, "请修改合并区域左上角单元格");
    set(c, command.text);
  } else if (command.kind === "paste") {
    if (
      command.row + command.cells.length > rows ||
      command.column + command.cells[0]!.length > columns
    )
      fail(400, "粘贴超出表格；先用 insert-row/insert-column 扩展");
    for (let r = 0; r < command.cells.length; r++)
      for (let c = 0; c < command.cells[r]!.length; c++) {
        const target = at(command.row + r, command.column + c);
        if (
          target.data!.coveredBy ||
          target.data!.rowSpan ||
          target.data!.columnSpan
        )
          fail(400, "粘贴区域有合并格，请先 split");
        set(target, command.cells[r]![c]!);
      }
  } else if (command.kind === "resize") {
    const sizes = data[
      command.axis === "row" ? "rowHeights" : "columnWidths"
    ] as number[];
    if (!Array.isArray(sizes) || command.index >= sizes.length)
      fail(400, "表格尺寸索引越界");
    sizes[command.index] = Math.max(
      command.axis === "row" ? 28 : 48,
      command.size,
    );
  } else if (
    ["insert-row", "insert-column", "delete-row", "delete-column"].includes(
      command.kind,
    )
  ) {
    const cmd = command as { kind: string; index: number },
      isRow = cmd.kind.endsWith("row"),
      inserting = cmd.kind.startsWith("insert");
    const key = isRow ? "row" : "column",
      count = isRow ? rows : columns;
    if (
      cmd.index > count ||
      (!inserting && (cmd.index >= count || count === 1))
    )
      fail(400, "不能删除最后一行列或使用越界索引");
    if (inserting && count >= (isRow ? 100 : 30))
      fail(400, "画布表格达到行列上限");
    if (cellsOf(table).some((c) => c.data!.rowSpan || c.data!.columnSpan))
      fail(400, "结构修改前请先拆分合并区域");
    table.children = (table.children ?? []).filter(
      (c) =>
        inserting || c.data?.kind !== "table-cell" || c.data[key] !== cmd.index,
    );
    for (const c of cellsOf(table))
      if (c.data![key] >= cmd.index) c.data![key] += inserting ? 1 : -1;
    if (inserting)
      for (let i = 0; i < (isRow ? columns : rows); i++)
        table.children!.push(
          cell(isRow ? cmd.index : i, isRow ? i : cmd.index, ""),
        );
    (data[isRow ? "rowHeights" : "columnWidths"] as number[]).splice(
      cmd.index,
      inserting ? 0 : 1,
      ...(inserting ? [isRow ? 46 : 140] : []),
    );
    data[isRow ? "rows" : "columns"] = count + (inserting ? 1 : -1);
  } else if ("range" in command) {
    const r = command.range;
    if (
      r.endRow < r.startRow ||
      r.endColumn < r.startColumn ||
      r.endRow >= rows ||
      r.endColumn >= columns
    )
      fail(
        400,
        `表格范围无效：当前 ${rows} 行 ${columns} 列，索引从0开始；新增范围先 insert-row/insert-column，再 paste/merge。`,
      );
    const cells = cellsOf(table).filter(
      (c) =>
        c.data!.row >= r.startRow &&
        c.data!.row <= r.endRow &&
        c.data!.column >= r.startColumn &&
        c.data!.column <= r.endColumn,
    );
    // Never modify half a native merged region.
    for (const c of cellsOf(table)) {
      const d = c.data!,
        bottom = d.row + (d.rowSpan ?? 1) - 1,
        right = d.column + (d.columnSpan ?? 1) - 1;
      if (
        d.row > r.endRow ||
        bottom < r.startRow ||
        d.column > r.endColumn ||
        right < r.startColumn
      )
        continue;
      if (
        d.row < r.startRow ||
        bottom > r.endRow ||
        d.column < r.startColumn ||
        right > r.endColumn
      )
        fail(400, "范围必须覆盖完整合并区域");
    }
    if (command.kind === "split" || command.kind === "merge") {
      if (
        command.kind === "merge" &&
        cells.some((c) => textOf(c).data?.richText)
      )
        fail(400, "富文本单元格合并请使用原生界面，AI 不会丢弃格式或附件");
      const content = cells
        .filter((c) => !c.data!.coveredBy)
        .sort(
          (a, b) =>
            a.data!.row - b.data!.row || a.data!.column - b.data!.column,
        )
        .map((c) => String(textOf(c).text ?? ""))
        .filter(Boolean)
        .join("\n");
      for (const c of cells) {
        delete c.data!.rowSpan;
        delete c.data!.columnSpan;
        delete c.data!.coveredBy;
      }
      if (command.kind === "merge") {
        const first = at(r.startRow, r.startColumn);
        for (const c of cells) set(c, c === first ? content : "");
        first.data!.rowSpan = r.endRow - r.startRow + 1;
        first.data!.columnSpan = r.endColumn - r.startColumn + 1;
      }
    } else if (command.kind === "clear") cells.forEach((c) => set(c, ""));
    else if (command.kind === "style")
      for (const c of cells.filter((c) => !c.data!.coveredBy)) {
        const s = command.style,
          t = textOf(c);
        if (s.backgroundColor !== undefined) c.fill = s.backgroundColor;
        if (s.bold !== undefined) t.fontWeight = s.bold ? 700 : 400;
        if (s.italic !== undefined) t.italic = s.italic;
        if (s.underline !== undefined)
          t.textDecoration = s.underline ? "under" : "none";
        if (s.fontSize !== undefined) t.fontSize = s.fontSize;
        if (s.color !== undefined) t.fill = s.color;
        if (s.align !== undefined) t.textAlign = s.align;
        if (s.verticalAlign !== undefined) t.verticalAlign = s.verticalAlign;
        if (t.data?.richText) {
          const value = t.data.richText.value;
          if (t.data.richText.version !== 1 || !Array.isArray(value))
            fail(400, "未知富文本格式，未修改表格");
          for (const p of value) {
            if (s.align) p.align = s.align;
            for (const leaf of p.children ?? [])
              for (const key of [
                "bold",
                "italic",
                "underline",
                "fontSize",
                "color",
              ] as const)
                if (s[key] !== undefined) leaf[key] = s[key];
          }
        }
      }
  }
  layoutTable(table);
}

/** Delete native topic descendants and detach surviving connectors, as in 0.5.0 UI. */
export function removeCanvasElements(model: CanvasModel, ids: string[]) {
  const before = model.getValue().scene,
    next = structuredClone(before),
    all = canvasSceneNodes(next),
    removed = new Set(ids);
  for (const id of ids)
    if (!all.some((n) => n.id === id)) fail(400, `画布元素不存在：${id}`);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of all) {
      if (
        n.data?.kind === "mind-node" &&
        removed.has(n.data.parentId) &&
        !removed.has(n.id)
      ) {
        removed.add(n.id);
        changed = true;
      }
      if (removed.has(n.id))
        for (const child of n.children ?? [])
          if (!removed.has(child.id)) {
            removed.add(child.id);
            changed = true;
          }
      if (
        n.data?.kind === "mindmap" &&
        n.children?.some((c) => c.data?.root && removed.has(c.id)) &&
        !removed.has(n.id)
      ) {
        removed.add(n.id);
        changed = true;
      }
      if (
        n.data?.kind === "mind-edge" &&
        (removed.has(n.data.sourceId) || removed.has(n.data.targetId))
      )
        removed.add(n.id);
    }
  }
  const prune = (n: SceneNode) => {
    n.children = (n.children ?? []).filter((c) => !removed.has(c.id!));
    for (const c of n.children) if (c.children) prune(c);
  };
  prune(next);
  for (const n of canvasSceneNodes(next))
    if (n.data) {
      const keys = ["connector", "template-edge"].includes(n.data.kind)
        ? ["sourceId", "targetId", "labelId"]
        : n.data.kind === "connector-label"
          ? ["ownerId"]
          : [];
      for (const key of keys) if (removed.has(n.data[key])) delete n.data[key];
    }
  model.applyScene(next, before);
}
export function executeCanvasWorkflow(model: CanvasModel, op: any): boolean {
  const create = (
    {
      createFlowchart: diagram,
      createMindmap: mindmap,
      createTable,
      createContainer: container,
    } as Record<string, (op: any) => N>
  )[op.type];
  if (create) {
    model.add(create(op));
    return true;
  }
  if (op.type === "diagramEdge") {
    const before = model.getValue().scene, next = structuredClone(before);
    const all = canvasSceneNodes(next), byId = new Map(all.map(n => [n.id, n]));
    const parents = new Map<string, string>();
    for (const n of all) for (const child of n.children ?? []) parents.set(child.id, n.id);
    const edge = byId.get(op.id), source = byId.get(edge?.data?.sourceId), target = byId.get(edge?.data?.targetId);
    if (edge?.data?.kind !== "connector" || source?.data?.kind !== "diagram-node" || target?.data?.kind !== "diagram-node" ||
        parents.get(edge.id) !== parents.get(source.id) || parents.get(edge.id) !== parents.get(target.id) ||
        edge.data.startHead !== "none" || edge.data.endHead !== "arrow" ||
        ["axis", "bend", "vertices", "curveOffset"].some(key => edge.data![key] !== undefined) ||
        ![source, target].every(n => [n.x, n.y, n.width, n.height].every(v => typeof v === "number" && Number.isFinite(v)) &&
          (n.rotation === undefined || n.rotation === 0) && [n.scale, n.scaleX, n.scaleY].every(v => v === undefined || v === 1)))
      fail(400, "diagramEdge 仅支持同一流程图内未旋转缩放的原生节点及普通箭头；请完整读取目标连接器", { code: "canvas_diagram_node_invalid" });
    if (op.autoRoute) {
      if ([op.sourcePort, op.targetPort, op.mode, op.offset].some(v => v !== undefined))
        fail(400, "autoRoute 自动选择端口与绕行，请省略 sourcePort/targetPort/mode/offset", { code: "canvas_diagram_node_invalid" });
      const siblings = all.filter(n => parents.get(n.id) === parents.get(edge.id));
      const diagramNodes = siblings.filter(n => n.data?.kind === "diagram-node");
      if (diagramNodes.some(n => ![n.x, n.y, n.width, n.height].every(v => typeof v === "number" && Number.isFinite(v)) ||
        (n.rotation !== undefined && n.rotation !== 0) || [n.scale, n.scaleX, n.scaleY].some(v => v !== undefined && v !== 1)))
        fail(400, "自动走线需要同组节点未旋转缩放，请使用明确端口或原生界面", { code: "canvas_diagram_node_invalid" });
      const others = siblings.filter(n => n.id !== edge.id && n.data?.kind === "connector" &&
        ["straight", "elbow"].includes(n.data.mode) && n.data.sourceAnchor && n.data.targetAnchor &&
        [n.data.from?.x, n.data.from?.y, n.data.to?.x, n.data.to?.y].every(v => typeof v === "number" && Number.isFinite(v)))
        .map(n => canvasConnectorRoute(n.data!.from, n.data!.to, n.data!.sourceAnchor, n.data!.targetAnchor, n.data!.mode, n.data!.offset).points);
      const automatic = autoCanvasConnector(diagramNodes.map(n => ({ id: n.id, x: Number(n.x), y: Number(n.y), width: Number(n.width), height: Number(n.height) })), source.id, target.id, others);
      op = { ...op, ...automatic, mode: "elbow", offset: automatic.offset ?? null };
    } else if (!op.sourcePort || !op.targetPort) {
      fail(400, "明确提供 sourcePort/targetPort，或用 autoRoute:true 自动选择原生端口与绕行", { code: "canvas_diagram_node_invalid" });
    }
    const labelBox = edge.data.labelId ? byId.get(edge.data.labelId) : undefined;
    const text = labelBox?.children?.find(n => n.tag === "Text");
    if (edge.data.labelId && (!labelBox || labelBox.data?.ownerId !== edge.id || typeof text?.text !== "string" ||
        ![labelBox.width, labelBox.height].every(v => typeof v === "number" && Number.isFinite(v))))
      fail(400, "连接器标签结构无效，请完整读取后修正", { code: "canvas_diagram_node_invalid" });
    const routeOffset = op.offset === null ? undefined : op.offset !== undefined ? op.offset : edge.data.offset;
    const mode = op.mode ?? edge.data.mode;
    if (!["straight", "elbow"].includes(mode) || (routeOffset !== undefined && (typeof routeOffset !== "number" || !Number.isFinite(routeOffset))))
      fail(400, "请明确选择 straight/elbow 及有效绕行参数", { code: "canvas_diagram_node_invalid" });
    if (op.autoLabel && op.labelOffset !== undefined) fail(400, "autoLabel 与 labelOffset 不能同时提供", { code: "canvas_diagram_node_invalid" });
    const labelOffset = op.autoLabel ? undefined : op.labelOffset ?? labelBox?.data?.offset ?? { x: 0, y: 0 };
    if (labelOffset && ![labelOffset.x, labelOffset.y].every(v => typeof v === "number" && Number.isFinite(v)))
      fail(400, "连接器标签偏移无效", { code: "canvas_diagram_node_invalid" });
    const generated = diagram({ id: "route-calculation", x: 0, y: 0,
      labelObstacles: all.filter(n => n.data?.kind === "diagram-node" && parents.get(n.id) === parents.get(edge.id)),
      labelOccupied: all.filter(n => n.id !== labelBox?.id && n.data?.kind === "connector-label" && parents.get(n.id) === parents.get(edge.id)),
      nodes: [source, target].map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, shape: n.data!.shape, text: "" })),
      edges: [{ id: edge.id, sourceId: source.id, targetId: target.id, sourcePort: op.sourcePort, targetPort: op.targetPort,
        mode, offset: routeOffset, label: text?.text, labelOffset }],
    }).children!;
    const route = generated.find(n => n.id === edge.id)!;
    const { labelId: _label, ...geometry } = route.data!;
    edge.path = route.path;
    edge.data = { ...edge.data, ...geometry };
    if (op.offset === null) delete edge.data.offset;
    const box = generated.find(n => n.data?.kind === "connector-label");
    if (labelBox && box) {
      labelBox.x = Number(box.x) + (Number(box.width) - Number(labelBox.width)) / 2;
      labelBox.y = Number(box.y) + (Number(box.height) - Number(labelBox.height)) / 2;
      if (op.autoLabel || op.labelOffset !== undefined)
        labelBox.data = { ...labelBox.data, offset: box.data!.offset };
      const parent = canvasSceneNodes(next).find(n => n.id === parents.get(edge.id)) ?? next;
      const children = parent.children! as N[];
      const labelIndex = children.findIndex(n => n.id === labelBox.id);
      const lastLine = children.findLastIndex(n => n.data?.kind === "connector");
      // Moving an already visible label on every reroute would repeatedly halve
      // native ordering keys and eventually exhaust their numeric precision.
      if (labelIndex <= lastLine) {
        children.splice(labelIndex, 1);
        children.splice(lastLine, 0, labelBox);
      }
    }
    model.applyScene(next, before);
    return true;
  }
  if (op.type === "diagramNode") {
    const before = model.getValue().scene, next = structuredClone(before);
    const node = canvasSceneNodes(next).find(n => n.id === op.id);
    const body = node?.children?.find(n => n.data?.kind === "diagram-body");
    const text = node?.children?.find(n => n.tag === "Text" && n.data?.kind === "node-label");
    if (node?.data?.kind !== "diagram-node" || !body || !text ||
        typeof text.x !== "number" || typeof text.y !== "number")
      fail(400, "请先完整读取目标；diagramNode 只操作包含原生 diagram-body 和 node-label 的流程节点", { code: "canvas_diagram_node_invalid" });
    if (op.width !== undefined) {
      if (op.width <= 2 * text.x) fail(400, "流程节点宽度不足以容纳文字边距", { code: "canvas_diagram_node_invalid" });
      node.width = body.width = op.width;
      text.width = op.width - 2 * text.x;
    }
    if (op.height !== undefined) {
      if (op.height <= 2 * text.y) fail(400, "流程节点高度不足以容纳文字边距", { code: "canvas_diagram_node_invalid" });
      node.height = body.height = op.height;
      text.height = op.height - 2 * text.y;
    }
    if ((op.width !== undefined || op.height !== undefined) && node.data.shape === "diamond") {
      const w = Number(body.width), h = Number(body.height);
      body.path = `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`;
    }
    if (op.fill !== undefined) body.fill = op.fill;
    if (op.stroke !== undefined) body.stroke = op.stroke;
    if (op.width !== undefined || op.height !== undefined) {
      const all = canvasSceneNodes(next), byId = new Map(all.map(n => [n.id, n]));
      const parents = new Map<string, string>();
      for (const n of all) for (const child of n.children ?? []) parents.set(child.id, n.id);
      for (const edge of all.filter(n => n.data?.kind === "connector" &&
        [n.data.sourceId, n.data.targetId].includes(node.id))) {
        const d = edge.data!, source = byId.get(d.sourceId), target = byId.get(d.targetId);
        const anchors = [d.sourceAnchor, d.targetAnchor];
        if (![source, target].every(n => n?.data?.kind === "diagram-node" && parents.get(n.id) === parents.get(edge.id) &&
          [n.x, n.y, n.width, n.height].every(v => typeof v === "number" && Number.isFinite(v)) &&
          (n.rotation === undefined || n.rotation === 0) && [n.scale, n.scaleX, n.scaleY].every(v => v === undefined || v === 1)) ||
          !anchors.every(a => a && [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].some(([x, y]) => a.x === x && a.y === y)) ||
          !["straight", "elbow"].includes(d.mode) || d.startHead !== "none" || d.endHead !== "arrow" ||
          ["axis", "bend", "vertices", "curveOffset"].some(key => d[key] !== undefined) ||
          (d.offset !== undefined && (typeof d.offset !== "number" || !Number.isFinite(d.offset))))
          fail(400, `连接器 ${edge.id} 不支持随 diagramNode 调整尺寸，请使用原生界面保留复杂走线`, { code: "canvas_diagram_node_invalid" });
        const from = { x: Number(source!.x) + Number(source!.width) * d.sourceAnchor.x, y: Number(source!.y) + Number(source!.height) * d.sourceAnchor.y };
        const to = { x: Number(target!.x) + Number(target!.width) * d.targetAnchor.x, y: Number(target!.y) + Number(target!.height) * d.targetAnchor.y };
        const route = canvasConnectorRoute(from, to, d.sourceAnchor, d.targetAnchor, d.mode, d.offset);
        edge.data = { ...d, from, to };
        edge.path = route.path;
        if (d.labelId) {
          const box = byId.get(d.labelId), offset = box?.data?.offset;
          if (box?.data?.kind !== "connector-label" || box.data.ownerId !== edge.id ||
            ![box.width, box.height, offset === undefined ? 0 : offset.x, offset === undefined ? 0 : offset.y]
              .every(v => typeof v === "number" && Number.isFinite(v)))
            fail(400, `连接器 ${edge.id} 标签结构无效，尚未调整节点尺寸`, { code: "canvas_diagram_node_invalid" });
          box.x = route.middle.x + (offset?.x ?? 0) - Number(box.width) / 2;
          box.y = route.middle.y + (offset?.y ?? 0) - Number(box.height) / 2;
        }
      }
    }
    model.applyScene(next, before);
    return true;
  }
  if (op.type !== "table") return false;
  const before = model.getValue().scene,
    next = structuredClone(before);
  const table =
    canvasSceneNodes(next).find((n) => n.id === op.id) ??
    fail(400, "画布表格不存在");
  tableEdit(table, op.command);
  model.applyScene(next, before);
  return true;
}
