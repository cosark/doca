// Released book data, cold checkpoints and real HTTP startup in disposable volumes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
const run = promisify(execFile);
const arch = process.argv[2];
assert(["amd64", "arm64"].includes(arch));
const keep = process.argv.includes("--keep");
const image = "smartdoca/doca:0.2.4-candidate";
const name = `doca-release024-${arch}-${Date.now()}`;
const volume = name + "-data";
const output = resolve("artifacts/release-0.2.4");
await mkdir(output, { recursive: true });
const docker = async (...args) =>
  (await run("docker", args, { maxBuffer: 20_000_000 })).stdout.trim();
const fixtureScript = resolve(
  "docs/verification/release-0.2.4/released-roundtrip.mjs",
);
const coldScript = resolve(
  "docs/verification/knowledge-book-checkpoints-2026-10-19/crash-roundtrip.mjs",
);
const coldTarget =
  "/app/docs/verification/knowledge-book-checkpoints-2026-10-19/crash-roundtrip.mjs";
const env = [
  "DOCA_ORIGIN=http://127.0.0.1:39120",
  `DOCA_CREDENTIAL_MASTER_KEY=${randomBytes(32).toString("hex")}`,
  "DOCA_SQLITE_PATH=/data/book/released.db",
  "DOCA_FILE_STORE_ID=checkpoint-released-qa",
  'DOCA_FILE_STORES_JSON={"version":1,"stores":{"checkpoint-released-qa":{"provider":"local","root":"/data/book/objects"}}}',
  "DOCA_BOOK_BATCH_CHECKPOINTS=on",
];
let base,
  succeeded = false;
