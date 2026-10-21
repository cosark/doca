import type { DB, Schema } from "@db/index.js";
import { tokenHash, type Actor } from "../identity/passwords.js";
import { fail } from "../../shared/errors.js";
import { z } from "zod";

export type BrowserConnection = Schema["browser_clipper_connections"];
export const resourceScope = z
  .object({ version: z.literal(1), ids: z.array(z.string().uuid()).max(500) })
  .strict();

export async function requireBrowserConnection(
  db: DB,
  id: string,
  assistant = false,
) {
  const connection = await db
    .selectFrom("browser_clipper_connections")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!connection || connection.revoked_at)
    fail(401, "clipper_connection_revoked");
  const binding = await db
    .selectFrom("browser_clipper_web_sessions")
    .selectAll()
    .where("connection_id", "=", id)
    .where("user_id", "=", connection.user_id)
    .executeTakeFirst();
  if (!binding) fail(401, "clipper_login_required");
  const website = await db
    .selectFrom("sessions")
    .select("id")
    .where("id", "=", binding.website_session_id)
    .where("user_id", "=", connection.user_id)
    .where("expires_at", ">", new Date().toISOString())
    .executeTakeFirst();
  if (!website) fail(401, "clipper_login_required");
  if (assistant && !connection.assistant_enabled)
    fail(403, "clipper_assistant_disabled");
  const actor = await db
    .selectFrom("users")
    .select(["id", "display_name", "public_id", "admin"])
    .where("id", "=", connection.user_id)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!actor) fail(401, "clipper_connection_revoked");
  return { connection, actor: actor as Actor };
}

export async function authenticateBrowserConnection(
  db: DB,
  authorization?: string,
) {
  const token = /^Bearer (doca_browser_v2_[a-f0-9]{64})$/.exec(
    authorization ?? "",
  )?.[1];
  if (!token) fail(401, "clipper_token_required");
  const row = await db
    .selectFrom("browser_clipper_web_sessions")
    .select(["connection_id", "expires_at"])
    .where("token_hash", "=", tokenHash(token))
    .executeTakeFirst();
  if (!row) fail(401, "clipper_login_required");
  if (!row.expires_at || row.expires_at <= new Date().toISOString())
    fail(401, "clipper_token_expired");
  return requireBrowserConnection(db, row.connection_id);
}

/** Called at execution and mutation boundaries, including workers on other hosts. */
export async function browserAssistantBoundary(
  db: DB,
  sessionId: string,
  jobId?: string,
) {
  const binding = await db
    .selectFrom("browser_clipper_assistant_sessions")
    .selectAll()
    .where("session_id", "=", sessionId)
    .executeTakeFirst();
  if (!binding) return null;
  if (
    jobId &&
    !resourceScope.parse(JSON.parse(binding.job_ids)).ids.includes(jobId)
  )
    return null;
  const { connection } = await requireBrowserConnection(
    db,
    binding.connection_id,
    true,
  );
  if (connection.user_id !== binding.user_id) fail(403, "clipper_scope_denied");
  const profile = await db
    .selectFrom("browser_clipper_profiles")
    .select(["enabled", "revision"])
    .where("id", "=", binding.profile_id)
    .where("user_id", "=", binding.user_id)
    .executeTakeFirst();
  if (!profile?.enabled) fail(403, "clipper_profile_unavailable");
  if (profile.revision !== binding.profile_revision)
    fail(409, "clipper_profile_changed");
  return {
    binding,
    connection,
    ids: resourceScope.parse(JSON.parse(binding.resource_ids)).ids,
  };
}

export async function cancelBrowserJobs(db: DB, connectionIds: string[]) {
  if (!connectionIds.length) return;
  const bindings = await db
    .selectFrom("browser_clipper_assistant_sessions")
    .select("job_ids")
    .where("connection_id", "in", connectionIds)
    .execute();
  const jobs = bindings.flatMap(
    (binding) => resourceScope.parse(JSON.parse(binding.job_ids)).ids,
  );
  if (!jobs.length) return;
  await db
    .updateTable("ai_jobs")
    .set({
      cancelled: 1,
      status: "cancelled",
      lease: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .where("id", "in", jobs)
    .where("status", "in", ["queued", "running", "awaiting_approval"])
    .execute();
}

export async function cancelInactiveBrowserJobs(db: DB) {
  const rows = await db
    .selectFrom("browser_clipper_web_sessions as b")
    .leftJoin("sessions as s", "s.id", "b.website_session_id")
    .select("b.connection_id")
    .where((eb) =>
      eb.or([
        eb("s.id", "is", null),
        eb("s.expires_at", "<=", new Date().toISOString()),
      ]),
    )
    .execute();
  await cancelBrowserJobs(
    db,
    rows.map((row) => row.connection_id),
  );
}
