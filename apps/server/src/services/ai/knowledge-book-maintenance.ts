import type { DB } from "@db/index.js";
import { recoverBookRuns } from "@core/modules/knowledge-books/recovery.js";
import { publishBookTaskNotifications } from "@core/modules/knowledge-books/notifications.js";
import { wakeAIContinuations } from "./continuations.js";
import { pluginServices } from "@core/shared/plugin-services.js";
import { BOOK_CONTINUATION_SOURCE } from "./knowledge-book-continuation.js";

/** Separate from execution: a long model call must not block recovery or delivery. */
export async function reconcileKnowledgeBookRuns(db: DB, now = Date.now()) {
  await recoverBookRuns(db, new Date(now - 5 * 60_000).toISOString());
  const outcomes = await Promise.allSettled([
    pluginServices(db).continuations.has(BOOK_CONTINUATION_SOURCE)
      ? wakeAIContinuations(db)
      : Promise.resolve(),
    publishBookTaskNotifications(db),
  ]);
  for (const outcome of outcomes)
    if (outcome.status === "rejected") throw outcome.reason;
}
