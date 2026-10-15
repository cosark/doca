import { expect, it } from "vitest";
import {
  bookCharacterGoal,
  bookContentMetrics,
  bookEvidenceContext,
  bookInspectionAssertions,
  bookNeighborContext,
  bookPageBatches,
  runBookBatches,
} from "../apps/server/src/services/ai/knowledge-book-batching.js";

it("anchors assertion hints to complete unchanged paragraphs with short unique IDs", () => {
  const paragraphs = [
    {
      id: "p1",
      markdown:
        "假设 cwnd=12800。12800 > 65536；\n```mermaid\nsequenceDiagram\nC->>S: KeyUpdate\n```",
      claimIds: [],
      reason: "",
    },
    { id: "p2", markdown: "另一段结论。", claimIds: [], reason: "" },
  ];
  const pages = [{ id: "page", title: "Case", path: [], paragraphs }];
  const original = JSON.stringify(pages),
    assertions = bookInspectionAssertions(pages);
  expect(assertions.map((assertion) => assertion.id)).toEqual([
    "a0",
    "a1",
    "a2",
    "a3",
  ]);
  expect(assertions[1]!.excerpt).toBe("12800 > 65536");
  expect(assertions[2]).toMatchObject({
    paragraphId: "p1",
    excerpt: "C->>S: KeyUpdate",
  });
  for (const assertion of assertions)
    expect(
      paragraphs.find((p) => p.id === assertion.paragraphId)!.markdown,
    ).toContain(assertion.excerpt);
  expect(JSON.stringify(pages)).toBe(original);
});

it("includes related normative context without unrelated sources or cutting blocks", () => {
  const evidence = [
    { id: "before", sourceId: "rfc", text: "Receiving algorithm" },
    { id: "anchor", sourceId: "rfc", text: "Field definition" },
    { id: "after", sourceId: "rfc", text: "State transition" },
    { id: "other", sourceId: "other", text: "Unrelated protocol" },
  ];
  const claims = [{ evidenceIds: ["anchor"] }];
  expect(bookEvidenceContext(evidence, claims)).toEqual(evidence.slice(0, 3));
  expect(bookEvidenceContext(evidence, claims, 16)).toEqual([evidence[1]]);
  expect(bookEvidenceContext(evidence, claims, 35)).toEqual(
    evidence.slice(0, 2),
  );
});

it("includes whole adjacent diagrams and definitions without expanding assertion coverage", () => {
  const paragraphs = [
    {
      id: "definition",
      markdown: "Threshold formula",
      claimIds: [],
      reason: "",
    },
    {
      id: "caption",
      markdown: "The next diagram shows this decision.",
      claimIds: [],
      reason: "",
    },
    {
      id: "diagram",
      markdown: "```mermaid\nflowchart TD\nA --> B\n```",
      claimIds: [],
      reason: "",
    },
    {
      id: "later",
      markdown: "Later independent topic",
      claimIds: [],
      reason: "",
    },
    {
      id: "outside",
      markdown: "Outside the neighbor range",
      claimIds: [],
      reason: "",
    },
  ];
  const page = { id: "page", title: "Case", path: [], paragraphs };
  const selected = [{ ...page, paragraphs: [paragraphs[1]!] }];
  const context = bookNeighborContext([page], selected, 100);
  expect(context.map((item) => item.paragraphId)).toEqual([
    "definition",
    "diagram",
    "later",
  ]);
  expect(
    bookInspectionAssertions(selected).map((item) => item.paragraphId),
  ).toEqual(["caption"]);
  expect(
    bookNeighborContext([page], selected, 20).map((item) => item.paragraphId),
  ).toEqual(["definition"]);
  expect(page.paragraphs[2]!.markdown).toBe(context[1]!.markdown);
});

