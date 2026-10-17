// Candidate-image acceptance with synthetic SQLite volumes only.
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
const image = "smartdoca/doca:0.1.31-candidate";
const name = `doca-release0131-${arch}-${Date.now()}`;
const volume = name + "-data";
const output = resolve("artifacts/release-0.1.31");
await mkdir(output, { recursive: true });
const docker = async (...args) =>
  (await run("docker", args, { maxBuffer: 20_000_000 })).stdout.trim();
const env = [
  "DOCA_ORIGIN=http://127.0.0.1:39120",
  `DOCA_CREDENTIAL_MASTER_KEY=${randomBytes(32).toString("hex")}`,
];
let base;
// Node fetch does not reliably preserve an explicit Host with a mapped port.
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
    "--security-opt",
    `seccomp=${resolve("docker/chromium-seccomp.json")}`,
    "--shm-size",
    "1g",
    "-v",
    `${volume}:/data`,
    ...env.flatMap((e) => ["-e", e]),
    selected,
  );
  base = "http://" + (await docker("port", name, "39120"));
};
const ready = async (version) => {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await request("/health");
      if (response.ok && (await response.json()).version === version) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Image startup timed out");
};
const login = async () => {
  const r = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      login: "release-admin",
      password: "isolated-release-password",
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.headers.get("set-cookie").split(";")[0];
};
const seed = `
import {openDatabase} from './packages/db/src/index.ts';
import {config} from './apps/server/src/bootstrap/config.ts';
import {createContent} from './packages/core/src/workflows/resources.ts';
import {readAIDocument,editAIDocument} from './packages/core/src/workflows/ai-documents.ts';
const db=await openDatabase(config().database);
try {
 const actor={...await db.selectFrom('users').selectAll().executeTakeFirstOrThrow(),admin:1};
 const r=await createContent(db).create(actor,{kind:'document',format:'canvas',title:'Released 0.1.30 canvas preservation'});
 const before=await readAIDocument(db,{actor},r.id);
 await editAIDocument(db,{actor},r.id,{seq:before.seq,epochId:before.epochId},[{type:'add',element:{id:'retained-text',tag:'Text',name:'text',x:40,y:60,width:360,height:80,text:'保留旧版本原生内容',fontSize:24,fill:'#234567'}}],crypto.randomUUID());
 const after=await readAIDocument(db,{actor},r.id);
 const state=await db.selectFrom('document_states').selectAll().where('resource_id','=',r.id).executeTakeFirstOrThrow();
 console.log(JSON.stringify({resourceId:r.id,value:after.value,seq:after.seq,epochId:after.epochId,state}));
} finally {await db.destroy();}`;
try {
  await docker("volume", "create", volume);
  const previous = arch === "arm64";
  await start(previous ? "smartdoca/doca:0.1.30" : image);
  await ready(previous ? "0.1.30" : "0.1.31");
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
  await login();
  let retained;
  if (previous) {
    retained = JSON.parse(
      await docker(
        "exec",
        name,
        "node",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        seed,
      ),
    );
    await docker("stop", "--time", "20", name);
    await docker("rm", name);
    await start(image);
    await ready("0.1.31");
    const check =
      seed.slice(0, seed.indexOf("const db=")) +
      `
const db=await openDatabase(config().database);
try {const actor={...await db.selectFrom('users').selectAll().executeTakeFirstOrThrow(),admin:1};
const r=await readAIDocument(db,{actor},${JSON.stringify(retained.resourceId)});
const state=await db.selectFrom('document_states').selectAll().where('resource_id','=',${JSON.stringify(retained.resourceId)}).executeTakeFirstOrThrow();
console.log(JSON.stringify({resourceId:r.resource.id,value:r.value,seq:r.seq,epochId:r.epochId,state}));} finally {await db.destroy();}`;
    assert.deepEqual(
      JSON.parse(
        await docker(
          "exec",
          name,
          "node",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          check,
        ),
      ),
      retained,
    );
  }
  const cookie = await login();
  assert.equal(
    (await request("/health", { headers: { host: "wrong.invalid" } })).status,
    421,
  );
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
  const create = await request("/api/v1/resources", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "document",
      format: "canvas",
      title: "Native image smoke",
    }),
  });
  assert.equal(create.status, 200, await create.clone().text());
  const runtime = JSON.parse(
    await docker(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      `
import fs from 'node:fs'; import {CanvasModel} from '@smartdoca/canvas/model';
const p=JSON.parse(fs.readFileSync('/app/package.json')); if(p.version!=='0.1.31'||p.dependencies['@smartdoca/canvas']!=='0.5.2')process.exit(1);
const m=CanvasModel.initialize(crypto.randomUUID(),{version:1,scene:{children:[]}});m.add({tag:'Text',text:'镜像原生模型'});if(!JSON.stringify(m.getValue()).includes('镜像原生模型'))process.exit(1);m.dispose();
console.log(JSON.stringify({version:p.version,canvas:p.dependencies['@smartdoca/canvas'],uid:process.getuid(),model:true}));`,
    ),
  );
  assert.equal(runtime.uid, 1000);
  await docker("restart", "--time", "20", name);
  base = "http://" + (await docker("port", name, "39120"));
  await ready("0.1.31");
  await login();
  await docker("stop", "--time", "20", name);
  assert.equal(
    await docker("inspect", "--format", "{{.State.ExitCode}}", name),
    "0",
  );
  const result = {
    arch,
    passed: true,
    health: true,
    hostValidation: true,
    compression: ["gzip", "br"],
    bootstrapLogin: true,
    restart: true,
    gracefulStop: true,
    runtime,
    releasedUpgrade: previous
      ? {
          from: "0.1.30",
          oldCanvas: "0.4.3",
          originalContentCheckpointEpochAndSequencePreserved: true,
        }
      : null,
  };
  await writeFile(
    resolve(output, `${arch}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(await docker("logs", "--tail", "40", name).catch(() => ""));
  throw error;
} finally {
  await docker("rm", "-f", name).catch(() => {});
  await docker("volume", "rm", volume).catch(() => {});
}
