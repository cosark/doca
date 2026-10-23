import type { DB } from "@db/index.js";
import { fail } from "@core/shared/errors.js";

/** Read the actual retry lineage; caller holds the AI user lock when submitting. */
export async function imageRetryChain(
  db: DB,
  userId: string,
  sessionId: string,
  retryOf: string,
) {
  const jobs = [];
  const seen = new Set<string>();
  let id: unknown = retryOf;
  while (id) {
    if (typeof id !== "string" || seen.has(id) || seen.size >= 10)
      fail(409, "图片重试来源无效");
    seen.add(id);
    const job = await db.selectFrom("ai_jobs").selectAll()
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .where("session_id", "=", sessionId)
      .executeTakeFirst();
    if (!job) fail(409, "重试任务记录不可用");
    jobs.push(job);
    id = JSON.parse(job.input).retryOf;
  }
  return jobs;
}

/** Current receipt facts only: no inferred defaults, usage reconciliation or writes. */
export function unresolvedImageFailure(operations: readonly { result: string }[]) {
  for (const operation of operations) {
    const result = JSON.parse(operation.result);
    if (!["image_generation", "image_revision"].includes(result.kind)) continue;
    if (result.state === "generating") return {
      message: "原任务的图片结果和费用仍待核对，不能重复提交或通过重试、改变参数再次生成；请先检查原任务记录",
      reason: { code: "image_result_uncertain" },
    };
    if (result.state === "save_failed") return {
      message: "原任务的图片已生成但保存失败，不能重复提交或改变参数再次计费；请检查保留的候选并本地恢复",
      reason: { code: "image_save_failed_retry_blocked" },
    };
  }
}

export async function assertImageRetriesResolved(db: DB, userId: string, jobIds: string[]) {
  if (!jobIds.length) return;
  const operations = await db.selectFrom("ai_operations").select("result")
    .where("user_id", "=", userId).where("job_id", "in", jobIds).execute();
  const failure = unresolvedImageFailure(operations);
  if (failure) fail(409, failure.message, failure.reason);
}
