import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import {
  editAIDocument,
  readAIDocument,
} from "@core/workflows/ai-documents.js";
import { canvasSceneNodes } from "@core/modules/ai/canvas-workflows.js";
import { CanvasModel } from "@smartdoca/canvas/model";
import { restoreSurface } from "@core/modules/documents/codecs/surfaces.js";
import { documentReadPayload } from "@core/modules/ai/document-read.js";
import {
  editToolSchema,
  validateEditOperations,
} from "@core/modules/ai/edit-schema.js";
import { z } from "zod";
import { executeCanvasWorkflow } from "@core/modules/ai/canvas-workflows.js";
import { canvasTableSummary } from "@core/modules/ai/canvas-workflows.js";
import { relevantSkillFormats } from "@core/modules/ai/skills.js";

let db: Awaited<ReturnType<typeof openTestDatabase>>,
  ctx: any,
  resourceId: string;
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  ctx = {
    actor: {
      ...(await createUser(
        db,
        {
          login: "canvas-ai",
          displayName: "Canvas AI",
          password: "isolated-canvas-ai",
        },
        { bootstrap: true },
      )),
      admin: 1,
    },
  };
  resourceId = (
    await createContent(db).create(ctx.actor, {
      kind: "document",
      format: "canvas",
      title: "AI native workflows",
    })
  ).id;
});
afterEach(async () => {
  await db.destroy();
});
const read = () => readAIDocument(db, ctx, resourceId);
async function edit(operations: any[]) {
  const before = await read();
  return editAIDocument(
    db,
    ctx,
    resourceId,
    { seq: before.seq, epochId: before.epochId! },
    operations,
    randomUUID(),
  );
}
const topic = {
  id: "root",
  text: "产品",
  children: [
    { id: "design", text: "设计", children: [{ id: "ui", text: "界面" }] },
    { id: "dev", text: "开发" },
  ],
};

it("creates editable native diagrams, topics, tables and device children and restores the exact checkpoint", async () => {
  await edit([
    {
      type: "createFlowchart",
      id: "flow",
      x: 40,
      y: 40,
      nodes: [
        {
          id: "start",
          text: "提交",
          x: 0,
          y: 0,
          width: 160,
          height: 64,
          shape: "rounded",
        },
        {
          id: "check",
          text: "通过？",
          x: 260,
          y: 0,
          width: 160,
          height: 80,
          shape: "diamond",
        },
      ],
      edges: [
        {
          id: "edge",
          sourceId: "start",
          targetId: "check",
          mode: "elbow",
          label: "审核",
          sourcePort: "bottom",
          targetPort: "bottom",
          offset: 240,
        },
      ],
    },
    {
      type: "createMindmap",
      id: "mind",
      x: 500,
      y: 500,
      layout: "balanced",
      topic,
    },
    {
      type: "createTable",
      id: "table",
      x: 40,
      y: 700,
      cells: [
        ["任务", "负责人"],
        ["研发", "小林"],
      ],
    },
    {
      type: "createContainer",
      id: "phone",
      x: 1200,
      y: 40,
      containerType: "phone",
      title: "首页",
    },
    {
      type: "createContainer",
      id: "pad",
      x: 1700,
      y: 40,
      containerType: "tablet",
      title: "工作台",
    },
    {
      type: "add",
      parentId: "phone",
      element: {
        id: "card",
        tag: "Rect",
        x: 24,
        y: 120,
        width: 342,
        height: 160,
        fill: "#eef4ff",
      },
    },
  ]);
  const saved = (await read()).value as any;
  const all = canvasSceneNodes(saved.scene);
  expect(all.find((n) => n.id === "edge")?.data).toMatchObject({
    kind: "connector",
    sourceId: "start",
    targetId: "check",
    sourceAnchor: { x: 0.5, y: 1 },
    targetAnchor: { x: 0.5, y: 1 },
    offset: 240,
  });
  expect(all.find((n) => n.id === "edge")?.endArrow).toBeUndefined();
  expect(all.find((n) => n.id === "ui")?.data).toMatchObject({
    kind: "mind-node",
    parentId: "design",
  });
  expect(all.find((n) => n.id === "table")?.data).toMatchObject({
    kind: "table",
    rows: 2,
    columns: 2,
  });
  expect(
    all.find((n) => n.id === "phone")?.children?.some((n) => n.id === "card"),
  ).toBe(true);
  expect(all.find((n) => n.id === "pad")?.data?.containerType).toBe("tablet");
  const loaded = await restoreSurface(db, resourceId, "canvas");
  const model = CanvasModel.restore({
    codec: "aidcanvas-yjs",
    schemaVersion: 1,
    epochId: loaded.epochId,
    update: loaded.update,
  });
  const writes: unknown[] = [];
  model.onLocalUpdate((u) => writes.push(u));
  try {
    expect(model.getValue()).toEqual(saved);
    model.setReadOnly(true);
    expect(writes).toEqual([]);
  } finally {
    model.dispose();
  }
});

