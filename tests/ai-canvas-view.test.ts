import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { build } from "vite";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { createContent } from "@core/workflows/resources.js";
import {
  readAIDocument,
  editAIDocument,
  digest,
} from "@core/workflows/ai-documents.js";
import { renderCanvas } from "@server/services/ai/canvas-render.js";
import {
  createCanvasView,
  canvasViewSchema,
} from "@server/services/ai/canvas-view.js";
import {
  bindToolImageFrames,
  hoistToolImages,
  transmittedToolImageFrames,
  type ToolImageSelection,
} from "@server/services/ai/tool-media.js";
import { modelPromptImages } from "@server/services/ai/model-image.js";
import { checkpointMessages } from "@server/services/ai/checkpoint.js";
import { aiDefaults, saveAIConfig } from "@core/modules/ai/config.js";
import { createApp } from "@server/app/create-app.js";
import { completionResponse } from "./ai-mock.js";
import {
  createStorage,
  storageConfigForProfile,
  storageRuntime,
} from "@server/adapters/storage.js";
import { objectKey } from "@server/services/storage-policy.js";

beforeAll(async () => {
  await build({
    configFile: "apps/server/canvas-render.vite.config.ts",
    logLevel: "silent",
  });
}, 30_000);
let db: Awaited<ReturnType<typeof openTestDatabase>>,
  ctx: any,
  resourceId: string;
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  ctx = {
    actor: {
      ...(await createUser(
        db,
        {
          login: "canvas-visual",
          displayName: "Canvas Visual",
          password: "isolated-canvas-visual",
        },
        { bootstrap: true },
      )),
      admin: 1,
    },
  };
  resourceId = (
    await createContent(db).create(ctx.actor, {
      kind: "document",
      format: "canvas",
      title: "Isolated visual board",
    })
  ).id;
  const initial = await readAIDocument(db, ctx, resourceId);
  await editAIDocument(
    db,
    ctx,
    resourceId,
    { seq: initial.seq, epochId: initial.epochId! },
    [
      {
        type: "add",
        element: {
          id: "group",
          tag: "Group",
          x: -200,
          y: 100,
          children: [
            {
              id: "red",
              tag: "Rect",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              fill: "#ff0000",
            },
            {
              id: "blue",
              tag: "Rect",
              x: 120,
              y: 0,
              width: 100,
              height: 100,
              fill: "#0000ff",
            },
            {
              id: "title",
              tag: "Text",
              x: 0,
              y: 120,
              text: "画板视觉验收",
              fontSize: 30,
              fill: "#111111",
            },
          ],
        },
      },
    ],
    randomUUID(),
  );
});
afterEach(async () => {
  await db.destroy();
});
const read = () => readAIDocument(db, ctx, resourceId);
const view = () => createCanvasView({ db, ctx, vision: true, read });

async function transport(output: any, capacity = 4) {
  const selected: ToolImageSelection[] = [];
  // Mastra converts media into current AI SDK file parts before metering.
  const sdkOutput = {
    ...output,
    value: output.value.map((part: any) =>
      part.type === "media"
        ? {
            type: "file",
            mediaType: part.mediaType,
            data: { type: "data", data: Buffer.from(part.data, "base64") },
          }
        : part,
    ),
  };
  const input = [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "canvas_view",
          toolCallId: "visual-test",
          output: sdkOutput,
        },
      ],
    },
  ];
  const prompt = await modelPromptImages(
    hoistToolImages(input, capacity, (frame) => selected.push(frame)),
  );
  return {
    prompt,
    frames: transmittedToolImageFrames(
      prompt,
      bindToolImageFrames(selected, prompt),
    ),
    input,
  };
}

