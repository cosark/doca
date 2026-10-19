import { fail } from "@core/shared/errors.js";

/** Stable presentation codes; tool/model feedback keeps the concrete diagnostic. */
export function mcpFail(status: number, message: string): never {
  const code =
    status === 400
      ? "mcp_invalid"
      : status === 409
        ? "mcp_conflict"
        : status === 403
          ? "mcp_forbidden"
          : status === 401 || status === 404
            ? "mcp_unavailable"
            : status === 413 || status === 416 || status === 429
              ? "mcp_limit"
              : "mcp_failed";
  fail(status, message, { code });
}
