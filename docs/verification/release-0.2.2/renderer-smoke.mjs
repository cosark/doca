import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { stdout } = await promisify(execFile)("docker", [
  "run", "--rm", "--platform", "linux/arm64",
  "--security-opt", `seccomp=${resolve("docker/chromium-seccomp.json")}`,
  "--shm-size", "1g", "--entrypoint", "node", "smartdoca/doca:0.2.2-candidate",
  "--import", "tsx", "--input-type=module", "-e", `
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderDocumentPdf} from './apps/server/src/services/document-pdf.ts';
import {renderCanvas} from './apps/server/src/services/ai/canvas-render.ts';
const bytes=await renderDocumentPdf('<!doctype html><meta charset="utf-8"><h1>发布验证</h1><p>Canvas visual review</p>',800);
assert(bytes.subarray(0,4).equals(Buffer.from('%PDF')));
const source={version:1,scene:{children:[{id:'red',tag:'Rect',x:-100,y:0,width:100,height:100,fill:'#ff0000'},{id:'blue',tag:'Rect',x:20,y:0,width:100,height:100,fill:'#0000ff'},{id:'label',tag:'Text',x:-100,y:120,text:'画板视觉检查',fontSize:24,fill:'#111111'}]}};
const original=JSON.stringify(source);
const overview=await renderCanvas({source,assets:{}});
assert(Buffer.from(overview.png,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
assert(overview.width>0&&overview.width<=1600&&overview.height>0&&overview.height<=1600);
const selection=await renderCanvas({source,assets:{},elementIds:['blue']});
assert(selection.sourceRect.x>0);
const crop=await renderCanvas({source,assets:{},region:{x:-100,y:0,width:100,height:100}});
const stats=await sharp(Buffer.from(crop.png,'base64')).removeAlpha().stats();
assert(stats.channels[0].mean>254&&stats.channels[1].mean<1&&stats.channels[2].mean<1);
assert.equal(JSON.stringify(source),original);
console.log(JSON.stringify({sandbox:true,pdfBytes:bytes.length,canvas:{width:overview.width,height:overview.height,sourceRect:overview.sourceRect,warnings:overview.warnings,selection:true,regionPixels:true,sourceUnchanged:true,png:overview.png},passed:true}));
`,
], { maxBuffer: 20_000_000 });
const result = JSON.parse(stdout);
assert(result.passed && result.pdfBytes > 1000);
await mkdir("artifacts/release-0.2.2", { recursive: true });
await writeFile("artifacts/release-0.2.2/canvas-render.png", Buffer.from(result.canvas.png, "base64"));
delete result.canvas.png;
await writeFile("artifacts/release-0.2.2/renderer.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
