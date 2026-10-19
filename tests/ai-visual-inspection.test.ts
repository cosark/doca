import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { openTestDatabase } from "./database.js";
import { createUser } from "@core/modules/identity/passwords.js";
import { aiDefaults, saveAIConfig } from "@core/modules/ai/config.js";
import { inspectVisualImages } from "@server/services/ai/visual-inspection.js";
import { completionResponse } from "./ai-mock.js";

let db: Awaited<ReturnType<typeof openTestDatabase>>, userId: string;
const model = {
  id: "reader",
  vendorId: "vendor",
  model: "kimi-k3",
  alias: "Vision",
  enabled: true,
  vision: true,
  tools: true,
  maxInput: 64000,
  maxOutput: 16000,
};
beforeEach(async () => {
  db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
  userId = (
    await createUser(
      db,
      {
        login: "inspection",
        displayName: "Inspection",
        password: "isolated-inspection",
      },
      { bootstrap: true },
    )
  ).id;
  await saveAIConfig(
    db,
    {
      ...aiDefaults,
      defaultModel: model.id,
      mediaModel: model.id,
      vendors: [
        {
          id: "vendor",
          name: "Test",
          provider: "compatible",
          baseUrl: "https://vision.invalid/v1",
          apiKey: "isolated",
          enabled: true,
        },
      ],
      models: [model],
    },
    0,
  );
});
afterEach(async () => {
  await db.destroy();
});

it.each(["stop", "length", "empty", "revoked"])(
  "accepts only a completed authorized pixel response: %s",
  async (outcome) => {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    let revoked = false;
    const authorize = vi.fn(async () => {
      if (revoked) throw Error("access revoked");
    });
    const fetcher = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(String(init.body));
      expect(body.max_tokens).toBe(model.maxOutput);
      expect(body.reasoning_effort).toBe("low");
      const pixels = body.messages
        .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
        .filter((p: any) => p.type === "image_url");
      expect(pixels).toHaveLength(1);
      expect(pixels[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      if (outcome === "revoked") revoked = true;
      return completionResponse(
        {
          id: "inspection",
          object: "chat.completion",
          created: 1,
          model: "vision",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  outcome === "empty" ? "" : "左侧红色矩形，无文字溢出。",
              },
              finish_reason: outcome === "length" ? "length" : "stop",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 30,
            total_tokens: 130,
          },
        },
        !!body.stream,
      );
    });
    const call = inspectVisualImages(db, {
      userId,
      jobId: null,
      model: {
        ...model,
        baseUrl: "https://vision.invalid/v1",
        apiKey: "isolated",
      },
      request: "检查矩形",
      facts: { snapshotHash: "isolated" },
      images: [
        {
          data: png.toString("base64"),
          mime: "image/png",
          label: "画板保存快照",
        },
      ],
      signal: new AbortController().signal,
      fetch: fetcher as typeof fetch,
      authorize,
    });
    if (outcome === "stop") await expect(call).resolves.toContain("红色矩形");
    else
      await expect(call).rejects.toThrow(
        outcome === "revoked" ? "access revoked" : "图片查看未完成",
      );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
  },
);