it("deletes logical topic descendants and their edges while retaining unrelated topics", async () => {
  await edit([
    {
      type: "createMindmap",
      id: "mind",
      x: 400,
      y: 200,
      layout: "right",
      topic,
    },
  ]);
  const before = await read();
  const opId = randomUUID(),
    operations = [{ type: "remove", ids: ["design"] }];
  const result = await editAIDocument(
    db,
    ctx,
    resourceId,
    { seq: before.seq, epochId: before.epochId! },
    operations,
    opId,
  );
  expect(
    await editAIDocument(
      db,
      ctx,
      resourceId,
      { seq: before.seq, epochId: before.epochId! },
      operations,
      opId,
    ),
  ).toEqual(result);
  const remaining = canvasSceneNodes(((await read()).value as any).scene);
  expect(remaining.some((n) => ["design", "ui"].includes(n.id))).toBe(false);
  expect(remaining.find((n) => n.id === "dev")).toBeTruthy();
  expect(remaining.filter((n) => n.data?.kind === "mind-edge")).toHaveLength(1);
  await edit([{ type: "remove", ids: ["root"] }]);
  expect(((await read()).value as any).scene.children).toEqual([]);
});

it("edits native table regions without losing other cells, preserves IDs and rejects partial writes", async () => {
  await edit([
    {
      type: "createTable",
      id: "table",
      x: 0,
      y: 0,
      cells: [
        ["任务", "人员"],
        ["设计", "小林"],
        ["研发", "小周"],
      ],
    },
  ]);
  const original = canvasSceneNodes(((await read()).value as any).scene).find(
    (n) => n.id === "table",
  )!;
  const originalCell = original.children!.find(
    (n) => n.data?.row === 1 && n.data?.column === 1,
  )!;
  await edit([
    {
      type: "table",
      id: "table",
      command: { kind: "cell", row: 1, column: 1, text: "小陈" },
    },
    {
      type: "table",
      id: "table",
      command: {
        kind: "style",
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
        style: { bold: true, backgroundColor: "#2563eb", color: "#ffffff" },
      },
    },
    {
      type: "table",
      id: "table",
      command: { kind: "resize", axis: "column", index: 0, size: 240 },
    },
    { type: "table", id: "table", command: { kind: "insert-row", index: 3 } },
    {
      type: "table",
      id: "table",
      command: { kind: "paste", row: 3, column: 0, cells: [["验收", "小李"]] },
    },
    {
      type: "table",
      id: "table",
      command: {
        kind: "merge",
        range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 },
      },
    },
  ]);
  const after = await read(),
    table = canvasSceneNodes((after.value as any).scene).find(
      (n) => n.id === "table",
    )!;
  expect(table.data!.columnWidths[0]).toBe(240);
  const summary = canvasTableSummary(after.value)[0]!;
  expect(summary.lastTwoRows).toEqual([2, 3]);
  expect(summary.merges).toEqual([
    { row: 1, column: 0, rowSpan: 2, columnSpan: 1 },
  ]);
  expect(
    table.children!.find((n) => n.id === originalCell.id)!.children![0]!.text,
  ).toBe("小陈");
  expect(
    table.children!.find((n) => n.data?.row === 1 && n.data?.column === 0)!
      .children![0]!.text,
  ).toBe("设计\n研发");
  await expect(
    edit([
      {
        type: "table",
        id: "table",
        command: { kind: "cell", row: 3, column: 0, text: "不应写入" },
      },
      {
        type: "table",
        id: "table",
        command: { kind: "cell", row: 99, column: 0, text: "越界" },
      },
    ]),
  ).rejects.toThrow("越界");
  expect(await read()).toEqual(after);
  await expect(
    edit([
      {
        type: "add",
        parentId: "table",
        element: {
          id: "rogue",
          tag: "Frame",
          name: "table-cell",
          data: { kind: "table-cell", row: 4, column: 0 },
        },
      },
    ]),
  ).rejects.toThrow("表格结构必须使用");
  await expect(
    edit([
      {
        type: "patch",
        id: "table",
        patch: { data: { kind: "table", rows: 99 } },
      },
    ]),
  ).rejects.toThrow("表格结构必须使用");
  await expect(
    edit([{ type: "remove", ids: [originalCell.id] }]),
  ).rejects.toThrow("表格结构必须使用");
  expect(await read()).toEqual(after);
  await edit([
    {
      type: "table",
      id: "table",
      command: {
        kind: "split",
        range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 },
      },
    },
    { type: "table", id: "table", command: { kind: "delete-row", index: 2 } },
  ]);
  expect(
    canvasSceneNodes(((await read()).value as any).scene).find(
      (n) => n.id === "table",
    )!.data!.rows,
  ).toBe(3);
});