it("separately audits the claimed field count even when its byte sum is correct", () => {
  const markdown = "前8个定长字段共占8字节。There are 8 fixed-length fields.";
  const pages = [
    {
      id: "page",
      title: "Fields",
      path: [],
      paragraphs: [{ id: "p", markdown, claimIds: [], reason: "" }],
    },
  ];
  const assertions = bookInspectionAssertions(pages);
  expect(
    assertions.some((assertion) => assertion.excerpt === "前8个定长字段"),
  ).toBe(true);
  expect(
    assertions.some(
      (assertion) => assertion.excerpt === "8 fixed-length fields",
    ),
  ).toBe(true);
  for (const assertion of assertions)
    expect(markdown).toContain(assertion.excerpt);
  expect(pages[0]!.paragraphs[0]!.markdown).toBe(markdown);
});

it("retains ordinal meaning instead of turning one indexed packet into a packet count", () => {
  for (const markdown of [
    "教学模拟中第4个IP报文丢失。",
    "教学模拟中第 4个IP报文丢失。",
  ]) {
    const pages = [{
      id: "page", title: "Packet loss", path: [],
      paragraphs: [{ id: "p", markdown, claimIds: ["c"], reason: "Source" }],
    }];
    const assertions = bookInspectionAssertions(pages);
    expect(assertions.some((assertion) => assertion.excerpt === "4个IP报文丢失")).toBe(false);
    expect(assertions.some((assertion) => /^第\s*4个IP报文丢失$/.test(assertion.excerpt))).toBe(true);
    expect(pages[0]!.paragraphs[0]!.markdown).toBe(markdown);
  }
});

it("selects a distant state algorithm using actual assertion terms without losing citations", () => {
  const evidence = [
    { id: "anchor", sourceId: "rfc", text: "Neighbor entry definition" },
    { id: "near", sourceId: "rfc", text: "Generic neighbor introduction" },
    { id: "between", sourceId: "rfc", text: "Address format description" },
    { id: "algorithm", sourceId: "rfc", text: "REACHABLE expires into STALE" },
    {
      id: "other",
      sourceId: "unrelated",
      text: "REACHABLE STALE foreign rules",
    },
  ];
  const limit = evidence[0]!.text.length + evidence[3]!.text.length;
  const selected = bookEvidenceContext(
    evidence,
    [{ evidenceIds: ["anchor"] }],
    limit,
    "REACHABLE timeout -> STALE",
  );
  expect(selected).toEqual([evidence[0], evidence[3]]);
  expect(selected.reduce((total, item) => total + item.text.length, 0)).toBe(
    limit,
  );
});

it("retrieves normative blocks using hyphenated diagnostic terms while retaining exact source text", () => {
  const evidence = [
    { id: "anchor", sourceId: "rfc", text: "Neighbor definition" },
    { id: "near", sourceId: "rfc", text: "Another general discussion" },
    {
      id: "rule",
      sourceId: "rfc",
      text: "New arrival SHOULD replace the oldest entry when the queue overflows.",
    },
  ];
  const limit = evidence[0]!.text.length + evidence[2]!.text.length;
  expect(
    bookEvidenceContext(
      evidence,
      [{ evidenceIds: ["anchor"] }],
      limit,
      "Oldest-packet replacement on overflow is not in supplied evidence",
    ),
  ).toEqual([evidence[0], evidence[2]]);
});

it("matches spaced event names to camel-case normative identifiers without losing numbered prefixes", () => {
  const evidence = [
    { id: "anchor", sourceId: "rfc", text: "Neighbor state definition" },
    { id: "near", sourceId: "rfc", text: "General neighbor introduction" },
    {
      id: "rule",
      sourceId: "rfc",
      text: "Event: 1-WayReceived. InactivityTimer. Action: clear exchange lists.",
    },
    {
      id: "wrong",
      sourceId: "rfc",
      text: "Event: 2-WayReceived. Action: no change.",
    },
  ];
  const limit = evidence[0]!.text.length + evidence[2]!.text.length;
  expect(
    bookEvidenceContext(
      evidence,
      [{ evidenceIds: ["anchor"] }],
      limit,
      "1-Way event; Inactivity Timer action",
    ),
  ).toEqual([evidence[0], evidence[2]]);
});

