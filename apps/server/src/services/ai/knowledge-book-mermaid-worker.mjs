// Parse in an isolated worker. No diagram HTML scripts or subresources execute.
import { parentPort, workerData } from "node:worker_threads";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  const errors = [];
  for (const { id, code } of workerData) {
    try {
      await mermaid.parse(code);
    } catch (error) {
      errors.push({ id, error: String(error).slice(0, 2000) });
    }
  }
  parentPort.postMessage({ errors });
} finally {
  dom.window.close();
}
