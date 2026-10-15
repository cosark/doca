import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { TOOL_EXAMPLES } from "@core/modules/ai/tool-examples.js";
import { bookWorkflowSchema, defaultBookConfiguration } from "@core/modules/knowledge-books/protocol.js";
import {
  bookAssistantInputSchema,
  bookAssistantActionSchema,
} from "../apps/server/src/services/ai/knowledge-book-tool-schema.js";
it("declares actual root and nested command objects and rejects encoded strings and obsolete single-source inputs", () => {
  const schema = bookAssistantInputSchema.toJSONSchema();
  expect(schema.type).toBe("object");
  expect(schema.properties!.command).toMatchObject({ type: "object" });
  const input = {
    action: "command",
    bookId: randomUUID(),
    command: {
      operation: "source.save",
      expectedRevision: 0,
      title: "Mixed",
      status: "active",
      configuration: {
        version: 1,
        items: [
          { id: "document", kind: "document", resourceId: randomUUID() },
          { id: "url", kind: "url", url: "https://example.com" },
        ],
      },
    },
  };
  expect(bookAssistantInputSchema.safeParse(input).success).toBe(true);
  expect(bookAssistantActionSchema.safeParse(input).success).toBe(true);
  expect(
    bookAssistantInputSchema.safeParse({
      ...input,
      command: JSON.stringify(input.command),
    }).success,
  ).toBe(false);
  expect(
    bookAssistantActionSchema.safeParse({
      ...input,
      command: {
        ...input.command,
        configuration: { kind: "url", url: "https://example.com" },
      },
    }).success,
  ).toBe(false);
});

it("executes the declared optional search filters without inventing a language or site", () => {
  const input = { action: "search_sources", bookId: randomUUID(), query: "TCP" };
  expect(bookAssistantInputSchema.safeParse(input).success).toBe(true);
  expect(bookAssistantActionSchema.parse(input)).toEqual(input);
  expect(bookAssistantActionSchema.safeParse({ ...input, sites: 1 }).success).toBe(false);
});

it("provides valid complete node examples and identifies the incompatible edge precisely", () => {
  for (const example of TOOL_EXAMPLES.knowledge_book!) expect(bookAssistantActionSchema.safeParse(example).success).toBe(true);
  const workflow = defaultBookConfiguration().workflow;
  workflow.edges.push({ source: "synthesize", target: "extract" });
  const result = bookWorkflowSchema.safeParse(workflow);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.map(issue => issue.message).join("\n")).toContain("synthesize (synthesize) -> extract (extract). extract accepts: sources, feedback, human_review");
});
