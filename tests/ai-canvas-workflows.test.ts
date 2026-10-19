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

it("rejects painting the transparent diagram wrapper and preserves the whole batch", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 10, y: 10,
    nodes: [{ id: "card", text: "video_books\n视频书\nid, data", x: 0, y: 0, width: 300, height: 140, shape: "rounded" }], edges: [] }]);
  const before = await read();
  const card = canvasSceneNodes((before.value as any).scene).find(n => n.id === "card")!;
  const body = card.children!.find(n => n.data?.kind === "diagram-body")!;
  await expect(edit([
    { type: "patch", id: body.id, patch: { fill: "#ff0000" } },
    { type: "patch", id: "card", patch: { fill: "#ff0000" } },
  ])).rejects.toThrow(body.id);
  expect(await read()).toEqual(before);
  await edit([{ type: "patch", id: body.id, patch: { fill: "#fce8e6", stroke: "#d93025" } }]);
  const nodes = canvasSceneNodes(((await read()).value as any).scene);
  expect(nodes.find(n => n.id === "card")!.fill).toBe("transparent");
  expect(nodes.find(n => n.id === body.id)).toMatchObject({ fill: "#fce8e6", stroke: "#d93025" });
  const saved = await read();
  await expect(edit([{ type: "add", parentId: "root", element: { id: "invalid", tag: "Text", text: "无效" } }])).rejects.toThrow('不能填写 "root"');
  expect(await read()).toEqual(saved);
});

it("sizes new connector labels for complete field names instead of wrapping them into the route", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 20, y: 20,
    nodes: ["families", "video_books"].map((id, index) => ({ id, text: id, x: index * 500, y: 0, width: 280, height: 120, shape: "rect" })),
    edges: [{ id: "relation", sourceId: "families", targetId: "video_books", mode: "elbow", label: "source_family_id", labelOffset: { x: 0, y: -30 } }] }]);
  const nodes = canvasSceneNodes(((await read()).value as any).scene);
  const edge = nodes.find(n => n.id === "relation")!;
  const box = nodes.find(n => n.id === edge.data!.labelId)!;
  expect(box.width).toBeGreaterThan(120);
  expect(box.children![0]).toMatchObject({ text: "source_family_id", textWrap: "none" });
  expect(box.children![0]!.width).toBeGreaterThan(110);
  expect(box.data).toMatchObject({ ownerId: "relation", offset: { x: 0, y: -30 } });
  const outline = documentReadPayload("canvas", (await read()).value).outline as any;
  const children = outline.children[0].children;
  expect(children.find((n: any) => n.id === "relation").labelId).toBe(box.id);
  expect(children.find((n: any) => n.id === box.id).ownerId).toBe("relation");
});

it("rejects overlapping new flowchart cards atomically with the conflicting IDs", async () => {
  const before = await read();
  await expect(edit([{ type: "createFlowchart", id: "flow", x: 0, y: 0,
    nodes: ["logs", "imports"].map((id, index) => ({ id, text: id, x: index * 200, y: 0, width: 280, height: 120, shape: "rect" })), edges: [] }])).rejects.toThrow("logs 与 imports");
  expect(await read()).toEqual(before);
});

it("rejects multiline labels that cannot fit their explicit node height before saving", async () => {
  const before = await read();
  await expect(edit([{ type: "createFlowchart", id: "flow", x: 0, y: 0,
    nodes: [{ id: "logs", text: "logs\n运行日志\nid, project_id", x: 0, y: 0, width: 260, height: 78, shape: "rect" }], edges: [] }])).rejects.toThrow("至少需要 96px");
  expect(await read()).toEqual(before);
});

it("rejects reusing removed IDs without clearing the old diagram, and can atomically replace it with fresh IDs", async () => {
  const create = (id: string, nodeId: string) => ({ type: "createFlowchart", id, x: 0, y: 0,
    nodes: [{ id: nodeId, text: "数据库表", x: 0, y: 0, width: 280, height: 120, shape: "rect" }], edges: [] });
  await edit([create("flow", "card")]);
  const before = await read();
  await expect(edit([{ type: "remove", ids: ["flow"] }, create("flow", "card")])).rejects.toThrow("删除后也不能重新新增相同 ID");
  expect(await read()).toEqual(before);
  await edit([create("replacement", "new-card"), { type: "remove", ids: ["flow"] }]);
  const all = canvasSceneNodes(((await read()).value as any).scene);
  expect(all.some(n => n.id === "new-card")).toBe(true);
  expect(all.some(n => n.id === "card")).toBe(false);
});