it("renders native board pixels, negative world coordinates and selected children without writes", async () => {
  const before = await read();
  const source = before.value as any;
  const original = JSON.stringify(source);
  const rendered = await renderCanvas({ source, assets: {} });
  const { data, info } = await sharp(Buffer.from(rendered.png, "base64"))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const px = Math.floor(
      ((x - rendered.sourceRect.x) * info.width) / rendered.sourceRect.width,
    );
    const py = Math.floor(
      ((y - rendered.sourceRect.y) * info.height) / rendered.sourceRect.height,
    );
    return [
      ...data.subarray(
        (py * info.width + px) * 3,
        (py * info.width + px) * 3 + 3,
      ),
    ];
  };
  expect(pixel(-150, 150)).toEqual([255, 0, 0]);
  expect(pixel(-30, 150)).toEqual([0, 0, 255]);
  expect(rendered.sourceRect.x).toBeLessThan(-200);
  expect(rendered.warnings).toContainEqual(
    expect.objectContaining({ code: "FONT_NOT_EMBEDDED_SYSTEM_FALLBACK" }),
  );
  const selected = await renderCanvas({
    source,
    assets: {},
    elementIds: ["blue"],
  });
  expect(selected.sourceRect.x).toBeLessThan(-80);
  expect(selected.sourceRect.x).toBeGreaterThan(-100);
  const crop = await renderCanvas({
    source,
    assets: {},
    region: { x: -200, y: 100, width: 100, height: 100 },
  });
  expect(crop.sourceRect).toEqual({ x: -200, y: 100, width: 100, height: 100 });
  expect(
    (await sharp(Buffer.from(crop.png, "base64")).stats()).channels[0]!.mean,
  ).toBe(255);
  expect(JSON.stringify(source)).toBe(original);
  const after = await read();
  expect(after.seq).toBe(before.seq);
  expect(after.epochId).toBe(before.epochId);
  expect(after.value).toEqual(before.value);
}, 30_000);

it("requires the overview's exact pixels and same snapshot receipt to reach a successful model response", async () => {
  const session = view();
  const receipt: any = await session.tool.execute!({ resourceId }, {} as any);
  expect(JSON.stringify(receipt)).not.toContain("base64");
  const output: any = await session.tool.toModelOutput!(receipt);
  const lost = await transport(output, 0);
  expect(JSON.stringify(lost.prompt)).toContain("重新调用 canvas_view");
  session.observe(lost.frames).complete();
  expect(session.hasViewed(resourceId, receipt.snapshotHash)).toBe(false);
  const sent = await transport(output);
  expect(sent.frames).toHaveLength(1);
  const labels = sent.prompt.flatMap((message: any) =>
    message.role === "user"
      ? message.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
      : [],
  );
  expect(
    labels.some(
      (text: string) =>
        text.includes(resourceId) && text.includes(receipt.snapshotHash),
    ),
  ).toBe(true);
  const pending = session.observe(sent.frames);
  pending.abort();
  expect(session.hasViewed(resourceId, receipt.snapshotHash)).toBe(false);
  session.observe(sent.frames).complete();
  expect(session.hasViewed(resourceId, receipt.snapshotHash)).toBe(true);
  const snapshot = await read();
  expect(
    session.hasViewed(
      resourceId,
      digest({ value: snapshot.value, resource: snapshot.resource }),
    ),
  ).toBe(true);
  expect(session.hasViewed(resourceId, "other-snapshot")).toBe(false);
  expect(JSON.stringify(checkpointMessages(sent.input))).not.toContain(
    output.value[2].data,
  );
  const forged = await session.tool.toModelOutput!({
    ...receipt,
    seq: 999,
  } as any);
  expect((forged as any).value.error).toBe(true);
}, 30_000);

it("does not count local views as full visual acceptance and rejects nonvisual models and unauthorized reads", async () => {
  const session = view();
  const receipt: any = await session.tool.execute!(
    { resourceId, elementIds: ["red"] },
    {} as any,
  );
  const output = await session.tool.toModelOutput!(receipt);
  session.observe((await transport(output)).frames).complete();
  expect(session.hasViewed(resourceId, receipt.snapshotHash)).toBe(false);
  const noVision = createCanvasView({ db, ctx, vision: false, read });
  await expect(
    noVision.tool.execute!({ resourceId }, {} as any),
  ).rejects.toThrow("图片理解");
  const denied = createCanvasView({
    db,
    ctx: { ...ctx, allowedResources: [] },
    vision: true,
    read: (id) => readAIDocument(db, { ...ctx, allowedResources: [] }, id),
  });
  await expect(denied.tool.execute!({ resourceId }, {} as any)).rejects.toThrow(
    "授权范围",
  );
  expect(
    canvasViewSchema.safeParse({
      resourceId,
      elementIds: ["red"],
      region: { x: 0, y: 0, width: 100, height: 100 },
    }).success,
  ).toBe(false);
  const controller = new AbortController();
  controller.abort();
  await expect(
    renderCanvas(
      { source: (await read()).value as any, assets: {} },
      controller.signal,
    ),
  ).rejects.toThrow();
}, 30_000);