it("uses explicit character goals without adding a default to saved configurations", () => {
  expect(bookCharacterGoal("需要10万字左右")).toBe(100000);
  expect(bookCharacterGoal("生成十万字知识册")).toBe(100000);
  expect(bookCharacterGoal("两万五千字")).toBe(25000);
  expect(bookCharacterGoal("约 100,000 characters")).toBe(100000);
  expect(bookCharacterGoal("1.2万字")).toBe(12000);
  expect(bookCharacterGoal("Detailed tutorial")).toBeUndefined();
});

it("counts prose and actual Markdown diagrams without counting diagram code or fenced examples as body", () => {
  const metrics = bookContentMetrics(
    [
      {
        id: "page",
        title: "Page",
        path: [],
        paragraphs: [
          {
            id: "p",
            claimIds: [],
            reason: "",
            markdown:
              "正文\n\n````text\n```mermaid\nflowchart LR\nA-->B\n```\n````\n\n~~~mermaid\nflowchart LR\nA-->B\n~~~",
          },
        ],
      },
    ],
    [],
  );
  expect(metrics.bodyCharacters).toBe(2);
  expect(metrics.chineseCharacters).toBe(2);
  expect(metrics.diagramCount).toBe(1);
  expect(metrics.diagramTypes).toEqual({ flowchart: 1 });
});

it("keeps concurrency at two and returns batches in source order when completion order differs", async () => {
  const finish: Array<() => void> = [];
  let active = 0,
    maximum = 0;
  const result = runBookBatches(
    [0, 1, 2],
    new AbortController().signal,
    async (value, index) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => {
        finish[index] = resolve;
      });
      active--;
      return value;
    },
  );
  expect(maximum).toBe(2);
  finish[1]!();
  await Promise.resolve();
  await Promise.resolve();
  finish[0]!();
  await Promise.resolve();
  await Promise.resolve();
  finish[2]!();
  expect(await result).toEqual([0, 1, 2]);
  expect(maximum).toBe(2);
});

it("aborts and drains the other worker after failure without starting additional paid requests", async () => {
  let drained = false,
    calls = 0;
  await expect(
    runBookBatches(
      [0, 1, 2],
      new AbortController().signal,
      async (value, _index, signal) => {
        calls++;
        if (value === 0) throw new Error("Provider failed");
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              drained = true;
              resolve();
            },
            { once: true },
          ),
        );
        signal.throwIfAborted();
        return value;
      },
    ),
  ).rejects.toThrow("Provider failed");
  expect(calls).toBe(2);
  expect(drained).toBe(true);
});

it("keeps complete Mermaid paragraphs and cites only claims in each batch", () => {
  const claims = [0, 1].map((index) => ({
    id: `c${index}`,
    statement: "TCP",
    evidenceIds: ["e"],
    evidenceQuotes: [{ evidenceId: "e", quote: "TCP" }],
    reason: "Source",
    confidence: 1,
  }));
  const pages = [
    {
      id: "chapter",
      title: "TCP",
      path: [],
      paragraphs: claims.map((claim, index) => ({
        id: `p${index}`,
        markdown: `## TCP\n\n\`\`\`mermaid\nflowchart LR\n A --> B\n\`\`\`\n${"Supported ".repeat(1000)}`,
        claimIds: [claim.id],
        reason: "Source",
      })),
    },
  ];
  const before = structuredClone(pages);
  const batches = bookPageBatches(pages, claims);
  expect(batches).toHaveLength(2);
  expect(batches.map((batch) => batch.claims.map((claim) => claim.id))).toEqual(
    [["c0"], ["c1"]],
  );
  expect(
    batches.flatMap((batch) => batch.pages.flatMap((page) => page.paragraphs)),
  ).toEqual(pages[0]!.paragraphs);
  expect(pages).toEqual(before);
});
