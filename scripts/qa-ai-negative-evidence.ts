type Call = { id: string; name?: string; arguments?: string };
type Reply = { callId?: string; content: unknown };

/** Current live-ID negative case only; commentary and receipts are not errors. */
export function rejectedExistingCanvasContainer(
  reply: Reply,
  call: Call | undefined,
  existingId: string,
) {
  if (call?.name !== "canvas_edit" || reply.callId !== call.id) return false;
  let args: any;
  try { args = JSON.parse(call.arguments!); } catch { return false; }
  if (args.operations?.length !== 1) return false;
  const op = args.operations[0];
  if (op.type !== "createContainer" || op.id !== existingId ||
      op.containerType !== "phone" || op.x !== 0 || op.y !== 0 ||
      op.title !== "合成负例" || !Array.isArray(op.children) || op.children.length ||
      Object.keys(op).some(key => !["type", "id", "containerType", "x", "y", "title", "children"].includes(key))) return false;
  let error = reply.content;
  for (let depth = 0; depth < 4 && typeof error === "string"; depth++) {
    try { error = JSON.parse(error); } catch { break; }
  }
  return error === "画布编辑失败：INVALID_ELEMENT_ID";
}