it("rejects readonly, dangling diagram IDs and reused element IDs atomically", async () => {
  const before = await read();
  await expect(
    editAIDocument(
      db,
      { ...ctx, writable: false },
      resourceId,
      { seq: before.seq, epochId: before.epochId! },
      [
        {
          type: "createContainer",
          id: "phone",
          x: 0,
          y: 0,
          containerType: "phone",
          title: "首页",
        },
      ],
      randomUUID(),
    ),
  ).rejects.toThrow("仅允许读取");
  await expect(
    edit([
      {
        type: "createFlowchart",
        id: "flow",
        x: 0,
        y: 0,
        nodes: [
          {
            id: "n",
            text: "开始",
            x: 0,
            y: 0,
            width: 160,
            height: 64,
            shape: "rect",
          },
        ],
        edges: [
          { id: "e", sourceId: "n", targetId: "missing", mode: "straight" },
        ],
      },
    ]),
  ).rejects.toThrow("节点 ID");
  expect(await read()).toEqual(before);
});

it("advertises workflow fields, exact PPT table commands and scoped table reads", () => {
  for (const points of [
    [0, 80, 40, 0, 80, 80],
    [
      { x: 0, y: 80 },
      { x: 40, y: 0 },
      { x: 80, y: 80 },
    ],
  ])
    expect(() =>
      validateEditOperations("canvas", [
        { type: "add", element: { id: "triangle", tag: "Polygon", points } },
      ]),
    ).not.toThrow();
  expect(() =>
    validateEditOperations("canvas", [
      {
        type: "add",
        element: {
          id: "invisible",
          tag: "Polygon",
          points: [
            [0, 80],
            [40, 0],
            [80, 80],
          ],
        },
      },
    ]),
  ).toThrow("扁平数组");
  expect(() =>
    validateEditOperations("presentation", [
      { type: "pageSize", width: 12192000, height: 6858000 },
    ]),
  ).toThrow();
  expect(() =>
    validateEditOperations("presentation", [
      { type: "pageSize", width: 1280, height: 720 },
    ]),
  ).not.toThrow();
  expect(() =>
    validateEditOperations("canvas", [
      {
        type: "add",
        parentId: null,
        element: { id: "path", tag: "Path", path: "M0 0L40 0L20 30Z" },
      },
    ]),
  ).not.toThrow();
  expect(() =>
    validateEditOperations("canvas", [
      {
        type: "add",
        element: { id: "wrong-path", tag: "Path", d: "M0 0L40 0" },
      },
    ]),
  ).toThrow("d");
  const schema = JSON.stringify(z.toJSONSchema(editToolSchema("canvas")));
  for (const field of [
    "nodes",
    "edges",
    "topic",
    "containerType",
    "command",
    "range",
    "startColumn",
  ])
    expect(schema).toContain(`"${field}"`);
  expect(
    JSON.stringify(z.toJSONSchema(editToolSchema("presentation"))),
  ).toContain('"insert-row"');
  expect(() =>
    validateEditOperations("canvas", [
      {
        type: "add",
        element: {
          id: "native",
          tag: "Group",
          name: "mindmap",
          data: { kind: "mindmap" },
        },
      },
    ]),
  ).not.toThrow();
  const value = {
    size: { width: 9000000, height: 5000000 },
    slideOrder: ["s"],
    slides: {
      s: {
        elementOrder: ["t", "other"],
        elements: {
          t: {
            id: "t",
            type: "table",
            cells: [["任务"]],
            rowIds: ["r"],
            columnIds: ["c"],
          },
          other: { id: "other", type: "text" },
        },
      },
    },
  };
  const payload = documentReadPayload("presentation", value, {
    slideId: "s",
    elementId: "t",
  });
  expect(JSON.parse(payload.content!)).toMatchObject({
    element: { cells: [["任务"]], rowIds: ["r"] },
  });
  expect(payload.content).not.toContain("other");
});

