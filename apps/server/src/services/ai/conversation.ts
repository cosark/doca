import type { DB, Schema } from "@db/index.js";
import type { AIRunner } from "./runner.js";
import { sessionResourceHistory } from "@core/modules/ai/session-resources.js";
import {
  explorerTargets,
  memoryOwner,
  messageText,
  messageReasoning,
} from "./memory.js";
import { continuationJobStatus } from "./continuations.js";

/** Current UI projection of authoritative model history and operation receipts.
 * Callers must establish their own user/session/connection authorization first.
 */
export async function readAIConversation(
  db: DB,
  runner: AIRunner,
  userId: string,
  s: Schema["ai_sessions"],
  page: number,
  allowedJobIds?: readonly string[],
  pendingJobId?: string,
) {
  const allowed = allowedJobIds === undefined ? null : new Set(allowedJobIds);
  const m = await runner.ensureThread(s);
  const history = await m.memory.recall({
    threadId: s.id,
    resourceId: memoryOwner(userId),
    perPage: 24,
    page,
    orderBy: { field: "createdAt", direction: "DESC" },
  });
  const messages = allowed
    ? history.messages.filter((message) =>
        (message.role === "user" && allowed.has(message.id)) ||
        (message.role === "assistant" && message.id.endsWith("-answer") && allowed.has(message.id.slice(0, -7))))
    : history.messages;
  const pendingAllowed = !!pendingJobId && (!allowed || allowed.has(pendingJobId));
  if (pendingAllowed && !messages.some(message => message.id === pendingJobId && message.role === "user")) {
    const stored = await m.memory.recall({ threadId: s.id, resourceId: memoryOwner(userId), perPage: false });
    const pending = stored.messages.find(message => message.id === pendingJobId && message.role === "user");
    if (pending) messages.push(pending);
  }
  const jobs = await db
    .selectFrom("ai_jobs")
    .select([
      "id",
      "status",
      "error",
      "created_at",
      "updated_at",
      "model_id",
      "result",
    ])
    .where("session_id", "=", s.id)
    .where("user_id", "=", userId)
    .$if(allowed !== null, (query) => query.where((eb) => allowed!.size
      ? eb("id", "in", [...allowed!])
      : eb.or([])))
    .where((eb) =>
      eb.or([
        ...(pendingAllowed ? [eb("id", "=", pendingJobId!)] : []),
        ...(messages.length
          ? [
              eb(
                "id",
                "in",
                messages.map((message) =>
                  message.id.replace(/-answer$/, ""),
                ),
              ),
            ]
          : []),
        eb("status", "in", ["queued", "running", "awaiting_approval"]),
        eb(
          "id",
          "in",
          db
            .selectFrom("ai_jobs")
            .select("id")
            .where("session_id", "=", s.id)
            .where("user_id", "=", userId)
            .$if(allowed !== null, (query) => query.where((eb) => allowed!.size
              ? eb("id", "in", [...allowed!])
              : eb.or([])))
            .orderBy("created_at", "desc")
            .limit(30),
        ),
      ]),
    )
    .orderBy("created_at", "desc")
    .execute();
  const userMessageIds = messages
    .filter((message) => message.role === "user")
    .map((message) => message.id);
  const jobInputs = userMessageIds.length
    ? await db
        .selectFrom("ai_jobs")
        .select(["id", "input"])
        .where("id", "in", userMessageIds)
        .where("user_id", "=", userId)
        .where("session_id", "=", s.id)
        .execute()
    : [];
  const explorerByMessage = new Map(
    jobInputs.map((job) => {
      let files: unknown = [];
      try {
        files = JSON.parse(job.input).files;
      } catch {
        files = [];
      }
      return [job.id, explorerTargets(files)] as const;
    }),
  );
  const operations = jobs.length
    ? await db
        .selectFrom("ai_operations")
        .select(["id", "job_id", "result", "created_at"])
        .where(
          "job_id",
          "in",
          jobs.map((j) => j.id),
        )
        .execute()
    : [];
  const resources = await sessionResourceHistory(db, userId, s.id);
  return {
    session: {
      ...s,
      source: (await db
        .selectFrom("browser_clipper_assistant_sessions")
        .select("session_id")
        .where("session_id", "=", s.id)
        .where("user_id", "=", userId)
        .executeTakeFirst())
        ? "browser_assistant"
        : "doca",
    },
    resources,
    messages: [...messages]
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .map((x) => ({
        id: x.id,
        role: x.role,
        text: messageText(x),
        reasoning: messageReasoning(x),
        references: x.content.metadata?.references ?? [],
        attachments: x.content.metadata?.attachments ?? [],
        explorer: (() => {
          const saved = explorerTargets(x.content.metadata?.explorer);
          return saved.length ? saved : (explorerByMessage.get(x.id) ?? []);
        })(),
        createdAt: x.createdAt,
      })),
    hasMore: history.hasMore,
    contextTokens: jobs.length
      ? ((
          await db
            .selectFrom("ai_calls")
            .select("input_tokens")
            .where(
              "job_id",
              "in",
              jobs.map((j) => j.id),
            )
            .where("input_tokens", ">", 0)
            .orderBy("created_at", "desc")
            .executeTakeFirst()
        )?.input_tokens ?? null)
      : null,
    jobs: jobs.map(({ result, ...job }) => ({
      ...job,
      status: continuationJobStatus({ ...job, result }),
      progress: result ? JSON.parse(result).progress : undefined,
    })),
    operations: operations.map((o) => ({
      ...o,
      result: JSON.parse(o.result),
    })),
  };
}
