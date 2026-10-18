import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Build the installed SDK once; production rendering never starts Vite or fetches code.
export default defineConfig({
  build: {
    outDir: fileURLToPath(new URL("./dist/canvas-render", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: Infinity,
    lib: {
      entry: fileURLToPath(
        new URL("./src/renderers/canvas.ts", import.meta.url),
      ),
      name: "DocaCanvasRenderer",
      formats: ["iife"],
      fileName: () => "renderer.js",
    },
  },
});
