import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DB, Schema } from "@db/index.js";
import { mcpFail as fail } from "./mcp-errors.js";
import { tokenHash, type Actor } from "@core/modules/identity/passwords.js";
import { requireCapability } from "@core/modules/access/operation-policy.js";

export const mcpTokenPattern = /^Bearer (doca_mcp_v1_[a-f0-9]{64})$/;
export type McpService = Schema["mcp_services"];
export const grantIds = z
  .array(z.string().min(1).max(160))
  .max(300)
  .refine((ids) => new Set(ids).size === ids.length);
export function newMcpToken() {
  const token = "doca_mcp_v1_" + randomBytes(32).toString("hex");
  return { token, token_hash: tokenHash(token), token_hint: token.slice(-8) };
}
export function allowsMcpTool(service: McpService, id: string) {
  return (
    service.grant_mode === "all" ||
    grantIds.parse(JSON.parse(service.tool_ids)).includes(id)
  );
}
export function allowsMcpSkill(service: McpService, id: string) {
  return (
    service.grant_mode === "all" ||
    grantIds.parse(JSON.parse(service.skill_ids)).includes(id)
  );
}
export async function activeMcpService(
  db: DB,
  id: string,
): Promise<McpService> {
  const service = await db
    .selectFrom("mcp_services")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (
    !service ||
    !service.enabled ||
    service.revoked_at ||
    (service.expires_at && service.expires_at <= new Date().toISOString())
  )
    fail(401, "MCP service is disabled, expired or revoked");
  // Reject malformed stored grants; never reinterpret them as full access.
  grantIds.parse(JSON.parse(service.tool_ids));
  grantIds.parse(JSON.parse(service.skill_ids));
  const owner = await db
    .selectFrom("users")
    .select(["status", "admin"])
    .where("id", "=", service.owner_id)
    .executeTakeFirst();
  if (owner?.status !== "active" || (service.kind === "admin" && !owner.admin))
    fail(401, "MCP service owner is unavailable");
  if (service.kind === "personal") {
    const settings = await db
      .selectFrom("mcp_user_settings")
      .select("enabled")
      .where("user_id", "=", service.owner_id)
      .executeTakeFirst();
    if (!settings?.enabled) fail(401, "Personal MCP is disabled");
  }
  return service;
}
export async function authenticateMcp(db: DB, authorization?: string) {
  const token = mcpTokenPattern.exec(authorization ?? "")?.[1];
  if (!token) fail(401, "A current MCP bearer token is required");
  const service = await db
    .selectFrom("mcp_services")
    .select("id")
    .where("token_hash", "=", tokenHash(token))
    .executeTakeFirst();
  if (!service) fail(401, "Invalid MCP token");
  return activeMcpService(db, service.id);
}
export async function mcpActor(
  db: DB,
  service: McpService,
  userId?: string,
): Promise<Actor> {
  if (service.kind === "admin" && !userId)
    fail(400, "Admin MCP operations require userId");
  if (service.kind === "personal" && userId !== undefined)
    fail(400, "Personal MCP operations cannot specify userId");
  const actor = await db
    .selectFrom("users")
    .select(["id", "display_name", "public_id", "admin"])
    .where("id", "=", service.kind === "personal" ? service.owner_id : userId!)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!actor) fail(403, "MCP target user is unavailable");
  await requireCapability(db, actor.id, "mcp.use");
  return actor;
}
