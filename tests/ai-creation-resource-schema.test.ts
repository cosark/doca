import { expect, it } from "vitest";
import { z } from "zod";
import { createCreationResourceQueryTools } from "@server/services/ai/creation-resource-tools.js";

it("publishes object-root function schemas while preserving exact template/material validation", () => {
  const tools = createCreationResourceQueryTools(
    { templates: {} as any, materials: {} as any },
    {} as any,
  );
  for (const tool of Object.values(tools)) {
    const schema = z.toJSONSchema(tool.inputSchema as z.ZodType);
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema).not.toHaveProperty("anyOf");
  }
  const retrieval = tools.creation_resource_retrieve.inputSchema! as z.ZodType;
  expect(
    retrieval.safeParse({ kind: "templates", query: "手机模板" }).success,
  ).toBe(true);
  expect(
    retrieval.safeParse({
      kind: "materials",
      query: "图标",
      target: "collections",
    }).success,
  ).toBe(true);
  expect(
    retrieval.safeParse({
      kind: "templates",
      query: "模板",
      target: "collections",
    }).success,
  ).toBe(false);
  expect(retrieval.safeParse({ kind: "materials", query: "" }).success).toBe(
    false,
  );
  const search = tools.creation_resource_search.inputSchema! as z.ZodType;
  expect(
    search.safeParse({
      kind: "materials",
      cursors: { materials: null, collections: null },
    }).success,
  ).toBe(true);
  expect(
    search.safeParse({ kind: "templates", cursors: { materials: null } })
      .success,
  ).toBe(false);
});