it("merges independent table-cell edits with native identities, no remote echo, and readonly rejection", async () => {
  await edit([
    {
      type: "createTable",
      id: "table",
      x: 0,
      y: 0,
      cells: [
        ["任务", "负责人"],
        ["设计", "小林"],
      ],
    },
  ]);
  const loaded = await restoreSurface(db, resourceId, "canvas");
  const checkpoint = {
    codec: "aidcanvas-yjs" as const,
    schemaVersion: 1 as const,
    epochId: loaded.epochId,
    update: loaded.update,
  };
  const a = CanvasModel.restore(checkpoint),
    b = CanvasModel.restore(checkpoint);
  const updatesA: any[] = [],
    updatesB: any[] = [];
  a.onLocalUpdate((u) => updatesA.push(u));
  b.onLocalUpdate((u) => updatesB.push(u));
  try {
    executeCanvasWorkflow(a, {
      type: "table",
      id: "table",
      command: { kind: "cell", row: 1, column: 0, text: "新设计" },
    });
    executeCanvasWorkflow(b, {
      type: "table",
      id: "table",
      command: { kind: "cell", row: 1, column: 1, text: "小陈" },
    });
    a.applyUpdate({ ...checkpoint, update: updatesB[0].update });
    b.applyUpdate({ ...checkpoint, update: updatesA[0].update });
    expect(a.getValue()).toEqual(b.getValue());
    expect(JSON.stringify(a.getValue())).toContain("新设计");
    expect(JSON.stringify(a.getValue())).toContain("小陈");
    expect(updatesA).toHaveLength(1);
    expect(updatesB).toHaveLength(1);
    b.setReadOnly(true);
    expect(() =>
      executeCanvasWorkflow(b, {
        type: "table",
        id: "table",
        command: { kind: "cell", row: 0, column: 0, text: "越权" },
      }),
    ).toThrow();
    expect(a.getValue()).toEqual(b.getValue());
  } finally {
    a.dispose();
    b.dispose();
  }
});

it("routes device UI and canvas tables to the canvas manual without loading spreadsheet commands", () => {
  for (const prompt of [
    "设计手机和pad容器界面",
    "生成UI设计",
    "画一幅几何图案",
    "操作画布表格",
  ]) {
    const formats = relevantSkillFormats(prompt);
    expect(formats.has("canvas")).toBe(true);
    expect(formats.has("spreadsheet")).toBe(false);
  }
  expect(
    relevantSkillFormats("修改这个表格", ["canvas"]).has("spreadsheet"),
  ).toBe(false);
});
