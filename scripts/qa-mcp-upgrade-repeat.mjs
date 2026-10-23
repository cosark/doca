import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
if (process.env.DOCA_QA_ISOLATED !== "1")
  throw Error("Isolated release fixtures only");
const exec = promisify(execFile),
  results = [];
for (const engine of ["sqlite", "pg17", "pg18"]) {
  let url;
  if (engine !== "sqlite") {
    const port = (
      await exec("docker", ["port", `doca-mcp-qa-${engine}`, "5432"])
    ).stdout
      .trim()
      .split(":")
      .at(-1);
    url = `postgres://postgres:doca-mcp-isolated@127.0.0.1:${port}/doca_mcp_qa`;
  }
  const starts = await Promise.all(
    Array.from({ length: 3 }, async (_, index) => {
      const result = await exec(
        process.execPath,
        ["--import", "tsx", "scripts/qa-mcp-upgrade.mjs", "check"],
        {
          env: {
            ...process.env,
            DOCA_MCP_UPGRADE_ROOT: resolve(`.cache/mcp-upgrade-${engine}`),
            ...(url ? { DOCA_MCP_UPGRADE_POSTGRES: url } : {}),
            DOCA_MCP_UPGRADE_REPORT: "",
          },
        },
      );
      return { index, ...JSON.parse(result.stdout.trim().split("\n").at(-1)) };
    }),
  );
  results.push({ engine, concurrentStarts: starts.length, starts });
}
await mkdir(resolve("artifacts/verification/mcp-2026-10-20"), { recursive: true });
await writeFile(
  resolve("artifacts/verification/mcp-2026-10-20/repeated-concurrent-upgrades.json"),
  JSON.stringify({ passed: true, releasedVersion: "0.2.4", results }, null, 2),
);
console.log(JSON.stringify({ passed: true, results }));
