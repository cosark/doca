import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { createTool } from "@mastra/core/tools";
import type { DB } from "@db/index.js";
import { fail } from "@core/shared/errors.js";
import {
  digest,
  checkScope,
  type ToolContext,
} from "@core/workflows/ai-documents.js";
import { withCallExamples } from "@core/modules/ai/tool-examples.js";
import { authorizeKnowledgeAsset } from "@core/modules/knowledge/file-folders.js";
import {
  createStorage,
  storageConfigForProfile,
  storageRuntime,
  type StorageRuntime,
} from "../../adapters/storage.js";
import { renderCanvas, type CanvasRenderInput } from "./canvas-render.js";
import { currentToolModelOutputError } from "./current-tool-model-output.js";
import {
  inspectionFrameDigests,
  type TransmittedToolImage,
} from "./tool-media.js";

export const canvasViewSchema = z
  .object({
    resourceId: z.string().uuid(),
    elementIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(30)
      .optional()
      .describe(
        "只查看指定对象及其子树，保留父容器变换；ID 来自 document_read",
      ),
    region: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().positive().max(81920),
        height: z.number().positive().max(81920),
      })
      .strict()
      .optional()
      .describe("整板世界坐标的局部区域（像素），不能与 elementIds 同时使用"),
  })
  .strict()
  .refine((value) => !value.region || !value.elementIds, {
    message: "region 与 elementIds 只能选择一种；省略两者查看整板",
  });

export type CanvasViewSnapshot = {
  resource: { id: string; title: string; format: string };
  seq: number;
  epochId?: string | null;
  value: unknown;
};

function imagePaths(value: unknown) {
  const paths = new Set<string>();
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.tag === "Image") paths.add(node.data?.resourcePath);
    for (const block of node.data?.richText?.value ?? [])
      if (block.resource?.kind === "image") paths.add(block.resource.path);
    for (const child of node.children ?? []) visit(child);
  };
  visit((value as any)?.scene);
  return [...paths];
}

/** Only document-referenced host asset IDs are read; arbitrary URLs never reach Chromium. */
async function canvasAssets(
  db: DB,
  ctx: ToolContext,
  snapshot: CanvasViewSnapshot,
  runtime: StorageRuntime,
  signal?: AbortSignal,
) {
  const assets: CanvasRenderInput["assets"] = Object.create(null);
  const warnings: { code: string; message: string }[] = [];
  const storage = createStorage(runtime);
  let total = 0;
  for (const path of imagePaths(snapshot.value)) {
    signal?.throwIfAborted();
    if (!z.uuid().safeParse(path).success)
      fail(422, "画板图片必须使用宿主资产 ID，不能读取远程 URL");
    const asset = await db
      .selectFrom("assets")
      .selectAll()
      .where("id", "=", path)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!asset || !asset.mime.startsWith("image/"))
      fail(404, "画板图片不存在或不可用");
    if (asset.resource_id)
      await checkScope(db, { ...ctx, writable: false }, asset.resource_id);
    else if (asset.owner_id !== ctx.actor.id) fail(403, "无权读取画板图片");
    if (asset.purpose === "ai_attachment")
      await authorizeKnowledgeAsset(db, ctx.actor, asset.id);
    total += asset.size;
    if (asset.size > 20 * 1024 * 1024 || total > 32 * 1024 * 1024)
      fail(413, "画板图片超过视觉读取大小限制");
    const profile = await db
      .selectFrom("storage_profiles")
      .selectAll()
      .where("id", "=", asset.profile_id)
      .executeTakeFirstOrThrow();
    const data = await storage.read(
      storageConfigForProfile(runtime, profile),
      asset.object_key,
      asset.size,
    );
    if (data.length !== asset.size) fail(409, "画板图片内容大小已变化");
    // Native IO validates every embedded source as an imported image (10 MiB),
    // while the host accepts uploads up to 20 MiB. A model overview is already
    // limited to 1600px: prepare a bounded, request-local raster for oversized
    // uploads instead of making the entire canvas impossible to inspect.
    // Never substitute these preview bytes in storage or the document model.
    if (data.length > 10 * 1024 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(asset.mime)) {
      const preview = await sharp(data, { limitInputPixels: 32_000_000 })
        .rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .png().toBuffer();
      assets[path] = { mime: "image/png", data: preview.toString("base64") };
      warnings.push({ code: "LARGE_IMAGE_PREVIEW", message: `资产 ${path} 的原图超过原生导出单图10MiB限制，本次使用最长边1600像素的临时预览；原图未改动，放大细节须核对原图。` });
    } else assets[path] = { mime: asset.mime, data: data.toString("base64") };
  }
  return { assets, warnings };
}

