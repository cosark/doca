import { sql, type Kysely } from "kysely";

export const browserClipperTables = [
  "browser_clipper_profiles",
  "browser_clipper_connections",
  "browser_clipper_activations",
  "browser_clipper_receipts",
  "browser_clipper_assistant_sessions",
  "browser_clipper_web_sessions",
  "browser_clipper_login_codes",
] as const;

/** Current target only: approved empty additions in the existing generation. */
export async function createBrowserClipperStructure(db: Kysely<any>) {
  for (const statement of [
    `CREATE TABLE "browser_clipper_profiles" ("id" text primary key, "user_id" text not null references "users"("id"), "name" text not null, "enabled" integer not null, "is_default" integer not null, "strategy" text not null, "library_id" text, "parent_id" text, "target_id" text, "title_template" text not null, "ai_instruction" text not null, "revision" integer not null, "created_at" text not null, "updated_at" text not null, constraint "clipper_profile_strategy" check (strategy in ('create','append')), constraint "clipper_profile_flags" check (enabled in (0,1) and is_default in (0,1)));`,
    `CREATE INDEX "clipper_profiles_user" on "browser_clipper_profiles"("user_id");`,
    `CREATE TABLE "browser_clipper_connections" ("id" text primary key, "user_id" text not null references "users"("id"), "name" text not null, "token_hash" text unique, "token_hint" text, "assistant_enabled" integer not null, "revoked_at" text, "expires_at" text, "revision" integer not null, "created_at" text not null, "updated_at" text not null, constraint "clipper_assistant_flag" check (assistant_enabled in (0,1)));`,
    `CREATE INDEX "clipper_connections_user" on "browser_clipper_connections"("user_id");`,
    `CREATE TABLE "browser_clipper_activations" ("id" text primary key, "connection_id" text not null references "browser_clipper_connections"("id"), "secret_hash" text not null unique, "connection_revision" integer not null, "expires_at" text not null, "consumed_at" text, "created_at" text not null);`,
    `CREATE INDEX "clipper_activations_connection" on "browser_clipper_activations"("connection_id");`,
    `CREATE TABLE "browser_clipper_receipts" ("user_id" text not null references "users"("id"), "request_id" text not null, "connection_id" text not null references "browser_clipper_connections"("id"), "input_hash" text not null, "profile_id" text not null references "browser_clipper_profiles"("id"), "profile_json" text not null, "payload_json" text not null, "images_json" text not null, "status" text not null, "resource_id" text, "expires_at" text not null, "created_at" text not null, "updated_at" text not null, primary key ("user_id","request_id"), constraint "clipper_receipt_status" check (status in ('pending','completed','expired')));`,
    `CREATE INDEX "clipper_receipts_expiry" on "browser_clipper_receipts"("status","expires_at");`,
    `CREATE TABLE "browser_clipper_assistant_sessions" ("session_id" text primary key references "ai_sessions"("id") on delete cascade, "connection_id" text not null references "browser_clipper_connections"("id"), "user_id" text not null references "users"("id"), "profile_id" text not null references "browser_clipper_profiles"("id"), "profile_revision" integer not null, "resource_ids" text not null, "job_ids" text not null, "created_at" text not null);`,
    `CREATE INDEX "clipper_assistant_connection" on "browser_clipper_assistant_sessions"("connection_id");`,
    `CREATE TABLE "browser_clipper_web_sessions" ("connection_id" text primary key references "browser_clipper_connections"("id"), "user_id" text not null references "users"("id"), "installation_id" text not null, "website_session_id" text not null, "token_hash" text unique, "expires_at" text, "created_at" text not null, "updated_at" text not null, constraint "clipper_installation_user" unique ("user_id", "installation_id"));`,
    `CREATE TABLE "browser_clipper_login_codes" ("code_hash" text primary key, "connection_id" text not null references "browser_clipper_connections"("id"), "website_session_id" text not null, "challenge" text not null, "expires_at" text not null, "consumed_at" text, "created_at" text not null);`,
    `CREATE INDEX "clipper_login_codes_expiry" on "browser_clipper_login_codes"("expires_at");`,
  ])
    await sql.raw(statement).execute(db);
}