it("reports native export approximations instead of silently hiding visual differences", async () => {
  const snapshot = await read();
  const source: any = structuredClone(snapshot.value);
  source.scene.children[0].children[0].blur = 8;
  const result = await renderCanvas({ source, assets: {} });
  expect(result.warnings).toContainEqual(
    expect.objectContaining({
      code: "UNSUPPORTED_EFFECT_blur",
      elementId: "red",
    }),
  );
  await expect(
    renderCanvas({ source, assets: {}, elementIds: ["missing"] }),
  ).rejects.toThrow("SELECTION_NOT_FOUND");
}, 30_000);

it("renders an explicit empty viewport and embeds only authorized image assets", async () => {
  const empty = await renderCanvas({
    source: { scene: { tag: "Leafer", children: [] } },
    assets: {},
  });
  expect(empty.empty).toBe(true);
  expect(
    (await sharp(Buffer.from(empty.png, "base64")).stats()).channels.every(
      (channel) => channel.min === 255 && channel.max === 255,
    ),
  ).toBe(true);
  const profile = await db
    .selectFrom("storage_profiles")
    .selectAll()
    .where("active", "=", 1)
    .executeTakeFirstOrThrow();
  const assetId = randomUUID(),
    runtime = storageRuntime(),
    key = objectKey(assetId, "image/png");
  const data = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#8764c0" },
  })
    .png()
    .toBuffer();
  await createStorage(runtime).put(
    storageConfigForProfile(runtime, profile),
    key,
    data,
    "image/png",
    "fixture.png",
  );
  await db
    .insertInto("assets")
    .values({
      id: assetId,
      owner_id: ctx.actor.id,
      uploaded_by: ctx.actor.id,
      resource_id: resourceId,
      purpose: "attachment",
      profile_id: profile.id,
      object_key: key,
      filename: "fixture.png",
      mime: "image/png",
      size: data.length,
      created_at: new Date().toISOString(),
      deleted_at: null,
    })
    .execute();
  const snapshot = await read();
  await editAIDocument(
    db,
    ctx,
    resourceId,
    { seq: snapshot.seq, epochId: snapshot.epochId! },
    [
      {
        type: "add",
        element: {
          id: "photo",
          tag: "Image",
          x: 400,
          y: 0,
          width: 100,
          height: 100,
          data: { resourcePath: assetId },
        },
      },
    ],
    randomUUID(),
  );
  const session = view();
  const receipt = await session.tool.execute!(
    { resourceId, elementIds: ["photo"] },
    {} as any,
  );
  const output: any = await session.tool.toModelOutput!(receipt);
  const stats = await sharp(
    Buffer.from(output.value[2].data, "base64"),
  ).stats();
  expect(stats.channels[2]!.mean).toBeGreaterThan(stats.channels[0]!.mean);
  const frozen = await read();
  const frozenView = createCanvasView({ db, ctx, vision: true, read: async () => frozen });
  const other = await createUser(
    db,
    {
      login: "other-visual",
      displayName: "Other",
      password: "isolated-other-visual",
    },
    { actor: ctx.actor },
  );
  await db
    .updateTable("assets")
    .set({ owner_id: other.id, resource_id: null })
    .where("id", "=", assetId)
    .execute();
  await expect(
    frozenView.tool.execute!({ resourceId }, {} as any),
  ).rejects.toThrow("无权读取画板图片");
}, 30_000);

