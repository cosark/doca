import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { DB } from "@db/index.js";
import { openTestDatabase } from "./database.js";
import { createUser, type Actor } from "@core/modules/identity/passwords.js";
import {
  createKnowledgeBook,
  saveBookConfiguration,
  queueBookRun,
} from "@core/modules/knowledge-books/management.js";
import { executeBookCommand } from "@core/modules/knowledge-books/commands.js";
import { defaultBookConfiguration } from "@core/modules/knowledge-books/protocol.js";
import {
  executeBookRun,
  type BookRuntime,
} from "@core/modules/knowledge-books/engine.js";
import { readBookRun } from "@core/modules/knowledge-books/reads.js";
import { AppError } from "@core/shared/errors.js";
import { readBookSource } from "@core/modules/knowledge-books/sources.js";
import { createBookBatchCheckpoints } from "@core/modules/knowledge-books/batch-checkpoints.js";
import { readBookPayload } from "@core/modules/knowledge-books/payload-storage.js";
import { knowledgeBookRuntime } from "../apps/server/src/services/ai/knowledge-book-runtime.js";
const fixture = vi.hoisted(() => ({
  stream: vi.fn(),
  access: vi.fn(),
  maxOutput: 32000,
  apiMode: "chat" as "chat" | "responses",
}));
vi.mock("@core/modules/knowledge-books/model-access.js", () => ({
  validateBookModelAccess: (...args: any[]) => fixture.access(...args),
}));
vi.mock("@core/modules/ai/config.js", () => ({
  requireModel: async () => ({
    model: {
      id: "model",
      provider: "compatible",
      model: "test-model",
      baseUrl: "https://test.invalid",
      apiKey: "test-only",
      apiMode: fixture.apiMode,
      maxInput: 200000,
      maxOutput: fixture.maxOutput,
    },
  }),
}));
vi.mock("../apps/server/src/services/ai/model.js", () => ({
  meteredModel: async () => ({ doStream: fixture.stream }),
}));
function response(value: unknown, finishReason = "stop") {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "text-delta",
          delta: JSON.stringify(value),
        });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: finishReason },
        });
        controller.close();
      },
    }),
  };
}
let db: DB, actor: Actor, bookId: string;
beforeEach(async () => {
  fixture.stream.mockReset();
  fixture.maxOutput = 32000;
  fixture.apiMode = "chat";
  fixture.access.mockReset();
  fixture.access.mockResolvedValue(undefined);
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  actor = {
    ...(await createUser(
      db,
      {
        login: "runtime-checkpoint",
        displayName: "QA",
        password: randomUUID(),
      },
      { bootstrap: true },
    )),
    admin: 1,
  };
  bookId = (await createKnowledgeBook(db, actor, "Resumable pipeline")).id;
  const configuration = defaultBookConfiguration();
  configuration.goal = "Explain supported mechanisms with sections";
  configuration.modelId = "model";
  configuration.autoPublish = true;
  await saveBookConfiguration(db, actor, bookId, 1, configuration);
  for (let index = 0; index < 2; index++)
    await executeBookCommand(db, actor, bookId, {
      operation: "source.save",
      expectedRevision: 0,
      title: `Source ${index}`,
      status: "active",
      configuration: {
        version: 1,
        items: [
          {
            id: `manual${index}`,
            kind: "manual",
            markdown:
              `Protocol ${index} defines ordered message delivery. `.repeat(
                100,
              ),
          },
        ],
      },
    });
});
afterEach(async () => {
  await db.destroy();
});
async function directContext(stage: Parameters<BookRuntime["generate"]>[0]) {
  const runId = (await queueBookRun(db, actor, bookId)).id,
    lease = randomUUID();
  await db
    .updateTable("knowledge_book_runs")
    .set({ status: "running", lease_id: lease })
    .where("id", "=", runId)
    .execute();
  await db
    .insertInto("knowledge_book_node_runs")
    .values({
      run_id: runId,
      node_id: stage,
      type: stage,
      status: "running",
      input_refs: "[]",
      output: "",
      error: "",
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .execute();
  const source = await db
    .selectFrom("knowledge_book_sources")
    .selectAll()
    .where("book_id", "=", bookId)
    .executeTakeFirstOrThrow();
  const evidence = (
    await readBookSource(db, source, {
      readFile: async () => {
        throw new Error("Unexpected file");
      },
      readWeb: async () => {
        throw new Error("Unexpected web");
      },
    })
  ).map((item) => ({ ...item, weight: 1 }));
  const store = () =>
    createBookBatchCheckpoints({
      db,
      bookId,
      runId,
      nodeId: stage,
      stage,
      scope: "direct-runtime-qa",
      guard: async (connection) => {
        const row = await connection
          .selectFrom("knowledge_book_runs")
          .select(["status", "lease_id"])
          .where("id", "=", runId)
          .executeTakeFirstOrThrow();
        if (row.status !== "running" || row.lease_id !== lease)
          throw new Error("Lease changed");
      },
    });
  const input = {
    goal: "Supported mechanism",
    instructions: "Retain supplied constraints",
    evidence,
    claims: [
      {
        id: "fact0",
        statement: "Ordered delivery",
        evidenceIds: [evidence[0]!.id],
        evidenceQuotes: [
          { evidenceId: evidence[0]!.id, quote: evidence[0]!.text },
        ],
        reason: "Source",
        confidence: 1,
      },
    ],
    pages: [],
    criteria: [
      {
        id: "grounded",
        description: "Accurate supplied constraints",
        required: true,
      },
    ],
    maxDocumentDepth: 4,
    writingBranchCount: 1,
  };
  return { runId, store, input };
}

it.each(["budget", "apiMode"])(
  "does not checkpoint a result when model %s changes during the request",
  async (setting) => {
    const context = await directContext("acceptance");
    fixture.stream.mockImplementation(async () => {
      if (setting === "budget") fixture.maxOutput = 16000;
      else fixture.apiMode = "responses";
      return response({
        checks: [
          {
            criterionId: "grounded",
            passed: true,
            reason: "Synthetic complete verdict",
          },
        ],
      });
    });
    await expect(
      knowledgeBookRuntime(db, actor.id, context.runId, "model").generate(
        "acceptance",
        context.input,
        new AbortController().signal,
        undefined,
        context.store(),
      ),
    ).rejects.toThrow("model settings changed");
    expect(
      await db
        .selectFrom("knowledge_book_batch_checkpoints")
        .selectAll()
        .execute(),
    ).toEqual([]);
  },
);

it("restores negative assertion audits and their detailed diagnostics without rejudging them", async () => {
  const context = await directContext("acceptance");
  const input = {
    ...context.input,
    goal: "20000字",
    pages: [0, 1].map((index) => ({
      id: `page${index}`,
      title: `Chapter ${index}`,
      path: [],
      paragraphs: [
        {
          id: `paragraph${index}`,
          markdown: "2 + 2 = 5.",
          claimIds: ["fact0"],
          reason: "Source",
        },
      ],
    })),
  };
  fixture.stream.mockImplementation(async (options) => {
    const data = JSON.parse(options.prompt[1].content[0].text);
    if (data.acceptanceScope === "plan")
      return response({
        rules: [
          {
            criterionId: "grounded",
            localChecks: ["Verify arithmetic"],
            globalChecks: [],
          },
        ],
      });
    expect(data.acceptanceScope).toBe("trace");
    return response({
      assertions: data.requiredAssertions.map((assertion: any) => ({
        assertionId: assertion.id,
        failedCriterionIds: ["grounded"],
        reason: "2 + 2 equals 4, not 5",
      })),
      observations: [
        { criterionId: "grounded", reason: "Incorrect arithmetic" },
      ],
    });
  });
  const first: any = await knowledgeBookRuntime(
    db,
    actor.id,
    context.runId,
    "model",
  ).generate(
    "acceptance",
    input,
    new AbortController().signal,
    undefined,
    context.store(),
  );
  expect(first.checks[0].passed).toBe(false);
  const calls = fixture.stream.mock.calls.length;
  const second: any = await knowledgeBookRuntime(
    db,
    actor.id,
    context.runId,
    "model",
  ).generate(
    "acceptance",
    input,
    new AbortController().signal,
    undefined,
    context.store(),
  );
  expect(second).toEqual(first);
  expect(second.checks[0].reason).toContain("2 + 2 equals 4");
  expect(fixture.stream).toHaveBeenCalledTimes(calls);
  expect(fixture.access.mock.calls.length).toBeGreaterThan(calls);
});

it("persists a complete subdivision plan so a truncated parent request is not paid for again", async () => {
  const context = await directContext("synthesize");
  const input = {
    ...context.input,
    claims: [
      context.input.claims[0]!,
      { ...context.input.claims[0]!, id: "fact1" },
    ],
  };
  fixture.stream.mockImplementation(async (options) => {
    const data = JSON.parse(options.prompt[1].content[0].text);
    if (data.claims.length === 2) return response({ pages: [] }, "length");
    return response({
      pages: [
        {
          id: "page",
          title: "Ordered delivery",
          path: [],
          paragraphs: [
            {
              id: "paragraph",
              markdown:
                "## Supported mechanism\n\nThe receiver preserves the supplied order and acknowledges the delivered message.",
              claimIds: [data.claims[0].id],
              reason: "Source",
            },
          ],
        },
      ],
    });
  });
  const first = await knowledgeBookRuntime(
    db,
    actor.id,
    context.runId,
    "model",
  ).generate(
    "synthesize",
    input,
    new AbortController().signal,
    undefined,
    context.store(),
  );
  expect(fixture.stream).toHaveBeenCalledTimes(3);
  const second = await knowledgeBookRuntime(
    db,
    actor.id,
    context.runId,
    "model",
  ).generate(
    "synthesize",
    input,
    new AbortController().signal,
    undefined,
    context.store(),
  );
  expect(second).toEqual(first);
  expect(fixture.stream).toHaveBeenCalledTimes(3);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .select("id")
      .where("run_id", "=", context.runId)
      .execute(),
  ).toHaveLength(3);
});

it("restores long-form outlines, canonical claim assignments and complete chapter batches", async () => {
  const context = await directContext("synthesize");
  const input = {
    ...context.input,
    goal: "20000字",
    claims: [
      context.input.claims[0]!,
      { ...context.input.claims[0]!, id: "fact1" },
    ],
  };
  fixture.stream.mockImplementation(async (options) => {
    const data = JSON.parse(options.prompt[1].content[0].text);
    if (data.writingScope === "plan")
      return response({
        chapters: [
          {
            title: "Ordered chapter",
            path: [],
            sections: [
              {
                id: "mechanism",
                title: "Mechanism",
                objective: "Explain message ordering",
              },
            ],
          },
        ],
      });
    if (data.writingScope === "assign")
      return response({
        assignments: [
          {
            sectionId: "mechanism",
            claimIds: data.claims.map((claim: any) => claim.id),
          },
        ],
      });
    return response({
      pages: [
        {
          id: "page",
          title: data.fixedChapter.title,
          path: data.fixedChapter.path,
          paragraphs: [
            {
              id: "paragraph",
              markdown:
                "## Mechanism\n\n" +
                "Supported causal explanation. ".repeat(
                  Math.ceil(data.batchCharacterTarget / 28),
                ),
              claimIds: data.claims.map((claim: any) => claim.id),
              reason: "Assigned normative constraint",
            },
          ],
        },
      ],
    });
  });
  const first: any = await knowledgeBookRuntime(
    db,
    actor.id,
    context.runId,
    "model",
  ).generate(
    "synthesize",
    input,
    new AbortController().signal,
    undefined,
    context.store(),
  );
  expect(fixture.stream).toHaveBeenCalledTimes(4);
  const plan = await db
    .selectFrom("knowledge_book_batch_checkpoints")
    .selectAll()
    .where("run_id", "=", context.runId)
    .where("phase", "=", "plan")
    .executeTakeFirstOrThrow();
  const envelope: any = await readBookPayload(db, plan.result_ref, {
    bookId,
    ownerKind: "batch",
    ownerId: plan.id,
    nodeId: "synthesize",
  });
  expect(envelope.evidenceInventory).toHaveLength(input.evidence.length);
  expect(envelope.evidenceInventory[0]).toMatchObject({
    sourceVersion: input.evidence[0]!.sourceVersion,
    contentHash: input.evidence[0]!.contentHash,
  });
  expect(envelope.evidenceInventory[0]).not.toHaveProperty("text");
  expect(envelope.evidenceInventory[0]).not.toHaveProperty("title");
  const second = await knowledgeBookRuntime(
    db,
    actor.id,
    context.runId,
    "model",
  ).generate(
    "synthesize",
    input,
    new AbortController().signal,
    undefined,
    context.store(),
  );
  expect(second).toEqual(first);
  expect(fixture.stream).toHaveBeenCalledTimes(4);
  expect(
    new Set(
      first.pages.flatMap((page: any) =>
        page.paragraphs.flatMap((paragraph: any) => paragraph.claimIds),
      ),
    ),
  ).toEqual(new Set(["fact0", "fact1"]));
});

it("continues a failed writing node from durable completed batches after replacing the entire runtime", async () => {
  const writingSizes: number[] = [];
  let fail = true,
    writingCalls = 0,
    extractionCalls = 0;
  let firstCompleted!: () => void;
  const firstCheckpoint = new Promise<void>((resolve) => {
    firstCompleted = resolve;
  });
  fixture.stream.mockImplementation(async (options) => {
    const data = JSON.parse(options.prompt[1].content[0].text),
      properties = data.outputSchema.properties;
    if (properties.claims) {
      extractionCalls++;
      return response({
        claims: Array.from({ length: 21 }, (_, index) => ({
          id: `fact${index}`,
          statement: `Ordered delivery constraint ${index}`,
          citationIds: [data.evidence[0].passages[0].citationId],
          reason: "Exact normative source",
          confidence: 1,
        })),
      });
    }
    if (properties.rules)
      return response({
        rules: data.criteria.map((c: any) => ({
          criterionId: c.id,
          localChecks: [
            "Verify present assertions against supplied constraints",
          ],
          globalChecks: ["Verify complete claim coverage"],
        })),
      });
    if (properties.checks)
      return response({
        checks: data.criteria.map((c: any) => ({
          criterionId: c.id,
          passed: true,
          reason: "All supplied obligations were observed",
        })),
      });
    if (!data.pages.length) {
      writingCalls++;
      writingSizes.push(data.claims.length);
      if (data.claims.length === 2 && fail) {
        await firstCheckpoint;
        throw new AppError(
          403,
          "Simulated provider outage after the first completed batch",
        );
      }
    }
    return response({
      pages: [
        {
          id: "page",
          title: "Message ordering",
          path: [],
          paragraphs: [
            {
              id: "paragraph",
              markdown:
                "## Delivery mechanism\n\nThe receiver follows the supplied ordering constraints. An acknowledgement records delivery state and permits the sender to identify the next required message.",
              claimIds: data.claims.map((c: any) => c.id),
              reason: "All assigned constraints retained",
            },
          ],
        },
      ],
    });
  });
  const runId = (await queueBookRun(db, actor, bookId)).id;
  const runtime = (): BookRuntime => {
    const base = knowledgeBookRuntime(db, actor.id, runId, "model");
    return {
      ...base,
      generate: (stage, input, signal, report, checkpoints) =>
        base.generate(
          stage,
          input,
          signal,
          async (event) => {
            await report?.(event);
            if (stage === "synthesize" && event.code === "batch_completed")
              firstCompleted();
          },
          checkpoints,
        ),
    };
  };
  await executeBookRun(db, runId, runtime());
  const failed = await readBookRun(db, actor, bookId, runId);
  expect(
    failed.status,
    JSON.stringify({
      writingSizes,
      extractionCalls,
      writingCalls,
      claims: failed.artifact?.claims.length,
      error: failed.error,
    }),
  ).toBe("failed");
  expect(extractionCalls).toBe(2);
  expect(writingCalls, failed.error).toBe(2);
  expect(
    await db
      .selectFrom("knowledge_book_batch_checkpoints")
      .select("id")
      .where("run_id", "=", runId)
      .where("stage", "=", "synthesize")
      .execute(),
  ).toHaveLength(1);
  fail = false;
  await executeBookCommand(
    db,
    actor,
    bookId,
    { operation: "run.resume", runId },
    "manual",
    runtime(),
  );
  await executeBookRun(db, runId, runtime());
  const completed = await readBookRun(db, actor, bookId, runId);
  expect(completed.status).toBe("published");
  expect(extractionCalls).toBe(2);
  expect(writingCalls).toBe(3); // The completed 40-claim request was restored, not paid for again.
  expect(completed.artifact?.claims).toHaveLength(42);
  expect(
    new Set(
      completed.artifact?.pages.flatMap((page) =>
        page.paragraphs.flatMap((paragraph) => paragraph.claimIds),
      ),
    ).size,
  ).toBe(42);
  expect(completed.artifact?.checks.every((check) => check.passed)).toBe(true);
});
