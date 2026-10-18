import { expect, it } from "vitest";
import { mentionMenuPosition } from "@web/shared/mention-menu-position.js";

it("places the entire picker below the input when its measured height fits", () => {
  expect(
    mentionMenuPosition(
      { left: 100, top: 450, bottom: 480 },
      { width: 280, height: 90 },
      { width: 1000, height: 600 },
    ),
  ).toEqual({ left: 100, top: 486, maxHeight: 106 });
});

it("flips above the input as asynchronous results increase the actual height", () => {
  const anchor = { left: 100, top: 450, bottom: 480 };
  const position = mentionMenuPosition(
    anchor,
    { width: 280, height: 240 },
    { width: 1000, height: 600 },
  );
  expect(position.top + 240).toBe(anchor.top - 6);
});

it("scrolls on the larger side when neither side fits, without covering the input", () => {
  const position = mentionMenuPosition(
    { left: 900, top: 200, bottom: 240 },
    { width: 280, height: 280 },
    { width: 1000, height: 400 },
  );
  expect(position).toEqual({ left: 712, top: 8, maxHeight: 186 });
  expect(position.top + position.maxHeight).toBeLessThan(200);
});

it("keeps a constrained picker fully below an input near the top", () => {
  expect(
    mentionMenuPosition(
      { left: 0, top: 20, bottom: 50 },
      { width: 280, height: 280 },
      { width: 320, height: 240 },
    ),
  ).toEqual({ left: 8, top: 56, maxHeight: 176 });
});