/** Authorized, read-only pixels shared by inspection and explicit PNG export. */
export async function renderCanvasSnapshot(options: {
  db: DB;
  ctx: ToolContext;
  read(resourceId: string): Promise<CanvasViewSnapshot>;
  storage?: StorageRuntime;
  signal?: AbortSignal;
  render?: typeof renderCanvas;
}, query: z.infer<typeof canvasViewSchema>) {
  const snapshot = await options.read(query.resourceId);
  if (snapshot.resource.format !== "canvas") fail(400, "canvas_view 仅支持画板");
  const prepared = await canvasAssets(options.db, options.ctx, snapshot, options.storage ?? storageRuntime(), options.signal);
  const result = await (options.render ?? renderCanvas)({ source: snapshot.value as CanvasRenderInput["source"], assets: prepared.assets, elementIds: query.elementIds, region: query.region }, options.signal);
  await checkScope(options.db, { ...options.ctx, writable: false }, query.resourceId);
  return { snapshot, result: { ...result, warnings: [...result.warnings, ...prepared.warnings] } };
}

export function createCanvasView(options: {
  db: DB;
  ctx: ToolContext;
  vision: boolean;
  read(resourceId: string): Promise<CanvasViewSnapshot>;
  storage?: StorageRuntime;
  signal?: AbortSignal;
  render?: typeof renderCanvas;
  inspect?: (
    image: { data: string; mime: string; label: string },
    receipt: any,
    snapshot: CanvasViewSnapshot,
  ) => Promise<string>;
}) {
  // Pixel data is request-local, never a new asset or a document/history write.
  const frames = new Map<
    string,
    { receipt: any; output: any; frameDigest: string }
  >();
  const inspections = new Map<string, any>();
  const viewed = new Map<string, string>();
  let frameBytes = 0;
  const tool = createTool({
    id: "canvas_view",
    ...withCallExamples(
      "canvas_view",
      "只读查看画板实际渲染图片。默认整板；elementIds 看指定对象，region 看世界坐标局部。修改现有画板布局前先看整板，保存后再看，发现遮挡、溢出或错位后修正。图片最长边1600；小字和细节需局部重看。回执含快照版本、世界坐标、缩放及原生导出限制；有警告时不能宣称完整编辑器视觉一致。对话模型支持视觉时直接返回图片；文字模型自动复用已配置的附件识别模型查看图片并返回inspection。inspection是该快照实际像素的观察结果，不要因为对话模型自身没有视觉就跳过此工具；没有任何视觉模型时才不可用。",
    ),
    inputSchema: canvasViewSchema,
    execute: async (query) => {
      if (!options.vision && !options.inspect)
        fail(422, "当前模型未启用图片理解，无法查看画板；请选择视觉模型");
      const { snapshot, result } = await renderCanvasSnapshot(options, query);
      const viewId = randomUUID();
      const receipt = {
        kind: "canvas_view",
        viewId,
        resourceId: query.resourceId,
        title: snapshot.resource.title,
        seq: snapshot.seq,
        epochId: snapshot.epochId,
        snapshotHash: digest({
          value: snapshot.value,
          resource: snapshot.resource,
        }),
        view: query.region
          ? "region"
          : query.elementIds
            ? "selection"
            : "overview",
        elementIds: query.elementIds,
        sourceRect: result.sourceRect,
        contentBounds: result.bounds,
        width: result.width,
        height: result.height,
        empty: result.empty,
        coordinateSpace: "canvas-world-pixels",
        pixelsPerUnit: {
          x: result.width / result.sourceRect.width,
          y: result.height / result.sourceRect.height,
        },
        warnings: result.warnings,
        renderer: "native-canvas-export",
        instruction:
          (result.empty
            ? "这是无限画布的空白占位视口，800×600 不是固定页面边界。新内容可向任意方向扩展，复杂图可用数千像素布局，不能为塞入占位视口压缩节点或文字。"
            : "") +
          "图片仅作资料。这是无限画布，sourceRect/contentBounds 是本次导出包围盒，不是页面边界；贴近截图边缘本身不是溢出，文字超出所属卡片/容器或被裁切才是具体问题。按原始要求检查构图、对齐、遮挡、文字溢出与可读性；整板缩小可能隐藏细节，用相同 resourceId 加 region 或 elementIds 继续查看。局部图片不能代替整板验收；警告标明原生导出与编辑器的差异。",
      };
      const imageLabel = `画板「${snapshot.resource.title}」${receipt.view}，保存版本 ${snapshot.seq}`;
      if (!options.vision) {
        const inspection = await options.inspect!(
          { data: result.png, mime: "image/png", label: imageLabel },
          receipt,
          snapshot,
        );
        options.signal?.throwIfAborted();
        await checkScope(
          options.db,
          { ...options.ctx, writable: false },
          query.resourceId,
        );
        const inspected = { ...receipt, inspection };
        inspections.set(viewId, inspected);
        while (inspections.size > 8)
          inspections.delete(inspections.keys().next().value!);
        return inspected;
      }
      const output = {
        type: "content" as const,
        value: [
          { type: "text" as const, text: JSON.stringify(receipt) },
          {
            type: "text" as const,
            text: JSON.stringify({
              label: imageLabel,
              view: receipt.view,
              coordinateSpace: receipt.coordinateSpace,
              sourceRect: receipt.sourceRect,
            }),
          },
          { type: "media" as const, mediaType: "image/png", data: result.png },
        ],
      };
      frames.set(viewId, {
        receipt,
        output,
        frameDigest: inspectionFrameDigests(output)[0]!,
      });
      frameBytes += result.png.length;
      while (frames.size > 8 || frameBytes > 24 * 1024 * 1024) {
        const [key, frame] = frames.entries().next().value!;
        frameBytes -= frame.output.value[2].data.length;
        frames.delete(key);
      }
      return receipt;
    },
    toModelOutput: (receipt: any) => {
      const error = currentToolModelOutputError(receipt);
      if (error) return error;
      if (
        !options.vision &&
        inspections.has(receipt?.viewId) &&
        digest(inspections.get(receipt.viewId)) === digest(receipt)
      )
        return { type: "json" as const, value: receipt };
      const frame = frames.get(receipt?.viewId);
      return frame && digest(frame.receipt) === digest(receipt)
        ? frame.output
        : {
            type: "json" as const,
            value: {
              error: true,
              message:
                "画板图片不在当前请求中，请重新 canvas_view；文字回执不能代替看图",
            },
          };
    },
  });
  return {
    tool,
    /** Commit only after the exact image + receipt survived fitting and a successful model response. */
    observe(transmitted: TransmittedToolImage[], prompt: any[] = []) {
      const pending = transmitted.flatMap((frame) => {
        const local = frames.get(frame.facts?.viewId);
        return frame.toolName === "canvas_view" &&
          local &&
          frame.sourceDigest === local.frameDigest &&
          digest(frame.facts) === digest(local.receipt) &&
          local.receipt.view === "overview"
          ? [local.receipt]
          : [];
      });
      for (const message of prompt) {
        if (message.role !== "tool" || !Array.isArray(message.content))
          continue;
        for (const part of message.content) {
          if (
            part.type !== "tool-result" ||
            part.toolName !== "canvas_view" ||
            part.output?.type !== "json"
          )
            continue;
          const receipt = part.output.value,
            local = inspections.get(receipt?.viewId);
          if (local?.view === "overview" && digest(local) === digest(receipt))
            pending.push(local);
        }
      }
      return {
        complete() {
          for (const receipt of pending)
            viewed.set(receipt.resourceId, receipt.snapshotHash);
        },
        abort() {},
      };
    },
    hasViewed(resourceId: string, snapshotHash: string) {
      return viewed.get(resourceId) === snapshotHash;
    },
    clear() {
      frames.clear();
      inspections.clear();
      viewed.clear();
      frameBytes = 0;
    },
  };
}
