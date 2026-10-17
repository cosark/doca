import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import { normalizedImagePointSchema, emptyEditRegionsSchema } from "../apps/server/src/services/ai/image-edit-regions.js";
import { imageEditMaskInputSchema } from "../apps/server/src/services/ai/image-edit-mask.js";
import { imageMaskRefineInputSchema } from "../apps/server/src/services/ai/image-mask-refine.js";
import {
  imageGenerateInputSchema,
  imageReferenceInputSchema,
  imageEditInputSchema,
  normalizeImageEditInput,
} from "../apps/server/src/services/ai/image-tool-schemas.js";

it("publishes equivalent object-item array schemas without weakening exact coordinate or empty-tuple validation", () => {
  expect(normalizedImagePointSchema.safeParse([0, 1]).success).toBe(true);
  for (const value of [[0], [0, 1, 1], [-1, 0], [0, 2]])
    expect(normalizedImagePointSchema.safeParse(value).success).toBe(false);
  expect(emptyEditRegionsSchema.safeParse([]).success).toBe(true);
  expect(emptyEditRegionsSchema.safeParse([{}]).success).toBe(false);
  const walk = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) expect(Array.isArray(value.items)).toBe(false);
    for (const child of Object.values(value)) walk(child);
  };
  for (const schema of [normalizedImagePointSchema, emptyEditRegionsSchema, imageEditMaskInputSchema, imageMaskRefineInputSchema])
    walk(z.toJSONSchema(schema));
});

it("text generation refuses image inputs and reference generation requires references", () => {
  const input = { prompt: "生成一个新场景" };
  expect(imageGenerateInputSchema.safeParse(input).success).toBe(true);
  expect(
    imageGenerateInputSchema.safeParse({
      ...input,
      referenceImageIds: [randomUUID()],
    }).success,
  ).toBe(false);
  expect(imageReferenceInputSchema.safeParse(input).success).toBe(false);
  expect(
    imageReferenceInputSchema.safeParse({
      ...input,
      referenceImageIds: [randomUUID()],
    }).success,
  ).toBe(true);
});

it("editing requires a distinct source and keeps reference ordering", () => {
  const sourceImageId = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  expect(
    imageEditInputSchema.safeParse({
      prompt: "替换人物",
      referenceImageIds: [first],
    }).success,
  ).toBe(false);
  expect(
    imageEditInputSchema.safeParse({
      prompt: "替换人物",
      sourceImageId,
      referenceImageIds: [sourceImageId],
    }).success,
  ).toBe(false);
  const parsed = imageEditInputSchema.parse({
    prompt: "替换人物",
    sourceImageId,
    referenceImageIds: [first, second],
  });
  expect(normalizeImageEditInput(parsed)).toEqual({
    prompt: "替换人物",
    referenceImageIds: [sourceImageId, first, second],
  });
  expect(
    normalizeImageEditInput(
      imageEditInputSchema.parse({ prompt: "修改背景", sourceImageId }),
    ).referenceImageIds,
  ).toEqual([sourceImageId]);
});
