import { CanvasIOError, exportCanvasFile } from "@smartdoca/canvas/io";
import type { CanvasExportSource } from "@smartdoca/canvas/io";
// Vite bundles this font into the isolated renderer.
import fontUrl from "../../../web/src/features/documents/assets/NotoSansSC-Regular.woff2?inline";

type Rect = { x: number; y: number; width: number; height: number };
type RenderInput = {
  source: CanvasExportSource;
  elementIds?: string[];
  region?: Rect;
  assets: Record<string, { mime: string; data: string }>;
};

function bytes(base64: string) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function render(input: RenderInput) {
  const font = new FontFace("Doca Canvas CJK", `url(${fontUrl})`);
  (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(
    await font.load(),
  );
  // Native Arial/sans-serif text uses the bundled CJK font for missing glyphs.
  document.body.style.fontFamily = 'Arial, "Doca Canvas CJK", sans-serif';
  const result = await exportCanvasFile(input.source, {
    format: "svg",
    scale: 0.1,
    scope: input.elementIds ? "selection" : "all",
    elementIds: input.elementIds,
    background: "#ffffff",
    readAsset: async (path) => {
      const asset = Object.hasOwn(input.assets, path)
        ? input.assets[path]
        : undefined;
      if (!asset) throw new Error("canvas_asset_unavailable");
      return new Blob([bytes(asset.data)], { type: asset.mime });
    },
  }).catch((error) => {
    if (
      !input.elementIds &&
      error instanceof CanvasIOError &&
      ["EMPTY_CANVAS", "EMPTY_VISIBLE_CONTENT"].includes(error.code)
    )
      return null;
    throw error;
  });
  // Empty is a viewport fact, never a substitute for invalid or unsupported data.
  const svg = new DOMParser().parseFromString(
    result
      ? await result.blob.text()
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>',
    "image/svg+xml",
  ).documentElement;
  const [x, y, width, height] = svg
    .getAttribute("viewBox")!
    .split(/\s+/)
    .map(Number);
  const bounds = { x: x!, y: y!, width: width!, height: height! };
  const rect = input.region ?? bounds;
  const scale = Math.min(2, 1600 / Math.max(rect.width, rect.height));
  const outputWidth = Math.max(1, Math.round(rect.width * scale));
  const outputHeight = Math.max(1, Math.round(rect.height * scale));
  svg.setAttribute(
    "viewBox",
    `${rect.x} ${rect.y} ${rect.width} ${rect.height}`,
  );
  svg.setAttribute("width", String(outputWidth));
  svg.setAttribute("height", String(outputHeight));
  const fontStyle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "style",
  );
  fontStyle.textContent = `@font-face { font-family: "Doca Canvas CJK"; src: url(${fontUrl}); }`;
  svg.insertBefore(fontStyle, svg.firstChild);
  svg
    .querySelectorAll("text")
    .forEach((text) =>
      text.setAttribute(
        "font-family",
        `${text.getAttribute("font-family") || "Arial"}, "Doca Canvas CJK"`,
      ),
    );
  // A crop can extend beyond the content; keep its background white too.
  const background = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  for (const [key, value] of Object.entries(rect))
    background.setAttribute(key, String(value));
  background.setAttribute("fill", "#ffffff");
  svg.insertBefore(background, svg.firstChild);
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(image, 0, 0);
    return {
      png: canvas.toDataURL("image/png").split(",")[1]!,
      width: outputWidth,
      height: outputHeight,
      sourceRect: rect,
      bounds,
      warnings: result?.warnings ?? [],
      empty: result === null,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
