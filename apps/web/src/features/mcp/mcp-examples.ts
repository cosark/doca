/** Shell quoting is separate from TOML/JSON string encoding. Tokens never enter examples. */
const shell = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
export function mcpExamples(
  serviceId: string,
  endpoint: string,
  admin: boolean,
) {
  const name = `doca-${serviceId.slice(0, 8)}`;
  const env = `DOCA_MCP_TOKEN_${serviceId.replaceAll("-", "").toUpperCase()}`;
  const command = `codex mcp add ${name} --url ${shell(endpoint)} --bearer-token-env-var ${env}`;
  const toml = `[mcp_servers.${name}]\nurl = ${JSON.stringify(endpoint)}\nbearer_token_env_var = ${JSON.stringify(env)}\n`;
  const initialize = JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "company-platform", version: "1.0.0" },
      },
    },
    null,
    2,
  );
  const discover = JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "doca_tools",
        arguments: {
          purpose: "Write a test report",
          ...(admin ? { userId: "<TARGET_USER_UUID>" } : {}),
        },
      },
    },
    null,
    2,
  );
  const curl = (payload: string) =>
    `curl ${shell(endpoint)} \\\n  -H "Authorization: Bearer $${env}" \\\n  -H 'Content-Type: application/json' \\\n  -H 'Accept: application/json, text/event-stream' \\\n  -H 'MCP-Protocol-Version: 2025-11-25' \\\n  --data ${shell(payload)}`;
  const unattended =
    toml +
    `\n[mcp_servers.${name}.tools.doca_call]\napproval_mode = "approve"\n`;
  return {
    name,
    env,
    command,
    toml,
    unattended,
    initialize: curl(initialize),
    discover: curl(discover),
  };
}
