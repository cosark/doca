import { it, expect } from "vitest";
import { CanvasModel } from "@smartdoca/canvas/model";
import { canvasSelection } from "@core/modules/documents/codecs/canvas-presence.js";

it("forwards validated text and pointer presence without trusting identity or writing content", () => {
  const model = CanvasModel.initialize("qa-epoch", {
    version: 1,
    scene: { children: [{ id: "text", tag: "Text", text: "你好 canvas" }] },
  });
  const updates: unknown[] = [];
  model.onLocalUpdate((update) => updates.push(update));
  try {
    const text = model.captureTextPresence("text", { anchor: 1, focus: 4 })!;
    expect(text).toBeDefined();
    const input = {
      kind: "elements",
      elementIds: ["text"],
      cursor: { x: 12, y: -20 },
      text,
      userId: "spoofed",
    };
    expect(canvasSelection(model, input)).toEqual({
      type: "elements",
      epochId: "qa-epoch",
      elementIds: ["text"],
      cursor: input.cursor,
      text,
    });
    expect(
      canvasSelection(model, {
        kind: "elements",
        elementIds: [],
        cursor: { x: 1, y: 2 },
      }).elementIds,
    ).toEqual([]);
    expect(() =>
      canvasSelection(model, { ...input, text: { ...text, epochId: "wrong" } }),
    ).toThrow();
    expect(() =>
      canvasSelection(model, { ...input, text: { ...text, anchor: "{}" } }),
    ).toThrow();
    expect(() =>
      canvasSelection(model, { ...input, cursor: { x: Infinity, y: 1 } }),
    ).toThrow();
    expect(() =>
      canvasSelection(model, { ...input, elementIds: ["deleted"] }),
    ).toThrow();
    expect(updates).toEqual([]);
  } finally {
    model.dispose();
  }
});
