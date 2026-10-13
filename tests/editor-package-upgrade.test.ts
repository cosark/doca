import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Doc, encodeStateAsUpdate } from "@smartdoca/slate/yjs";
import { validateEditOperations } from "@core/modules/ai/edit-schema.js";
import { DocaYjsDocument } from "@core/modules/documents/codecs/rich-runtime.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import {
  b64,
  unb64,
  createDocuments,
  restoreDocument,
} from "@core/modules/collaboration/documents.js";
import { openTestDatabase } from "./database.js";

const diagram = () => ({
  id: "new-diagram",
  type: "flowchart" as const,
  children: [{ text: "" }],
  nodes: [
    {
      id: "arrow",
      label: "交付",
      shape: "block-arrow" as const,
      x: 20,
      y: 40,
      width: 180,
      height: 120,
      arrowDirection: "down" as const,
      arrowRoute: "step" as const,
      arrowThickness: 22,
      arrowHeadSize: 42,
      arrowBend: 65,
    },
    { id: "browser", label: "页面", shape: "browser" as const, x: 300, y: 40 },
  ],
  edges: [
    {
      id: "manual",
      source: "arrow",
      target: "browser",
      lineType: "step" as const,
      routeMode: "manual" as const,
      vertices: [{ x: 240, y: 180 }],
      sourceAnchor: {
        name: "topLeft",
        args: { dx: "100%", dy: "50%", rotate: true },
      },
      targetAnchor: "left",
    },
  ],
});

it.each(
  "circle ellipse triangle hexagon pentagon octagon star cross cloud server browser swimlane rectangle block-arrow".split(
    " ",
  ),
)("accepts the shipped %s flowchart shape through AI commands", (shape) => {
  const block = diagram();
  expect(() =>
    validateEditOperations("rich_text", [
      {
        type: "insertBlock",
        block: {
          ...block,
          nodes: [{ ...block.nodes[0], shape }, block.nodes[1]],
        },
      },
    ]),
  ).not.toThrow();
});

it.each([
  { arrowDirection: "diagonal" },
  { arrowRoute: "curve" },
  { arrowThickness: -1 },
  { arrowHeadSize: Infinity },
  { arrowBend: 101 },
])("rejects invalid native arrow geometry %j", (patch) => {
  const block = diagram();
  expect(() =>
    validateEditOperations("rich_text", [
      {
        type: "insertBlock",
        block: {
          ...block,
          nodes: [{ ...block.nodes[0], ...patch }, block.nodes[1]],
        },
      },
    ]),
  ).toThrow();
});

it.each([
  { routeMode: "unknown" },
  { vertices: [{ x: "240", y: 180 }] },
  { sourceAnchor: { name: "topLeft", args: { dx: { unsafe: true } } } },
])("rejects invalid manual routes and anchor arguments %j", (patch) => {
  const block = diagram();
  expect(() =>
    validateEditOperations("rich_text", [
      {
        type: "insertBlock",
        block: { ...block, edges: [{ ...block.edges[0], ...patch }] },
      },
    ]),
  ).toThrow();
});

it("preserves native arrow and manual route fields through durable ACK, remote replay, undo and checkpoint restore", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const replicas: {
    doc: Doc;
    runtime: DocaYjsDocument;
    events: Uint8Array[];
  }[] = [];
  try {
    const owner = {
      ...(await createUser(
        db,
        {
          login: "upgradeqa",
          displayName: "QA",
          password: "isolated-upgrade-2026",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
    const resource = await createContent(db).create(owner, {
      kind: "document",
      format: "rich_text",
      title: "Native diagram upgrade",
    });
    const documents = createDocuments(db);
    const protocol = {
      codec: "slate-kit",
      schemaVersion: 3,
      protocolVersion: 1,
    };
    const initial = await documents.exchange(owner, resource.id, protocol);
    for (let i = 0; i < 2; i++) {
      const doc = new Doc(),
        runtime = new DocaYjsDocument(doc),
        events: Uint8Array[] = [];
      runtime.restore(unb64(initial.update));
      runtime.onLocalUpdate((update) => events.push(update));
      replicas.push({ doc, runtime, events });
    }
    const [a, b] = replicas as [
      (typeof replicas)[number],
      (typeof replicas)[number],
    ];
    const block = diagram();
    const command = { type: "insertBlock" as const, block };
    validateEditOperations("rich_text", [command]);
    const update = a.runtime.execute(command);
    expect(a.events).toHaveLength(1);
    const message = {
      ...protocol,
      epochId: initial.epochId,
      messageId: randomUUID(),
      update: b64(update),
    };
    expect((await documents.exchange(owner, resource.id, message)).seq).toBe(1);
    expect((await documents.exchange(owner, resource.id, message)).seq).toBe(1);
    b.runtime.applyRemoteUpdate(update);
    b.runtime.applyRemoteUpdate(update);
    expect(b.events).toHaveLength(0);
    expect(b.runtime.getValue()).toEqual(a.runtime.getValue());
    const saved = await restoreDocument(db, resource.id);
    try {
      expect(
        saved.runtime
          .getValue()
          .find((node) => "id" in node && node.id === block.id),
      ).toEqual(block);
      const restored = new DocaYjsDocument(new Doc());
      try {
        restored.restore(encodeStateAsUpdate(saved.doc));
        expect(restored.getValue()).toEqual(saved.runtime.getValue());
      } finally {
        restored.destroy();
        restored.doc.destroy();
      }
    } finally {
      saved.destroy();
    }
    a.runtime.undo();
    expect(
      a.runtime.getValue().some((node) => "id" in node && node.id === block.id),
    ).toBe(false);
    a.runtime.redo();
    expect(
      a.runtime.getValue().find((node) => "id" in node && node.id === block.id),
    ).toEqual(block);
    expect(a.events).toHaveLength(3);
    expect(b.events).toHaveLength(0);
  } finally {
    for (const replica of replicas) {
      replica.runtime.destroy();
      replica.doc.destroy();
    }
    await db.destroy();
  }
});
