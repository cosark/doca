import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openTestDatabase } from "./database.js";
import { readAIConversation } from "@server/services/ai/conversation.js";
import type { AIRunner } from "@server/services/ai/runner.js";
import type { Schema } from "@db/index.js";

it("reads a newly created browser conversation with an empty job scope without binding SQLite booleans or leaking history", async () => {
  const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  const session: Schema["ai_sessions"] = {
    id: randomUUID(),
    user_id: randomUUID(),
    title: "Empty browser chat",
    model_id: null,
    resource_ids: "[]",
    approved_resource_ids: "[]",
    mentioned_resource_ids: "[]",
    archived: 0,
    revision: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const foreignJob = randomUUID();
  const runner = {
    ensureThread: async () => ({
      memory: {
        recall: async () => ({
          messages: [
            {
              id: foreignJob,
              role: "user",
              content: {
                parts: [
                  { type: "text", text: "outside the selected browser scope" },
                ],
              },
              createdAt: new Date(),
            },
          ],
          hasMore: false,
        }),
      },
    }),
  } as unknown as AIRunner;
  try {
    const result = await readAIConversation(
      db,
      runner,
      session.user_id,
      session,
      0,
      [],
      foreignJob,
    );
    expect(result.messages).toEqual([]);
    expect(result.jobs).toEqual([]);
    expect(result.operations).toEqual([]);
  } finally {
    await db.destroy();
  }
});
