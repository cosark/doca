import { z } from "zod";
import { fail } from "@core/shared/errors.js";

const uuid = z.string().uuid();
export const webUrl = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
export const profileInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    isDefault: z.boolean(),
    strategy: z.enum(["create", "append"]),
    libraryId: uuid.nullable(),
    parentId: uuid.nullable(),
    targetId: uuid.nullable(),
    titleTemplate: z.string().trim().min(1).max(160),
    aiInstruction: z.string().max(4000),
  })
  .strict();
export const captureInput = z
  .object({
    version: z.literal(1),
    requestId: uuid,
    profileId: uuid,
    profileRevision: z.number().int().positive(),
    mode: z.enum(["selection", "page"]),
    url: webUrl,
    title: z.string().trim().min(1).max(160),
    capturedAt: z.iso.datetime(),
    markdown: z
      .string()
      .min(1)
      .max(512 * 1024),
    images: z
      .array(
        z
          .object({
            id: uuid,
            url: z.string().max(4096),
            name: z.string().min(1).max(240),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.images.map((image) => image.id)).size !==
      value.images.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate image ID" });
    if (Buffer.byteLength(value.markdown) > 512 * 1024)
      ctx.addIssue({ code: "custom", message: "Content too large" });
  });
export type CaptureInput = z.infer<typeof captureInput>;
export type StagedImage = {
  id: string;
  objectId: string;
  profileId: string;
  key: string;
  sha256: string;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  size: number;
  name: string;
  width: number;
  height: number;
};
export function parseClipper<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail(400, "clipper_invalid_input");
  return parsed.data;
}