it("sends real canvas images to both agents and refuses review until the fixed snapshot was seen", async () => {
  await saveAIConfig(
    db,
    {
      ...aiDefaults,
      defaultModel: "visual-test",
      maxSteps: 12,
      vendors: [
        {
          id: "vendor",
          name: "Isolated",
          provider: "compatible",
          baseUrl: "https://model.example.test/v1",
          apiKey: "isolated-test-key",
          enabled: true,
        },
      ],
      models: [
        {
          id: "visual-test",
          vendorId: "vendor",
          model: "isolated",
          alias: "Visual",
          enabled: true,
          maxInput: 64000,
          maxOutput: 4000,
          tools: true,
          vision: true,
        },
      ],
    },
    0,
  );
  let executorStep = 0,
    reviewerStep = 0,
    executorSawImages = false,
    reviewerSawImages = false,
    reviewSeq = -1;
  const receipts = (body: any) =>
    body.messages
      .filter((message: any) => message.role === "tool")
      .map((message: any) => {
        const value = JSON.parse(message.content);
        return Array.isArray(value)
          ? JSON.parse(value.find((part) => part.type === "text").text)
          : value;
      });
  const hasPixels = (body: any) =>
    body.messages.some(
      (message: any) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content.some(
          (part: any) =>
            part.type === "image_url" &&
            part.image_url.url.startsWith("data:image/"),
        ),
    );
  const fetcher = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body));
    const review = body.tools.some(
      (tool: any) => tool.function?.name === "submit_review",
    );
    const results = receipts(body);
    let name: string | undefined,
      args: any,
      text = "已保存画板并检查画面。";
    if (!review) {
      const step = executorStep++;
      if (step === 0) {
        name = "document_read";
        args = { resourceId };
      } else if (step === 1) {
        name = "canvas_view";
        args = { resourceId };
      } else if (step === 2) {
        executorSawImages = hasPixels(body);
        const current = results.find((result: any) => result.resource);
        name = "canvas_edit";
        args = {
          resourceId,
          seq: current.seq,
          epochId: current.epochId,
          operations: [
            { type: "patch", id: "red", patch: { fill: "#00ff00" } },
          ],
        };
      } else if (step === 3) {
        name = "canvas_view";
        args = { resourceId };
      } else expect(hasPixels(body)).toBe(true);
    } else {
      const step = reviewerStep++;
      const submit = () => {
        name = "submit_review";
        args = {
          verdict: "pass",
          summary: "已核对保存内容和整板画面",
          checks: [
            {
              requirement: "绿色方块及完整布局",
              passed: true,
              evidence: "固定保存快照包含绿色方块，整板图片可见完整布局",
            },
          ],
        };
      };
      if (step === 0) {
        name = "document_read";
        args = { resourceId };
      } else if (step === 1) {
        reviewSeq = results.at(-1).seq;
        submit();
      } else if (step === 2) {
        expect(results.at(-1).error).toContain("尚未完成视觉验收");
        // A collaborator changes the live board after the reviewer froze its snapshot.
        const current = await read();
        await editAIDocument(
          db,
          ctx,
          resourceId,
          { seq: current.seq, epochId: current.epochId! },
          [{ type: "patch", id: "red", patch: { fill: "#ff00ff" } }],
          randomUUID(),
        );
        name = "canvas_view";
        args = { resourceId };
      } else if (step === 3) {
        reviewerSawImages = hasPixels(body);
        expect(results.at(-1).seq).toBe(reviewSeq);
        submit();
      } else {
        expect(results.at(-1).accepted).toBe(true);
        text = "验收完成。";
      }
    }
    return completionResponse(
      {
        id: `visual-${review}-${executorStep}-${reviewerStep}`,
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            message: name
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: `call-${review}-${executorStep}-${reviewerStep}`,
                      type: "function",
                      function: { name, arguments: JSON.stringify(args) },
                    },
                  ],
                }
              : { role: "assistant", content: text },
            finish_reason: name ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      },
      !!body.stream,
    );
  }) as typeof fetch;
  const origin = "http://localhost:39139";
  const app = await createApp(db, {
    origin,
    ai: { memory: { driver: "sqlite", url: ":memory:" }, fetch: fetcher },
  });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { host: "localhost:39139", origin },
      payload: { login: "canvas-visual", password: "isolated-canvas-visual" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const request = (method: any, url: string, payload?: any) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        headers: { host: "localhost:39139", origin, cookie },
        payload,
      });
    const sessionId = (
      await request("POST", "/ai/sessions", {
        modelId: "visual-test",
        resourceIds: [resourceId],
      })
    ).json().id;
    const jobId = randomUUID();
    const sent = await request("POST", `/ai/sessions/${sessionId}/messages`, {
      id: jobId,
      text: "把红色方块改成绿色并检查整板画面",
      modelId: "visual-test",
      scope: "document",
      currentResourceId: resourceId,
      references: [{ resourceId }],
    });
    expect(sent.statusCode).toBeLessThan(300);
    let job: any;
    for (let attempt = 0; attempt < 500; attempt++) {
      job = (await request("GET", `/ai/sessions/${sessionId}`))
        .json()
        .jobs.find((item: any) => item.id === jobId);
      if (job && !["queued", "running"].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(job.status, JSON.stringify(job)).toBe("completed");
    expect(executorSawImages).toBe(true);
    expect(reviewerSawImages).toBe(true);
    expect(reviewerStep).toBeGreaterThanOrEqual(4);
    expect((await read()).seq).toBeGreaterThan(reviewSeq);
  } finally {
    await app.close();
  }
}, 60_000);
