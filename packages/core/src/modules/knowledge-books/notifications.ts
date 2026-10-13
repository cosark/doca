import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { DB } from "@db/index.js";
import { transact } from "@db/transactions.js";
import { accessContext, roleQuery } from "../access/queries.js";
import { permission } from "../access/policy.js";
import { emitIntegrationEvent } from "../automation/events.js";
import { readBookRunTriggers } from "./run-logs.js";

export const bookNotificationTypes = [
  "knowledge_book.failed",
  "knowledge_book.review",
  "knowledge_book.publication",
] as const;
const types = {
  repair: bookNotificationTypes[0],
  review: bookNotificationTypes[1],
  publication: bookNotificationTypes[2],
};

export function bookNotificationPath(
  bookId: string,
  dedupeKey: string | null | undefined,
) {
  const match =
    /^knowledge-book:([0-9a-f-]{36}):([1-9][0-9]*):[0-9a-f-]{36}$/i.exec(
      dedupeKey ?? "",
    );
  return match ? `#/knowledge-books/${bookId}?task=${match[1]}` : undefined;
}

/** Pending tasks are the durable delivery source. A restart retries undelivered keys. */
export async function publishBookTaskNotifications(db: DB) {
  let cursor: string | undefined;
  let delivered = 0;
  for (;;) {
    let query = db
      .selectFrom("knowledge_book_human_tasks as t")
      .innerJoin("knowledge_book_runs as run", "run.id", "t.run_id")
      .innerJoin("resources as r", "r.id", "t.book_id")
      .selectAll("t")
      .select("run.trigger_key")
      .where("t.status", "=", "pending")
      .where("r.deleted_at", "is", null)
      .where("run.status", "in", [
        "failed",
        "awaiting_input",
        "awaiting_publication",
      ]);
    if (cursor) query = query.where("t.id", ">", cursor);
    const tasks = await query.orderBy("t.id").limit(50).execute();
    if (!tasks.length) break;
    const initiators = new Map<string, string>();
    for (const bookId of new Set(tasks.map((task) => task.book_id))) {
      const runs = tasks
        .filter((task) => task.book_id === bookId)
        .map((task) => ({ id: task.run_id, trigger_key: task.trigger_key }));
      for (const [runId, trigger] of await readBookRunTriggers(
        db,
        bookId,
        runs,
      ))
        initiators.set(runId, trigger.actorId);
    }
    const ctx = await accessContext(
      db,
      null,
      tasks.map((task) => task.book_id),
    );
    const candidates = [
      ...new Set([
        ...initiators.values(),
        ...ctx.resources.map((resource) => resource.owner_id),
        ...ctx.grants.map((grant) => grant.user_id),
      ]),
    ];
    const users = await db
      .selectFrom("users")
      .select(["id", "display_name", "admin"])
      .where("id", "in", candidates)
      .where("status", "=", "active")
      .execute();
    for (const task of tasks) {
      const resource = ctx.resources.find(
        (resource) => resource.id === task.book_id,
      );
      if (!resource || resource.deleted_at) continue;
      for (const user of users) {
        const minimum = user.id === initiators.get(task.run_id) ? 3 : 4;
        if (permission(resource, user, ctx.resources, ctx.grants) < minimum)
          continue;
        const inserted = await transact(db, async (tx) => {
          const current = await tx
            .selectFrom("knowledge_book_human_tasks as t")
            .innerJoin("knowledge_book_runs as run", "run.id", "t.run_id")
            .innerJoin("resources as r", "r.id", "t.book_id")
            .select("t.id")
            .where("t.id", "=", task.id)
            .where("t.status", "=", "pending")
            .where("t.revision", "=", task.revision)
            .where("run.status", "in", [
              "failed",
              "awaiting_input",
              "awaiting_publication",
            ])
            .where("r.deleted_at", "is", null)
            .where(roleQuery(sql.ref("r.id"), user), ">=", minimum)
            .executeTakeFirst();
          if (
            !current ||
            !(await tx
              .selectFrom("users")
              .select("id")
              .where("id", "=", user.id)
              .where("status", "=", "active")
              .executeTakeFirst())
          )
            return false;
          const id = randomUUID(),
            type = types[task.kind];
          const dedupeKey = `knowledge-book:${task.id}:${task.revision}:${user.id}`;
          const result = await tx
            .insertInto("notifications")
            .values({
              id,
              user_id: user.id,
              actor_id: null,
              resource_id: task.book_id,
              type,
              read_at: null,
              created_at: new Date().toISOString(),
              dedupe_key: dedupeKey,
            })
            .onConflict((conflict) => conflict.column("dedupe_key").doNothing())
            .executeTakeFirst();
          if (!Number(result.numInsertedOrUpdatedRows)) return false;
          await emitIntegrationEvent(tx, "notification.created", {
            notificationId: id,
            userId: user.id,
            resourceId: task.book_id,
            type,
            path: bookNotificationPath(task.book_id, dedupeKey),
          });
          return true;
        });
        if (inserted) delivered++;
      }
    }
    cursor = tasks.at(-1)!.id;
    if (tasks.length < 50) break;
  }
  return { delivered };
}
