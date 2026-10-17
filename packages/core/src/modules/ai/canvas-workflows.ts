import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CanvasModel, SceneNode } from "@smartdoca/canvas/model";
import { fail } from "../../shared/errors.js";

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
          sourcePort: z.enum(["top", "right", "bottom", "left"]).optional(),
          targetPort: z.enum(["top", "right", "bottom", "left"]).optional(),
          offset: number.optional(),
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
  }),
  z.strictObject({ type: z.literal("table"), id, command: canvasTableCommand }),
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
  const edges: N[] = op.edges.flatMap((edge: any) => {
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
    const sourceVertical = sourceAnchor.y === 0 || sourceAnchor.y === 1;
    const targetVertical = targetAnchor.y === 0 || targetAnchor.y === 1;
    let points = [from, to];
    if (edge.mode === "elbow") {
      const mid = sourceVertical ? (from.y + to.y) / 2 : (from.x + to.x) / 2;
      if (edge.offset !== undefined && sourceVertical === targetVertical) {
        const start = sourceVertical
          ? { x: from.x, y: from.y + (sourceAnchor.y === 0 ? -32 : 32) }
          : { x: from.x + (sourceAnchor.x === 0 ? -32 : 32), y: from.y };
        const end = targetVertical
          ? { x: to.x, y: to.y + (targetAnchor.y === 0 ? -32 : 32) }
          : { x: to.x + (targetAnchor.x === 0 ? -32 : 32), y: to.y };
        points = sourceVertical
          ? [
              from,
              start,
              { x: edge.offset, y: start.y },
              { x: edge.offset, y: end.y },
              end,
              to,
            ]
          : [
              from,
              start,
              { x: start.x, y: edge.offset },
              { x: end.x, y: edge.offset },
              end,
              to,
            ];
      } else if (sourceVertical !== targetVertical)
        points = [
          from,
          sourceVertical ? { x: from.x, y: to.y } : { x: to.x, y: from.y },
          to,
        ];
      else
        points = sourceVertical
          ? [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to]
          : [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to];
    }
    const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    let remaining = lengths.reduce((a, b) => a + b, 0) / 2,
      middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i]!) {
        const ratio = remaining / (lengths[i] || 1);
        middle = {
          x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * ratio,
          y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * ratio,
        };
        break;
      }
      remaining -= lengths[i]!;
    }
    const control =
      [...points].reverse().find((p) => p.x !== to.x || p.y !== to.y) ?? from;
    const angle = Math.atan2(to.y - control.y, to.x - control.x);
    const head = `M${to.x - 9 * Math.cos(angle - 0.48)} ${to.y - 9 * Math.sin(angle - 0.48)}L${to.x} ${to.y}L${to.x - 9 * Math.cos(angle + 0.48)} ${to.y - 9 * Math.sin(angle + 0.48)}`;
    const path =
      points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + head;
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
      const boxId = uuid();
      result[0]!.data!.labelId = boxId;
      result.push({
        id: boxId,
        tag: "Frame",
        name: "connector-label",
        x: middle.x - 48,
        y: middle.y - 14,
        width: 96,
        height: 28,
        fill: "#ffffff",
        hitChildren: false,
        editable: true,
        data: { kind: "connector-label", ownerId: edge.id },
        children: [
          label(uuid(), edge.label, 5, 4, 86, 20, {
            fontSize: 13,
            textAlign: "center",
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
    children: [...edges, ...nodes],
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
