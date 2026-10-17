import { expect, it } from "vitest";
import { validateEditOperations } from "@core/modules/ai/edit-schema.js";
it("accepts the current native Slides table operation classes through the AI boundary", () => {
  const commands = [
    { kind: "delete-rows", targets: ["r1"] },
    { kind: "delete-columns", targets: ["c1"] },
    { kind: "clear", rows: ["r1"], columns: ["c1"] },
    { kind: "merge", rows: ["r1", "r2"], columns: ["c1"] },
    { kind: "split", targets: ["merge1"] },
    {
      kind: "style",
      rows: ["r1"],
      columns: ["c1"],
      style: { bold: true, backgroundColor: "#fff" },
    },
    { kind: "resize", axis: "column", sizes: [{ target: "c1", size: 200 }] },
    {
      kind: "paste",
      row: "r1",
      column: "c1",
      payload: { version: 1, cells: [["验收"]] },
    },
  ];
  for (const command of commands)
    expect(() =>
      validateEditOperations("presentation", [
        { type: "table", slideId: "s1", id: "t1", command },
      ]),
    ).not.toThrow();
  expect(() =>
    validateEditOperations("presentation", [
      {
        type: "table",
        slideId: "s1",
        id: "t1",
        command: {
          kind: "resize",
          axis: "column",
          sizes: [{ target: "c1", size: -1 }],
        },
      },
    ]),
  ).toThrow();
});
