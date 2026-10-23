import { expect, it } from "vitest";
import { waitingPendingItems } from "../apps/web/src/features/ai/ai-pending-presentation.js";

it("keeps recovery copies out of the waiting list while the original message is sending or accepted", () => {
  const pending = [
    { id: "sending", text: "Summarize" },
    { id: "accepted", text: "Analyze" },
    { id: "later", text: "Continue" },
  ];
  const before = structuredClone(pending);
  expect(
    waitingPendingItems(pending, [
      { id: "sending", delivery: "sending" },
      { id: "accepted" },
    ]),
  ).toEqual([pending[2]]);
  expect(pending).toEqual(before);
});

it("shows truly queued messages only in the waiting list, including restored drafts", () => {
  const pending = [{ id: "later" }, { id: "restored" }];
  expect(
    waitingPendingItems(pending, [{ id: "later", delivery: "queued" }]),
  ).toEqual(pending);
});

it("leaves failed sends in their retry bubble and restores the unchanged recovery copy after reopening", () => {
  const pending = [{ id: "original-id", text: "Keep this exact message" }];
  expect(
    waitingPendingItems(pending, [{ id: "original-id", delivery: "failed" }]),
  ).toEqual([]);
  expect(waitingPendingItems(pending, [])).toEqual(pending);
});
