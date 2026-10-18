import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { stdout } = await promisify(execFile)("docker", [
  "run", "--rm", "--platform", "linux/arm64",
  "--security-opt", `seccomp=${resolve("docker/chromium-seccomp.json")}`,
  "--shm-size", "1g", "--entrypoint", "node", "smartdoca/doca:0.1.32-candidate",
  "--import", "tsx", "--input-type=module", "-e", `
import {renderDocumentPdf} from './apps/server/src/services/document-pdf.ts';
const bytes=await renderDocumentPdf('<!doctype html><meta charset="utf-8"><h1>发布验证</h1><p>Canvas 0.5.4 / Slate 0.4.23</p>',800);
if(!bytes.subarray(0,4).equals(Buffer.from('%PDF')))throw Error('Invalid PDF');
console.log(JSON.stringify({sandbox:true,pdfBytes:bytes.length,passed:true}));
`,
], { maxBuffer: 2_000_000 });
const result = JSON.parse(stdout);
assert(result.passed && result.pdfBytes > 1000);
await mkdir("artifacts/release-0.1.32", { recursive: true });
await writeFile("artifacts/release-0.1.32/renderer.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
