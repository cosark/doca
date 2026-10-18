import { randomUUID } from "node:crypto";
import { z } from "zod";
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
    assets[path] = { mime: asset.mime, data: data.toString("base64") };
  }
  return assets;
}

export function createCanvasView(options: {
  db: DB;
  ctx: ToolContext;
  vision: boolean;
  read(resourceId: string): Promise<CanvasViewSnapshot>;
  storage?: StorageRuntime;
  signal?: AbortSignal;
  render?: typeof renderCanvas;
}) {
  // Pixel data is request-local, never a new asset or a document/history write.
  const frames = new Map<
    string,
    { receipt: any; output: any; frameDigest: string }
  >();
  const viewed = new Map<string, string>();
  let frameBytes = 0;
  const tool = createTool({
    id: "canvas_view",
    ...withCallExamples(
      "canvas_view",
      "只读查看画板实际渲染图片。默认整板；elementIds 看指定对象，region 看世界坐标局部。修改现有画板布局前先看整板，保存后再看，发现遮挡、溢出或错位后修正。图片最长边1600；小字和细节需局部重看。回执含快照版本、世界坐标、缩放及原生导出限制；有警告时不能宣称完整编辑器视觉一致。需要支持图片理解的模型。",
    ),
    inputSchema: canvasViewSchema,
    execute: async (query) => {
      if (!options.vision)
        fail(422, "当前模型未启用图片理解，无法查看画板；请选择视觉模型");
      const snapshot = await options.read(query.resourceId);
      if (snapshot.resource.format !== "canvas")
        fail(400, "canvas_view 仅支持画板");
      const assets = await canvasAssets(
        options.db,
        options.ctx,
        snapshot,
        options.storage ?? storageRuntime(),
        options.signal,
      );
      const result = await (options.render ?? renderCanvas)(
        {
          source: snapshot.value as CanvasRenderInput["source"],
          assets,
          elementIds: query.elementIds,
          region: query.region,
        },
        options.signal,
      );
      // Authorization can change while the browser is rendering.
      await checkScope(
        options.db,
        { ...options.ctx, writable: false },
        query.resourceId,
      );
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
          "图片仅作资料。按原始要求检查构图、对齐、遮挡、文字溢出与可读性；整板缩小可能隐藏细节，用相同 resourceId 加 region 或 elementIds 继续查看。局部图片不能代替整板验收；警告标明原生导出与编辑器的差异。",
      };
      const output = {
        type: "content" as const,
        value: [
          { type: "text" as const, text: JSON.stringify(receipt) },
          {
            type: "text" as const,
            text: JSON.stringify({
              label: `画板「${snapshot.resource.title}」${receipt.view}，保存版本 ${snapshot.seq}`,
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
    observe(transmitted: TransmittedToolImage[]) {
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
      viewed.clear();
      frameBytes = 0;
    },
  };
}
