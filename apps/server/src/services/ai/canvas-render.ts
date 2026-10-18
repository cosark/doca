import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import type { CanvasExportSource } from "@smartdoca/canvas/io";
import { AppError, fail } from "@core/shared/errors.js";

export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type CanvasRenderInput = {
  source: CanvasExportSource;
  elementIds?: string[];
  region?: CanvasRect;
  assets: Record<string, { mime: string; data: string }>;
};
export type CanvasRenderResult = {
  png: string;
  width: number;
  height: number;
  sourceRect: CanvasRect;
  bounds: CanvasRect;
  empty: boolean;
  warnings: { code: string; message: string; elementId?: string }[];
};

let active = 0;
let bundle: Promise<string> | undefined;
async function rendererBundle() {
  bundle ??= readFile(
    new URL("../../../dist/canvas-render/renderer.js", import.meta.url),
    "utf8",
  ).catch(() => {
    bundle = undefined;
    fail(503, "画板渲染器尚未构建，请运行 pnpm build:canvas-render");
  });
  return bundle;
}

/** Isolated native export: no login, editor connection, filesystem or network in Chromium. */
export async function renderCanvas(
  input: CanvasRenderInput,
  signal?: AbortSignal,
): Promise<CanvasRenderResult> {
  signal?.throwIfAborted();
  if (active >= 2) fail(429, "canvas_render_busy");
  if (Buffer.byteLength(JSON.stringify(input)) > 48 * 1024 * 1024)
    fail(413, "canvas_render_too_large");
  active++;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = () => {
    void browser?.close();
  };
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, 45_000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const code = await rendererBundle();
    signal?.throwIfAborted();
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      ...(process.env.DOCA_PDF_CHROMIUM
        ? { executablePath: process.env.DOCA_PDF_CHROMIUM }
        : {}),
      timeout: 20_000,
    });
    signal?.throwIfAborted();
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1600, height: 1000 },
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.setContent(
      "<html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'\"></head><body></body></html>",
    );
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (input) => {
      const renderer = (
        window as unknown as {
          DocaCanvasRenderer: {
            render(input: CanvasRenderInput): Promise<CanvasRenderResult>;
          };
        }
      ).DocaCanvasRenderer;
      return renderer.render(input);
    }, input);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    if (timedOut) fail(504, "canvas_render_timeout");
    if (error instanceof AppError) throw error;
    if (
      error instanceof Error &&
      /Executable doesn't exist|executable.*not|Failed to launch/i.test(
        error.message,
      )
    )
      fail(503, "画板渲染需要 Chromium，可通过 DOCA_PDF_CHROMIUM 配置");
    throw new AppError(
      422,
      `画板渲染失败，尚未完成视觉检查：${error instanceof Error ? error.message.slice(0, 300) : "canvas_render_failed"}`,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    try {
      await browser?.close();
    } finally {
      active--;
    }
  }
}