it("resizes and colors native diagram parts together without replacing identities or text", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 20, y: 20,
    nodes: [{ id: "card", text: "video_books\n视频书\nid, data", x: 0, y: 0, width: 280, height: 120, shape: "diamond" }], edges: [] }]);
  const before = await read();
  const original = canvasSceneNodes((before.value as any).scene);
  await expect(edit([{ type: "patch", id: "card", patch: { width: 360 } }])).rejects.toThrow("diagramNode");
  expect(await read()).toEqual(before);
  await edit([{ type: "diagramNode", id: "card", width: 360, height: 180, fill: "#fce8e6", stroke: "#d93025" }]);
  const after = canvasSceneNodes(((await read()).value as any).scene);
  expect(after.map(n => n.id)).toEqual(original.map(n => n.id));
  const card = after.find(n => n.id === "card")!;
  expect(card).toMatchObject({ width: 360, height: 180, fill: "transparent" });
  expect(card.children!.find(n => n.data?.kind === "diagram-body")).toMatchObject({ width: 360, height: 180, fill: "#fce8e6", stroke: "#d93025", path: "M180 0L360 90L180 180L0 90Z" });
  expect(card.children!.find(n => n.tag === "Text")).toMatchObject({ width: 332, height: 156, text: "video_books\n视频书\nid, data" });
});

it("reroutes existing connectors and moves labels without rebuilding nodes, text or IDs", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 50, y: 50,
    nodes: ["a", "b"].map((id, index) => ({ id, text: id, x: index * 500, y: index * 200, width: 280, height: 120, shape: "rect" })),
    edges: [{ id: "edge", sourceId: "a", targetId: "b", mode: "elbow", offset: 420, label: "project_id" }] }]);
  const before = await read(), original = canvasSceneNodes((before.value as any).scene);
  const oldEdge = original.find(n => n.id === "edge")!, labelId = oldEdge.data!.labelId;
  await edit([{ type: "diagramEdge", id: "edge", sourcePort: "bottom", targetPort: "left", mode: "elbow", offset: null, labelOffset: { x: 15, y: -30 } }]);
  const updated = canvasSceneNodes(((await read()).value as any).scene), edge = updated.find(n => n.id === "edge")!;
  expect(updated.map(n => n.id)).toEqual(original.map(n => n.id));
  expect(updated.filter(n => !["flow", "edge", labelId].includes(n.id))).toEqual(original.filter(n => !["flow", "edge", labelId].includes(n.id)));
  expect(edge.data).toMatchObject({ sourceId: "a", targetId: "b", sourceAnchor: { x: 0.5, y: 1 }, targetAnchor: { x: 0, y: 0.5 }, from: { x: 140, y: 120 }, to: { x: 500, y: 260 }, labelId });
  expect(edge.data!.offset).toBeUndefined();
  expect(edge.path).not.toBe(oldEdge.path);
  expect(updated.find(n => n.id === labelId)!.data).toMatchObject({ kind: "connector-label", ownerId: "edge", offset: { x: 15, y: -30 } });
  const saved = await read();
  await expect(edit([{ type: "patch", id: "a", patch: { rotation: 45 } }, { type: "diagramEdge", id: "edge", sourcePort: "right", targetPort: "left" }])).rejects.toThrow("未旋转缩放");
  expect(await read()).toEqual(saved);
});

it("can reroute labels repeatedly without consuming native element ordering precision", () => {
  const model = CanvasModel.initialize(randomUUID(), { version: 1, scene: { id: "scene", tag: "Group", children: [] } });
  try {
    executeCanvasWorkflow(model, { type: "createFlowchart", id: "flow", x: 0, y: 0,
      nodes: ["a", "b"].map((id, i) => ({ id, text: id, x: i * 500, y: i * 300, width: 240, height: 120, shape: "rect" })),
      edges: ["first", "second"].map(id => ({ id, sourceId: "a", targetId: "b", mode: "elbow", label: id })) });
    const original = canvasSceneNodes(model.getValue().scene).map(n => n.id);
    for (let round = 0; round < 80; round++) for (const id of ["second", "first"])
      executeCanvasWorkflow(model, { type: "diagramEdge", id, sourcePort: round % 2 ? "right" : "bottom", targetPort: "left", autoLabel: true });
    expect(canvasSceneNodes(model.getValue().scene).map(n => n.id)).toEqual(original);
  } finally { model.dispose(); }
});

