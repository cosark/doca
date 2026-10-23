import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "yjs",
      "@codemirror/state",
      "@codemirror/view",
    ],
    alias: {
      "@web": fileURLToPath(new URL("../web/src", import.meta.url)),
      "@core": fileURLToPath(
        new URL("../../packages/core/src", import.meta.url),
      ),
      "@db": fileURLToPath(new URL("../../packages/db/src", import.meta.url)),
      "@doca/i18n": fileURLToPath(
        new URL("../../packages/i18n/src/index.ts", import.meta.url),
      ),
      "@napi-rs/canvas": fileURLToPath(
        new URL("../web/src/shared/shims/napi-canvas.ts", import.meta.url),
      ),
      "@smartdoca/sheet/style.css": fileURLToPath(
        new URL(
          "../../node_modules/@smartdoca/sheet/dist/index.css",
          import.meta.url,
        ),
      ),
    },
  },
  build: {
    outDir: "generated",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(
        new URL(
          "../web/src/features/ai/browser-assistant-entry.tsx",
          import.meta.url,
        ),
      ),
      formats: ["es"],
      fileName: "assistant",
      cssFileName: "assistant",
    },
  },
});