const request = (path, init = {}) =>
  new Promise((resolve, reject) => {
    const body = init.body === undefined ? undefined : Buffer.from(init.body);
    const req = httpRequest(
      base + path,
      {
        method: init.method ?? "GET",
        headers: {
          host: "127.0.0.1:39120",
          origin: "http://127.0.0.1:39120",
          ...init.headers,
          ...(body ? { "content-length": body.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          try {
            let bytes = Buffer.concat(chunks);
            if (res.headers["content-encoding"] === "gzip")
              bytes = gunzipSync(bytes);
            if (res.headers["content-encoding"] === "br")
              bytes = brotliDecompressSync(bytes);
            resolve(
              new Response(bytes, {
                status: res.statusCode,
                headers: Object.fromEntries(
                  Object.entries(res.headers)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
                ),
              }),
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () =>
      req.destroy(Error("Fixture request timed out")),
    );
    req.end(body);
  });
const ready = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await request("/health");
      if (r.ok && (await r.json()).version === "0.2.4") return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Image startup timed out");
};
const roundtrip = async (selected, mode) => {
  const raw = await docker(
    "run",
    "--rm",
    "--platform",
    `linux/${arch}`,
    "-v",
    `${volume}:/data`,
    "-v",
    `${fixtureScript}:/qa/released-roundtrip.mjs:ro`,
    "-e",
    `DOCA_CHECKPOINT_MODE=${mode}`,
    "-e",
    "DOCA_CHECKPOINT_FIXTURE_ROOT=/data/book",
    "--entrypoint",
    "node",
    selected,
    "--import",
    "tsx",
    "/qa/released-roundtrip.mjs",
  );
  return JSON.parse(raw.split("\n").at(-1));
};
const cold = async (mode) => {
  const args = [
    "run",
    "--rm",
    "--init",
    "--platform",
    `linux/${arch}`,
    "-v",
    `${volume}:/data`,
    "-v",
    `${coldScript}:${coldTarget}:ro`,
    "-e",
    `DOCA_CHECKPOINT_CRASH_MODE=${mode}`,
    "-e",
    "DOCA_CHECKPOINT_CRASH_ROOT=/data/cold",
    "--entrypoint",
    "node",
    image,
    "--import",
    "tsx",
    coldTarget,
  ];
  try {
    return {
      exit: 0,
      result: JSON.parse((await docker(...args)).split("\n").at(-1)),
    };
  } catch (error) {
    if (mode === "save" && error.code === 137)
      return {
        exit: 137,
        result: JSON.parse(error.stdout.trim().split("\n").at(-1)),
      };
    throw error;
  }
};
const login = async () => {
  const r = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      login: "released-checkpoint-qa",
      password: "isolated-release-book-password",
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.headers.get("set-cookie").split(";")[0];
};
try {
  await docker("volume", "create", volume);
  const original = await roundtrip("smartdoca/doca:0.2.3", "seed");
  const upgrade = await roundtrip(image, "verify");
  assert.equal(upgrade.oldBodyByteExact, true);
  assert.equal(upgrade.checkpointRows, 0);
  const killed = await cold("save");
  assert.equal(killed.exit, 137);
  const restored = await cold("resume");
  assert.equal(restored.result.originalBatchCalls, 0);
  assert.equal(restored.result.missingBatchCalls, 1);
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "--platform",
    `linux/${arch}`,
    "-p",
    "127.0.0.1::39120",
    "--security-opt",
    `seccomp=${resolve("docker/chromium-seccomp.json")}`,
    "--shm-size",
    "1g",
    "-v",
    `${volume}:/data`,
    ...env.flatMap((e) => ["-e", e]),
    image,
  );
  base = "http://" + (await docker("port", name, "39120"));
  await ready();
  // Check complete rows before login legitimately updates last_login_at.
  const repeated = await roundtrip(image, "verify");
  assert.equal(repeated.oldBodyByteExact, true);
  let cookie = await login();
  assert.equal(
    (await request("/health", { headers: { host: "wrong.invalid" } })).status,
    421,
  );
  const books = await request("/api/v1/knowledge-books", {
    headers: { cookie },
  });
  assert.equal(books.status, 200);
  assert((await books.text()).includes(original.bookId));
  const detail = await request(`/api/v1/knowledge-books/${original.bookId}`, {
    headers: { cookie },
  });
  assert.equal(detail.status, 200, await detail.clone().text());
  const retainedDetail = await detail.json();
  assert(JSON.stringify(retainedDetail).includes("Retained"));
  assert(retainedDetail.publishedRelease);
  const html = await (await request("/")).text(),
    asset = html.match(/src="([^"]+\.js)"/)[1];
  for (const encoding of ["gzip", "br"]) {
    const r = await request(asset, {
      headers: { "accept-encoding": encoding },
    });
    assert(r.ok);
    assert.equal(r.headers.get("content-encoding"), encoding);
    assert((await r.arrayBuffer()).byteLength > 0);
  }
  const runtime = JSON.parse(
    await docker(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import fs from 'node:fs'; const p=JSON.parse(fs.readFileSync('/app/package.json')); console.log(JSON.stringify({version:p.version,uid:process.getuid()}));",
    ),
  );
  assert.equal(runtime.version, "0.2.4");
  assert.equal(runtime.uid, 1000);
  await docker("restart", "--time", "20", name);
  base = "http://" + (await docker("port", name, "39120"));
  await ready();
  cookie = await login();
  const afterRestart = await request(
    `/api/v1/knowledge-books/${original.bookId}`,
    { headers: { cookie } },
  );
  assert.equal(afterRestart.status, 200);
  assert.deepEqual(
    (await afterRestart.json()).publishedRelease,
    retainedDetail.publishedRelease,
  );
  await docker("stop", "--time", "20", name);
  assert.equal(
    await docker("inspect", "--format", "{{.State.ExitCode}}", name),
    "0",
  );
  const result = {
    arch,
    passed: true,
    runtime,
    health: true,
    hostValidation: true,
    compression: ["gzip", "br"],
    originalUserLogin: true,
    oldBookRead: true,
    restart: true,
    gracefulStop: true,
    releasedUpgrade: { from: "0.2.3", ...upgrade, repeated },
    coldProcess: { killed, restored },
  };
  await writeFile(
    resolve(output, `${arch}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (keep) {
    await docker("start", name);
    base = "http://" + (await docker("port", name, "39120"));
    await ready();
    await writeFile(
      resolve(output, `${arch}-preview.json`),
      JSON.stringify({ name, volume, base, bookId: original.bookId }) + "\n",
    );
  }
  succeeded = true;
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(await docker("logs", "--tail", "40", name).catch(() => ""));
  throw error;
} finally {
  if (!keep || !succeeded) {
    await docker("rm", "-f", name).catch(() => {});
    await docker("volume", "rm", volume).catch(() => {});
  }
}