it("rebinds existing endpoints and labels atomically when resizing a diagram node", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 0, y: 0,
    nodes: [{ id: "a", text: "A", x: 0, y: 0, width: 200, height: 100, shape: "rect" },
      { id: "b", text: "B", x: 500, y: 200, width: 200, height: 100, shape: "rect" }],
    edges: [{ id: "edge", sourceId: "a", targetId: "b", sourcePort: "right", targetPort: "left", mode: "elbow", label: "fk" }] }]);
  const before = canvasSceneNodes(((await read()).value as any).scene);
  const labelId = before.find(n => n.id === "edge")!.data!.labelId;
  await edit([{ type: "diagramNode", id: "a", width: 260, height: 140 }]);
  const after = canvasSceneNodes(((await read()).value as any).scene);
  expect(after.map(n => n.id)).toEqual(before.map(n => n.id));
  expect(after.find(n => n.id === "edge")!.data).toMatchObject({ from: { x: 260, y: 70 }, to: { x: 500, y: 250 }, labelId });
  expect(after.find(n => n.id === labelId)).toMatchObject({ x: 332, y: 146, width: 96, height: 28 });
  expect(after.find(n => n.id === "edge")!.path).not.toEqual(before.find(n => n.id === "edge")!.path);
  await edit([{ type: "patch", id: "edge", patch: { data: { ...after.find(n => n.id === "edge")!.data, mode: "curve" } } }]);
  const unsupported = await read();
  await expect(edit([{ type: "diagramNode", id: "a", width: 300 }])).rejects.toThrow("保留复杂走线");
  expect(await read()).toEqual(unsupported);
});

it("automatically routes around an intervening card and preserves every existing object when rerouting", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 0, y: 0,
    nodes: [{ id: "a", text: "A", x: 0, y: 0, width: 200, height: 100, shape: "rect" },
      { id: "b", text: "B", x: 500, y: 0, width: 200, height: 100, shape: "rect" },
      { id: "obstacle", text: "其他表", x: 300, y: -50, width: 100, height: 200, shape: "rect" }],
    edges: [{ id: "edge", sourceId: "a", targetId: "b", mode: "elbow", autoRoute: true, autoLabel: true, label: "project_id" }] }]);
  const original = canvasSceneNodes(((await read()).value as any).scene);
  const edge = original.find(n => n.id === "edge")!;
  expect(edge.data).toMatchObject({ sourceId: "a", targetId: "b", sourceAnchor: { x: 1, y: .5 }, targetAnchor: { x: 0, y: .5 }, mode: "elbow", offset: -90 });
  expect(edge.path).toContain("L232 -90L468 -90");
  expect(edge.data!.autoRoute).toBeUndefined();
  expect(edge.data!.autoLabel).toBeUndefined();
  await edit([{ type: "diagramEdge", id: "edge", autoRoute: true, autoLabel: true }]);
  expect(canvasSceneNodes(((await read()).value as any).scene).map(n => n.id)).toEqual(original.map(n => n.id));
  const saved = await read();
  await expect(edit([{ type: "diagramEdge", id: "edge", autoRoute: true, sourcePort: "left" }])).rejects.toThrow("省略 sourcePort");
  expect(await read()).toEqual(saved);
});

it("honors explicitly centered new labels and rejects conflicting automatic and explicit offsets", async () => {
  await edit([{ type: "createFlowchart", id: "flow", x: 0, y: 0,
    nodes: ["a", "b"].map((id, i) => ({ id, text: id, x: i * 500, y: 0, width: 200, height: 100, shape: "rect" })),
    edges: [{ id: "edge", sourceId: "a", targetId: "b", mode: "straight", sourcePort: "right", targetPort: "left", autoLabel: false, label: "fk" }] }]);
  const label = canvasSceneNodes(((await read()).value as any).scene).find(n => n.data?.kind === "connector-label")!;
  expect(label).toMatchObject({ x: 302, y: 36, data: { offset: { x: 0, y: 0 } } });
  const before = await read();
  await expect(edit([{ type: "createFlowchart", id: "conflict", x: 0, y: 500,
    nodes: ["x", "y"].map((id, i) => ({ id, text: id, x: i * 500, y: 0, width: 200, height: 100, shape: "rect" })),
    edges: [{ id: "bad", sourceId: "x", targetId: "y", mode: "elbow", autoLabel: true, labelOffset: { x: 0, y: 0 }, label: "fk" }] }])).rejects.toThrow("不能同时提供");
  expect(await read()).toEqual(before);
});

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

