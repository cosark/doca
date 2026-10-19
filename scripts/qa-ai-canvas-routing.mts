// Check current installed CanvasEditor through its public onReady/getValue API.
// All scenes are generated fixtures; no database or external AI model is accessed.
import assert from "node:assert/strict";
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import { JSDOM } from "jsdom";
import { CanvasModel } from "@smartdoca/canvas/model";
import {
  executeCanvasWorkflow,
  canvasSceneNodes,
} from "../packages/core/src/modules/ai/canvas-workflows.js";
const output = resolve(
  "artifacts/ai-canvas-debug-2026-10-19/native-route-parity",
);
await mkdir(output, { recursive: true });
await mkdir(resolve(".cache"), { recursive: true });
const dir = await mkdtemp(resolve(".cache/ai-canvas-routing-"));
const model = CanvasModel.initialize(randomUUID(), {
  version: 1,
  name: "Routing parity fixture",
  scene: { id: "scene", tag: "Group", children: [] },
});
let count = 0;
for (const offset of [undefined, 900, -200, 0])
  for (const sourcePort of ["top", "right", "bottom", "left"])
    for (const targetPort of ["top", "right", "bottom", "left"]) {
      const i = count++;
      executeCanvasWorkflow(model, {
        type: "createFlowchart",
        id: "g" + i,
        x: (i % 8) * 1500,
        y: Math.floor(i / 8) * 1200,
        nodes: [
          {
            id: "a" + i,
            text: "A",
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            shape: "rect",
          },
          {
            id: "b" + i,
            text: "B",
            x: 500,
            y: 200,
            width: 200,
            height: 100,
            shape: "rect",
          },
        ],
        edges: [
          {
            id: "e" + i,
            sourceId: "a" + i,
            targetId: "b" + i,
            sourcePort,
            targetPort,
            mode: "elbow",
            offset,
            label: "field_" + i,
            ...(i % 2 ? { labelOffset: { x: 11, y: -30 } } : {}),
          },
        ],
      });
    }
// Native UI also rebinds connector endpoints and labels when a node is resized.
for (let i = 0; i < count; i++)
  executeCanvasWorkflow(model, {
    type: "diagramNode",
    id: "a" + i,
    width: 240,
    height: 140,
  });
executeCanvasWorkflow(model, {
  type: "createFlowchart",
  id: "automatic",
  x: 0,
  y: 12000,
  nodes: [
    {
      id: "auto-a",
      text: "A",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      shape: "rect",
    },
    {
      id: "auto-b",
      text: "B",
      x: 500,
      y: 0,
      width: 200,
      height: 100,
      shape: "rect",
    },
    {
      id: "auto-obstacle",
      text: "Other table",
      x: 300,
      y: -50,
      width: 100,
      height: 200,
      shape: "rect",
    },
  ],
  edges: [
    {
      id: "auto-edge",
      sourceId: "auto-a",
      targetId: "auto-b",
      mode: "elbow",
      autoRoute: true,
      label: "project_id",
    },
  ],
});
executeCanvasWorkflow(model, {
  type: "diagramEdge",
  id: "auto-edge",
  autoRoute: true,
  autoLabel: true,
});
const value = model.getValue();
model.dispose();
const styled = canvasSceneNodes(value.scene).find((n) => n.id === "a0")!
  .children![1]!;
styled.text = "标题\n普通正文";
styled.data = {
  kind: "node-label",
  richText: {
    version: 1,
    value: [
      { type: "paragraph", children: [{ text: "标题", bold: true }] },
      { type: "paragraph", children: [{ text: "普通正文" }] },
    ],
  },
};
await writeFile(join(dir, "route-value.json"), JSON.stringify(value));
await writeFile(
  join(dir, "native-fixture.html"),
  '<html><body><div id="root"></div><script type="module" src="./native-fixture.tsx"></script></body></html>',
);
await writeFile(
  join(dir, "native-fixture.tsx"),
  `import React from 'react';import {createRoot} from 'react-dom/client';import {CanvasEditor} from '@smartdoca/canvas';import '@smartdoca/canvas/style.css';const value=await(await fetch('./route-value.json')).json();createRoot(document.getElementById('root')).render(<CanvasEditor defaultValue={value} autoSave={false} showHeader={false} style={{width:'100vw',height:'100vh'}} onReady={handle=>{window.__canvas=handle}}/>);`,
);
const web = await createServer({
  configFile: false,
  root: dir,
  plugins: [react()],
  optimizeDeps: { entries: [join(dir, "native-fixture.html")] },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.DOCA_QA_PORT ?? 39485),
    strictPort: true,
  },
});
await web.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${process.env.DOCA_QA_PORT ?? 39485}/native-fixture.html`,
  );
  await page.waitForFunction(() => !!window.__canvas);
  await page.waitForTimeout(2000);
  const actual = await page.evaluate(() => window.__canvas.getValue());
  const styledSvg = await page.evaluate(async (id) => {
    window.__canvas.select([id]);
    const result = await window.__canvas.exportFile({
      format: "svg",
      scope: "selection",
    });
    return result.blob.text();
  }, styled.id);
  await writeFile(join(output, "partial-bold.svg"), styledSvg);
  const spans = [
    ...new JSDOM(styledSvg, {
      contentType: "image/svg+xml",
    }).window.document.querySelectorAll("tspan"),
  ];
  assert.equal(
    spans
      .filter((span) => span.getAttribute("style")?.includes("font:700 "))
      .map((span) => span.textContent)
      .join(""),
    "标题",
  );
  assert.equal(
    spans
      .filter((span) => span.getAttribute("style")?.includes("font:normal "))
      .map((span) => span.textContent)
      .join(""),
    "普通正文",
  );
  await writeFile(join(output, "native.json"), JSON.stringify(actual, null, 2));
  const all = canvasSceneNodes(actual.scene);
  const mismatches = [];
  for (const expected of canvasSceneNodes(value.scene).filter((n) =>
    ["connector", "connector-label"].includes(n.data?.kind),
  )) {
    const current = all.find((n) => n.id === expected.id);
    for (const key of expected.data.kind === "connector"
      ? ["path"]
      : ["x", "y"])
      if (
        typeof expected[key] === "number"
          ? Math.abs(expected[key] - Number(current?.[key])) > 0.001
          : expected[key] !== current?.[key]
      )
        mismatches.push({
          id: expected.id,
          key,
          expected: expected[key],
          actual: current?.[key],
        });
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        cases: count,
        automaticObstacleCases: 1,
        partialTitleBold: true,
        errors,
        mismatches,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        cases: count,
        errors,
        mismatches: mismatches.slice(0, 3),
        mismatchCount: mismatches.length,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(mismatches, []);
  console.log("PASS native editor routing and label parity 64 cases");
} finally {
  await browser.close();
  await web.close();
  await rm(dir, { recursive: true, force: true });
}
