import { expect, it } from "vitest";
import { rejectedExistingCanvasContainer } from "../scripts/qa-ai-negative-evidence.js";

const op = { type: "createContainer", id: "existing-phone", containerType: "phone", x: 0, y: 0, title: "合成负例", children: [] };
const call = { id: "negative-call", name: "canvas_edit", arguments: JSON.stringify({ operations: [op] }) };
const error = { callId: call.id, content: JSON.stringify("画布编辑失败：INVALID_ELEMENT_ID") };

it("recognizes the correlated current live-ID rejection with valid command parameters", () => {
  expect(rejectedExistingCanvasContainer(error, call, op.id)).toBe(true);
});

it("does not mistake canvas_view commentary for a committed error receipt", () => {
  const reply = { callId: "view-call", content: JSON.stringify({ inspection: "负例命令（ELEMENT_ID_REUSE 拒绝、整批不写）属操作回执层面，像素无法直接验证" }) };
  expect(rejectedExistingCanvasContainer(reply, { ...call, id: reply.callId, name: "canvas_view" }, op.id)).toBe(false);
});

it("does not mistake a successful receipt's echoed goal for the error itself", () => {
  expect(rejectedExistingCanvasContainer({ ...error, content: JSON.stringify({ saved: true, goal: "画布编辑失败：INVALID_ELEMENT_ID" }) }, call, op.id)).toBe(false);
});

it("requires the actual call ID, tool and known existing container ID", () => {
  expect(rejectedExistingCanvasContainer({ ...error, callId: "unrelated" }, call, op.id)).toBe(false);
  expect(rejectedExistingCanvasContainer(error, { ...call, name: "document_read" }, op.id)).toBe(false);
  expect(rejectedExistingCanvasContainer(error, call, "another-id")).toBe(false);
});

it("does not accept malformed or combined commands as the isolated negative case", () => {
  for (const operations of [[{ ...op, width: 390 }], [op, { type: "patch", id: op.id, patch: { x: 0 } }]]) {
    expect(rejectedExistingCanvasContainer(error, { ...call, arguments: JSON.stringify({ operations }) }, op.id)).toBe(false);
  }
});

it("leaves unknown error shapes and deleted-ID reuse outside the tested scope", () => {
  for (const content of [{ error: "INVALID_ELEMENT_ID" }, "ELEMENT_ID_REUSE", "未知错误"]) {
    expect(rejectedExistingCanvasContainer({ ...error, content }, call, op.id)).toBe(false);
  }
});
