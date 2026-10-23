// Creates synthetic databases with the actual released image; never accepts a user database URL.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const exec = promisify(execFile),
  results = [];
const script = resolve("scripts/qa-browser-clipper-upgrade.mjs");
const reportRoot = resolve(
  "artifacts/verification/browser-clipper-login-2026-10-21",
);
await mkdir(reportRoot, { recursive: true });
for (const engine of ["sqlite", "pg17", "pg18"]) {
  const root = resolve(".local/browser-clipper-login-release-" + engine);
  await mkdir(root, { recursive: true });
  let url, oldUrl;
  const args = [
    "run",
    "--rm",
    "--user",
    "root",
    "--entrypoint",
    "node",
    "--mount",
    `type=bind,src=${root},dst=/qa`,
    "--mount",
    `type=bind,src=${script},dst=/app/clipper-upgrade.mjs,readonly`,
    "-e",
    "DOCA_QA_ISOLATED=1",
    "-e",
    "DOCA_CLIPPER_SOURCE_ROOT=/app",
    "-e",
    "DOCA_CLIPPER_UPGRADE_ROOT=/qa",
  ];
  if (engine !== "sqlite") {
    const container = "doca-clipper-qa-" + engine;
    await exec("docker", [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-c",
      "CREATE DATABASE clipper_login_released_upgrade",
    ]);
    const port = (await exec("docker", ["port", container, "5432"])).stdout
      .trim()
      .split(":")
      .at(-1);
    url = `postgres://postgres:isolated-clipper-test@127.0.0.1:${port}/clipper_login_released_upgrade`;
    oldUrl =
      "postgres://postgres:isolated-clipper-test@127.0.0.1:5432/clipper_login_released_upgrade";
    args.push(
      "--network",
      "container:" + container,
      "-e",
      "DOCA_CLIPPER_UPGRADE_POSTGRES=" + oldUrl,
    );
  }
  args.push(
    "smartdoca/doca:0.2.6",
    "--import",
    "tsx",
    "/app/clipper-upgrade.mjs",
    "seed",
  );
  const seeded = await exec("docker", args, { maxBuffer: 2e6 });
  const env = {
    ...process.env,
    DOCA_QA_ISOLATED: "1",
    DOCA_CLIPPER_UPGRADE_ROOT: root,
    ...(url ? { DOCA_CLIPPER_UPGRADE_POSTGRES: url } : {}),
    DOCA_CLIPPER_UPGRADE_REPORT: resolve(
      reportRoot,
      engine + "-released-upgrade.json",
    ),
  };
  const upgraded = await exec(
    process.execPath,
    ["--import", "tsx", script, "check"],
    { env, maxBuffer: 2e6 },
  );
  const starts = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const result = await exec(
        process.execPath,
        ["--import", "tsx", script, "check"],
        { env: { ...env, DOCA_CLIPPER_UPGRADE_REPORT: "" }, maxBuffer: 2e6 },
      );
      return JSON.parse(result.stdout.trim().split("\n").at(-1));
    }),
  );
  assert(starts.every((start) => start.passed));
  results.push({
    engine,
    seed: JSON.parse(seeded.stdout.trim().split("\n").at(-1)),
    upgrade: JSON.parse(upgraded.stdout.trim().split("\n").at(-1)),
    concurrentStarts: starts.length,
  });
}
await writeFile(
  resolve(reportRoot, "released-upgrade-summary.json"),
  JSON.stringify({ passed: true, results }, null, 2),
);
console.log(JSON.stringify({ passed: true, results }));
