import { expect, it } from "vitest";
import {
  quoteGeneratedBookLabels,
  validateBookDiagrams,
} from "../apps/server/src/services/ai/knowledge-book-diagrams.js";

it("quotes only generated flat node labels while preserving text, edges, shapes and other code", async () => {
  const original =
    '正文 A[example]\n\n```mermaid\nflowchart LR\nA[更新地址(若有新值)]-->B["命令 C[x]"]\nB-->D[[子流程]]\n%% E[comment]\n```\n\n```text\nA[example]\n```';
  const escaped = quoteGeneratedBookLabels(original);
  expect(escaped).toBe(
    original.replace("A[更新地址(若有新值)]", 'A["更新地址(若有新值)"]'),
  );
  expect(quoteGeneratedBookLabels(escaped)).toBe(escaped);
  await expect(
    validateBookDiagrams(
      [{ paragraphs: [{ id: "generated", markdown: escaped }] }],
      new AbortController().signal,
    ),
  ).resolves.toBeUndefined();
}, 10000);

it("parses actual flow, architecture and sequence diagrams in an isolated worker", async () => {
  await expect(
    validateBookDiagrams(
      [
        {
          paragraphs: [
            {
              id: "flow",
              markdown:
                '```mermaid\nflowchart LR\nA["客户端"]-->B["网关 (NAT)"]-->C["服务端"]\n```',
            },
            {
              id: "sequence",
              markdown:
                "```mermaid\nsequenceDiagram\nparticipant A as 客户端\nparticipant B as 服务端\nA->>B: 请求\nB-->>A: 响应\n```",
            },
          ],
        },
      ],
      new AbortController().signal,
    ),
  ).resolves.toBeUndefined();
  expect((globalThis as any).window).toBeUndefined();
}, 10000);

it("rejects invalid Mermaid with its paragraph and parser diagnostic", async () => {
  await expect(
    validateBookDiagrams(
      [
        {
          paragraphs: [
            {
              id: "broken",
              markdown: "```mermaid\nflowchart LR\nA[未加引号(标签)]-->B\n```",
            },
          ],
        },
      ],
      new AbortController().signal,
    ),
  ).rejects.toThrow(/broken: Error: Parse error/);
}, 10000);

it("ignores Mermaid examples nested inside other code and honors cancellation before parsing", async () => {
  await expect(
    validateBookDiagrams(
      [
        {
          paragraphs: [
            {
              id: "example",
              markdown: "````text\n```mermaid\nnot a diagram\n```\n````",
            },
          ],
        },
      ],
      new AbortController().signal,
    ),
  ).resolves.toBeUndefined();
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  await expect(
    validateBookDiagrams(
      [
        {
          paragraphs: [
            { id: "actual", markdown: "```mermaid\nflowchart LR\nA-->B\n```" },
          ],
        },
      ],
      controller.signal,
    ),
  ).rejects.toThrow("Cancelled");
});

it("rejects inline opening fences and missing closing fences before they can swallow later paragraphs", async () => {
  await expect(
    validateBookDiagrams(
      [
        {
          paragraphs: [
            {
              id: "inline",
              markdown: "正文```mermaid\nflowchart LR\nA-->B\n```",
            },
          ],
        },
      ],
      new AbortController().signal,
    ),
  ).rejects.toThrow("must start on its own line");
  await expect(
    validateBookDiagrams(
      [
        {
          paragraphs: [
            { id: "unclosed", markdown: "```mermaid\nflowchart LR\nA-->B" },
          ],
        },
      ],
      new AbortController().signal,
    ),
  ).rejects.toThrow("complete closing fence");
});
