import {
  CanvasModel,
  type CanvasPresence,
  type CanvasTextPresence,
} from "@smartdoca/canvas/model";
import { fail } from "../../../shared/errors.js";

/** Transient canvas presence; identity and color are always supplied by the gateway. */
export function canvasSelection(
  model: CanvasModel,
  input: Record<string, unknown>,
): CanvasPresence & { type: "elements"; epochId: string } {
  if (
    input.kind !== "elements" ||
    !Array.isArray(input.elementIds) ||
    input.elementIds.length > 100 ||
    !input.elementIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length < 160,
    )
  )
    fail(400, "画布选区无效");
  const elementIds = [...new Set(input.elementIds as string[])];
  if (
    elementIds.length &&
    !model.resolveAnchor({
      type: "elements",
      epochId: model.epochId,
      elementIds,
    }).valid
  )
    fail(409, "所选内容已删除");
  const selection: CanvasPresence & { type: "elements"; epochId: string } = {
    type: "elements",
    epochId: model.epochId,
    elementIds,
  };
  if (input.cursor !== undefined) {
    const cursor = input.cursor as { x?: unknown; y?: unknown } | null;
    if (
      !cursor ||
      ![cursor.x, cursor.y].every(
        (v) =>
          typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7,
      )
    )
      fail(400, "画布指针无效");
    selection.cursor = { x: cursor.x as number, y: cursor.y as number };
  }
  if (input.text !== undefined) {
    const text = input.text as CanvasTextPresence | null;
    if (
      !text ||
      text.epochId !== model.epochId ||
      typeof text.elementId !== "string" ||
      !elementIds.includes(text.elementId) ||
      ![text.anchor, text.focus].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 4096,
      )
    )
      fail(400, "画布文字选区无效");
    let valid = false;
    try {
      valid = !!model.resolveTextPresence(text);
    } catch {
      /* reject malformed relative positions */
    }
    if (!valid) fail(400, "画布文字选区无效");
    selection.text = {
      epochId: model.epochId,
      elementId: text.elementId,
      anchor: text.anchor,
      focus: text.focus,
    };
  }
  return selection;
}
