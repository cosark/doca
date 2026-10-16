import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { request as httpRequest } from "node:http";
import { gunzipSync, brotliDecompressSync } from "node:zlib";

const run = promisify(execFile);
const [arch, pgPort, pluginZip] = process.argv.slice(2);
assert(["arm64", "amd64"].includes(arch));
const image = `smartdoca/doca:0.1.30-${arch}-candidate`;
const output = resolve(`.cache/release-0.1.30/${arch}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const results = [];
const docker = async (...args) =>
  (await run("docker", args, { maxBuffer: 20_000_000 })).stdout.trim();
const fileHashes = async (root, prefix = "") => {
  const hashes = {};
  for (const file of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix ? `${prefix}/${file.name}` : file.name;
    if (file.isDirectory()) Object.assign(hashes, await fileHashes(root, name));
    else
      hashes[name] = createHash("sha256")
        .update(await readFile(join(root, name)))
        .digest("hex");
  }
  return hashes;
};

for (const driver of ["sqlite", "postgres"]) {
  const name = `doca-0130-${arch}-${driver}-${Date.now()}`;
  const volume = name + "-data";
  const headers = { host: "127.0.0.1:39120", origin: "http://127.0.0.1:39120" };
  const env = [
    "DOCA_ORIGIN=http://127.0.0.1:39120",
    `DOCA_CREDENTIAL_MASTER_KEY=${randomBytes(32).toString("hex")}`,
  ];
  const initialImage =
    driver === "postgres" && arch === "arm64" ? "smartdoca/doca:0.1.29" : image;
  if (driver === "postgres")
    env.push(
      "DOCA_DATABASE=postgres",
      `DOCA_DATABASE_URL=postgres://postgres:isolated-test@host.docker.internal:${pgPort}/release0130_${arch}_core`,
      `DOCA_PLUGIN_DATABASE_URL=postgres://postgres:isolated-test@host.docker.internal:${pgPort}/release0130_${arch}_business`,
    );
  let base;
  const request = (path, init = {}) =>
    new Promise((resolve, reject) => {
      const body = init.body === undefined ? undefined : Buffer.from(init.body);
      const req = httpRequest(
        base + path,
        {
          method: init.method ?? "GET",
          headers: {
            ...headers,
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
                      .filter(([, value]) => value !== undefined)
                      .map(([key, value]) => [
                        key,
                        Array.isArray(value) ? value.join(", ") : value,
                      ]),
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
      req.setTimeout(path === "/health" ? 3000 : 30000, () =>
        req.destroy(Error("HTTP fixture request timed out")),
      );
      req.end(body);
    });
  const ready = async (version = "0.1.30") => {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const result = await request("/health");
        if (result.status === 200) {
          assert.equal((await result.json()).version, version);
          return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Error("Container did not become healthy");
  };
  try {
    await docker("volume", "create", volume);
    const start = async (selected) => {
      await docker(
        "run",
        "-d",
        "--name",
        name,
        "--platform",
        `linux/${arch}`,
        "-p",
        "127.0.0.1::39120",
        "-v",
        `${volume}:/data`,
        ...env.flatMap((value) => ["-e", value]),
        selected,
      );
      base = "http://" + (await docker("port", name, "39120"));
    };
    await start(initialImage);
    base = "http://" + (await docker("port", name, "39120"));
    await ready(initialImage === image ? "0.1.30" : "0.1.29");
    assert.equal(
      (await request("/health", { headers: { host: "wrong.invalid" } })).status,
      421,
    );
    const html = await (await request("/")).text();
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    for (const encoding of ["gzip", "br"]) {
      const result = await request(asset, {
        headers: { "accept-encoding": encoding },
      });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("content-encoding"), encoding);
      await result.arrayBuffer();
    }
    if (initialImage === image) {
      const source = await docker(
        "exec",
        name,
        "node",
        "--input-type=module",
        "-e",
        "import fs from 'node:fs';const source=fs.readFileSync('/app/apps/server/src/services/plugin-databases.ts','utf8');if(/rolsuper|pg_auth_members|has_table_privilege/.test(source))process.exit(1);console.log(JSON.stringify({version:JSON.parse(fs.readFileSync('/app/package.json')).version,accountRestrictionsAbsent:true}));",
      );
      assert.equal(JSON.parse(source).version, "0.1.30");
    }
    await docker(
      "exec",
      "-e",
      "DOCA_BOOTSTRAP_LOGIN=release-admin",
      "-e",
      "DOCA_BOOTSTRAP_PASSWORD=isolated-release-password",
      name,
      "node",
      "--import",
      "tsx",
      "apps/server/src/bootstrap/admin.ts",
    );
    const login = async () => {
      const result = await request("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          login: "release-admin",
          password: "isolated-release-password",
        }),
      });
      assert.equal(result.status, 200, await result.clone().text());
      return result.headers.get("set-cookie").split(";")[0];
    };
    let cookie = await login();
    if (driver === "postgres") {
      const upload = await request("/api/v1/admin/plugins/upload", {
        method: "POST",
        headers: { cookie, "content-type": "application/zip" },
        body: await readFile(pluginZip),
      });
      assert.equal(upload.status, 200, await upload.clone().text());
      if (initialImage !== image) {
        await docker("stop", "--time", "20", name);
        await docker("rm", name);
        await start(image);
      } else {
        await docker("restart", "--time", "20", name);
        base = "http://" + (await docker("port", name, "39120"));
      }
      await ready();
      cookie = await login();
      const saved = await request(
        "/api/v1/plugins/doca.resources.manage/preferences",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ capture: true }),
        },
      );
      assert.equal(saved.status, 200, await saved.clone().text());
      await docker("restart", "--time", "20", name);
      base = "http://" + (await docker("port", name, "39120"));
      await ready();
      cookie = await login();
      const retained = await request(
        "/api/v1/plugins/doca.resources.manage/preferences",
        { headers: { cookie } },
      );
      assert.equal(retained.status, 200, await retained.clone().text());
      assert.equal((await retained.json()).capture, true);
    } else {
      await docker("cp", `${name}:/app/apps/web/dist`, join(output, "dist"));
      await writeFile(
        join(output, "assets.json"),
        JSON.stringify(await fileHashes(join(output, "dist/assets")), null, 2) +
          "\n",
      );
    }
    await docker("stop", "--time", "20", name);
    assert.equal(
      await docker("inspect", "--format", "{{.State.ExitCode}}", name),
      "0",
    );
    results.push({
      arch,
      driver,
      version: "0.1.30",
      health: true,
      hostValidation: true,
      compression: ["gzip", "br"],
      accountRestrictionsAbsent: true,
      administratorBootstrapAndLogin: true,
      ...(driver === "postgres"
        ? {
            sameSuperuserForSeparateDatabases: true,
            realResourcesPlugin: "0.1.4",
            preferenceRetainedAfterRestart: true,
            ...(initialImage !== image
              ? { released0129CoreAndStagedInstallRetained: true }
              : {}),
          }
        : {}),
      gracefulShutdown: true,
    });
    console.log(`${arch}/${driver}: passed`);
  } catch (error) {
    await writeFile(
      join(output, `${driver}-failure.log`),
      await docker("logs", name).catch(() => "No container logs"),
    );
    throw error;
  } finally {
    await docker("rm", "-f", name).catch(() => {});
    await docker("volume", "rm", volume).catch(() => {});
  }
}
await writeFile(
  resolve(`docs/verification/release-0.1.30/${arch}.json`),
  JSON.stringify(results, null, 2) + "\n",
);
