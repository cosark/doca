// Exercise the retained rendering features in an isolated, non-root image.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const arch = process.argv[2];
assert(["amd64", "arm64"].includes(arch));
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const image = process.env.DOCA_RELEASE_QA_IMAGE ?? `smartdoca/doca:${version}-candidate`;
const code = `
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
import {renderDocumentPdf} from './apps/server/src/services/document-pdf.ts';
import {renderCanvas} from './apps/server/src/services/ai/canvas-render.ts';
import {officePdf} from './apps/server/src/services/ai/office-render.ts';
import {createExportFile} from './apps/server/src/services/ai/office-files.ts';
assert.equal(process.getuid(),1000);
const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.DOCA_PDF_CHROMIUM});
let sandboxStatus;
try {
  const page=await browser.newPage();
  await page.goto('chrome://sandbox');
  sandboxStatus=await page.locator('body').innerText();
  assert.match(sandboxStatus,/Layer 1 Sandbox\\s+Namespace/);
  assert.match(sandboxStatus,/PID namespaces\\s+Yes/);
  assert.match(sandboxStatus,/Network namespaces\\s+Yes/);
  assert.match(sandboxStatus,/Seccomp-BPF sandbox\\s+Yes/);
} finally {await browser.close();}
const pdf=await renderDocumentPdf('<h1>Release rendering 验证</h1><p>Isolated PDF output</p>',794);
assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert(pdf.length>1000);
const source={scene:{tag:'Leafer',children:[{id:'release-red',tag:'Rect',x:0,y:0,width:100,height:100,fill:'#ff0000'},{id:'release-blue',tag:'Rect',x:120,y:0,width:100,height:100,fill:'#0000ff'}]}};
const before=JSON.stringify(source);
const rendered=await renderCanvas({source,assets:{}});
assert.equal(JSON.stringify(source),before);assert(!rendered.empty);
const png=Buffer.from(rendered.png,'base64');
assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
function pixel(x,y){const px=Math.floor((x-rendered.sourceRect.x)*info.width/rendered.sourceRect.width),py=Math.floor((y-rendered.sourceRect.y)*info.height/rendered.sourceRect.height);return [...data.subarray((py*info.width+px)*3,(py*info.width+px)*3+3)];}
assert.deepEqual(pixel(50,50),[255,0,0]);assert.deepEqual(pixel(170,50),[0,0,255]);
const office={};
for(const [kind,extension,content] of [['word','docx','Release Office 验证'],['excel','xlsx','|Item|Value|\\n|---|---|\\n|Release|42|']]){
  const input=createExportFile(kind,{content});
  const output=await officePdf('release.'+extension,input.body);
  assert.equal(output.subarray(0,5).toString(),'%PDF-');assert(output.length>1000);
  office[extension]={bytes:output.length,sha256:createHash('sha256').update(output).digest('hex')};
}
console.log(JSON.stringify({passed:true,arch:process.arch,uid:process.getuid(),sandboxStatus,pdf:{bytes:pdf.length,sha256:createHash('sha256').update(pdf).digest('hex')},canvas:{width:rendered.width,height:rendered.height,sha256:createHash('sha256').update(png).digest('hex'),redAndBluePixels:true,sourceUnchanged:true},office,providerCalls:0,userDataUsed:false}));
`;
const { stdout } = await promisify(execFile)("docker", [
  "run", "--rm", "--pull", "never", "--platform", `linux/${arch}`,
  "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,size=1g",
  "--tmpfs", "/home/node:rw,uid=1000,gid=1000,size=256m",
  "--security-opt", `seccomp=${resolve("docker/chromium-seccomp.json")}`,
  "--shm-size", "1g", "--entrypoint", "node", image,
  "--import", "tsx", "--input-type=module", "-e", code,
], { timeout: 300_000, maxBuffer: 2_000_000 });
const result = JSON.parse(stdout.trim().split("\n").at(-1));
assert(result.passed && result.uid === 1000);
assert.equal(result.arch, arch === "amd64" ? "x64" : "arm64");
const output = resolve(`artifacts/verification/release-${version}`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, `render-${arch}.json`), JSON.stringify({ image, ...result }, null, 2) + "\n");
console.log(JSON.stringify({ image, ...result }));