it("creates complete device UIs as native children and retains the hierarchy on move and restore", async () => {
  const children = [
    {
      id: "card",
      tag: "Group",
      x: 24,
      y: 120,
      children: [
        {
          id: "card-bg",
          tag: "Rect",
          x: 0,
          y: 0,
          width: 342,
          height: 160,
          fill: "#eef4ff",
        },
        {
          id: "heading",
          tag: "Text",
          x: 16,
          y: 20,
          width: 310,
          height: 32,
          text: "今日阅读",
        },
      ],
    },
  ];
  const operation = {
    type: "createContainer",
    id: "phone-ui",
    x: 60,
    y: 80,
    containerType: "phone",
    title: "首页",
    children,
  };
  expect(
    editToolSchema("canvas").safeParse({
      resourceId,
      seq: 1,
      epochId: "epoch",
      operations: [operation],
    }).success,
  ).toBe(true);
  await edit([operation]);
  await edit([
    { type: "patch", id: "phone-ui", patch: { x: 800, y: 200 } },
    {
      type: "add",
      parentId: "phone-ui",
      element: {
        id: "button",
        tag: "Rect",
        x: 24,
        y: 700,
        width: 342,
        height: 48,
      },
    },
  ]);
  const saved = (await read()).value as any;
  expect(saved.scene.children).toHaveLength(1);
  const phone = saved.scene.children[0];
  expect(phone).toMatchObject({
    id: "phone-ui",
    x: 800,
    y: 200,
    data: { containerType: "phone" },
  });
  expect(phone.children.find((n: any) => n.id === "card")).toMatchObject({
    x: 24,
    y: 120,
    name: "group",
    children: [
      { id: "card-bg", name: "rect", x: 0, y: 0 },
      { id: "heading", name: "text", text: "今日阅读" },
    ],
  });
  expect(phone.children.some((n: any) => n.id === "button")).toBe(true);
  const outline = documentReadPayload("canvas", saved).outline as any;
  expect(outline.children[0].parentId).toBeNull();
  const card = outline.children[0].children.find((n: any) => n.id === "card");
  expect(card.parentId).toBe("phone-ui");
  expect(card.children.every((n: any) => n.parentId === "card")).toBe(true);
  const loaded = await restoreSurface(db, resourceId, "canvas");
  const checkpoint = {
    codec: "aidcanvas-yjs" as const,
    schemaVersion: 1 as const,
    epochId: loaded.epochId,
    update: loaded.update,
  };
  const model = CanvasModel.restore(checkpoint),
    peer = CanvasModel.restore(checkpoint);
  const local: Uint8Array[] = [],
    remote: Uint8Array[] = [];
  model.onLocalUpdate((u) => local.push(u.update));
  peer.onLocalUpdate((u) => remote.push(u.update));
  try {
    expect(model.getValue()).toEqual(saved);
    model.patch("phone-ui", { x: 1000 });
    peer.editText("heading", 0, 4, "本周阅读");
    model.applyUpdate({ ...checkpoint, update: remote[0]! });
    peer.applyUpdate({ ...checkpoint, update: local[0]! });
    expect(model.getValue()).toEqual(peer.getValue());
    expect(local).toHaveLength(1);
    expect(remote).toHaveLength(1);
    expect(model.getValue().scene.children).toHaveLength(1);
    expect(
      canvasSceneNodes(model.getValue().scene).find((n) => n.id === "heading")
        ?.text,
    ).toBe("本周阅读");
  } finally {
    model.dispose();
    peer.dispose();
  }
});

it("rejects invalid nested UI content and duplicate IDs without a partial container write", async () => {
  const before = await read();
  const container = {
    type: "createContainer",
    id: "phone-ui",
    x: 0,
    y: 0,
    containerType: "phone",
    title: "首页",
  };
  await expect(
    edit([
      {
        ...container,
        children: [
          {
            id: "group",
            tag: "Group",
            children: [{ id: "path", tag: "Path", d: "M0 0L10 10" }],
          },
        ],
      },
    ]),
  ).rejects.toThrow("d");
  expect(await read()).toEqual(before);
  await expect(
    edit([
      {
        ...container,
        children: [
          { id: "same", tag: "Rect" },
          { id: "same", tag: "Text", text: "重复" },
        ],
      },
    ]),
  ).rejects.toThrow();
  expect(await read()).toEqual(before);
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
    "创建一个 APP 的 UI 设计",
    "Design a mobile app UI",
  ]) {
    const formats = relevantSkillFormats(prompt);
    expect(formats.has("canvas")).toBe(true);
    expect(formats.has("spreadsheet")).toBe(false);
  }
  expect(
    relevantSkillFormats("修改这个表格", ["canvas"]).has("spreadsheet"),
  ).toBe(false);
});
