import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const arch = process.argv[2];
assert(["arm64", "amd64"].includes(arch));
const image = "smartdoca/doca:0.1.32-candidate";
const { stdout } = await promisify(execFile)("docker", [
  "run", "--rm", "--platform", `linux/${arch}`, "--entrypoint", "node", image,
  "--input-type=module", "-e", `
import fs from 'node:fs'; import path from 'node:path'; import {createHash} from 'node:crypto';
const files={};
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(e.name))files[p]=digest(p)}};
walk('apps/server');walk('packages');for(const p of ['package.json','tsconfig.json'])files[p]=digest(p);
const pkg=name=>JSON.parse(fs.readFileSync('node_modules/@smartdoca/'+name+'/package.json'));
console.log(JSON.stringify({files,canvas:pkg('canvas').version,slate:pkg('slate').version,canvasModel:digest('node_modules/@smartdoca/canvas/dist/model.js')}));
`,
], { maxBuffer: 10_000_000 });
const result = JSON.parse(stdout);
assert.equal(result.canvas, "0.5.4");
assert.equal(result.slate, "0.4.23");
const audit = JSON.parse(await readFile("docs/verification/release-0.1.32/package-audit.json", "utf8"));
assert.equal(result.canvasModel, audit.canvas054.modelSha256);
for (const [path, hash] of Object.entries(result.files)) {
  assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), hash, path);
}
assert(Object.keys(result.files).length > 400);
const output = resolve("artifacts/release-0.1.32");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, `runtime-${arch}.json`), JSON.stringify({ arch, passed: true, matchedSourceFiles: Object.keys(result.files).length, ...result }, null, 2) + "\n");
console.log(JSON.stringify({ arch, passed: true, matchedSourceFiles: Object.keys(result.files).length, canvas: result.canvas, slate: result.slate }));
