import sharp from "sharp";
import { expect, it } from "vitest";
import {
  captureImageInfo,
  prepareCaptureImage,
  readCaptureImageResponse,
  MAX_IMAGE_SOURCE_BYTES,
} from "../apps/browser-extension/image-processing.js";

it("reads static formats and display dimensions including EXIF rotation", async () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    const input = sharp({
      create: { width: 90, height: 60, channels: 4, background: "#3370ff80" },
    });
    const bytes = await input.toFormat(format).toBuffer();
    expect(captureImageInfo(bytes)).toEqual({
      width: 90,
      height: 60,
      mime: `image/${format}`,
      animated: false,
    });
    // Small images must preserve exact source bytes, metadata and alpha.
    expect(await prepareCaptureImage(bytes)).toBe(bytes);
  }
  const rotated = await sharp({
    create: { width: 90, height: 60, channels: 3, background: "red" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  expect(captureImageInfo(rotated)).toMatchObject({
    width: 60,
    height: 90,
    animated: false,
  });
});

it("preserves GIF without decoding and explicitly rejects oversized animations", async () => {
  const gif = await sharp({
    create: { width: 20, height: 10, channels: 4, background: "transparent" },
  })
    .gif()
    .toBuffer();
  expect(captureImageInfo(gif)).toEqual({
    width: 20,
    height: 10,
    mime: "image/gif",
    animated: true,
  });
  expect(await prepareCaptureImage(gif)).toBe(gif);
  const huge = Buffer.from(gif);
  huge.writeUInt16LE(6000, 6);
  huge.writeUInt16LE(5000, 8);
  await expect(prepareCaptureImage(huge)).rejects.toThrow(
    "clipper_animated_image_too_large",
  );
  const heavy = Buffer.alloc(20 * 1024 ** 2 + 1);
  gif.copy(heavy);
  await expect(prepareCaptureImage(heavy)).rejects.toThrow(
    "clipper_animated_image_too_large",
  );
});

it("recognizes animated PNG and WebP before deciding whether to compress", async () => {
  const png = await sharp({
    create: { width: 20, height: 10, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8);
  animation.write("acTL", 4);
  animation.writeUInt32BE(2, 8);
  const apng = Buffer.concat([
    png.subarray(0, 33),
    animation,
    png.subarray(33),
  ]);
  expect(captureImageInfo(apng).animated).toBe(true);
  expect(await prepareCaptureImage(apng)).toBe(apng);
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0);
  webp.writeUInt32LE(22, 4);
  webp.write("WEBPVP8X", 8);
  webp.writeUInt32LE(10, 16);
  webp[20] = 2;
  webp[24] = 19;
  webp[27] = 9;
  expect(captureImageInfo(webp)).toEqual({
    width: 20,
    height: 10,
    mime: "image/webp",
    animated: true,
  });
  expect(await prepareCaptureImage(webp)).toBe(webp);
});

it("rejects undecodable headers and excessive dimensions before pixel allocation", async () => {
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([0xff, 0xd8, 0, 0]),
    new Uint8Array(30),
  ])
    await expect(prepareCaptureImage(bytes)).rejects.toThrow(
      "clipper_image_invalid",
    );
  const png = await sharp({
    create: { width: 20, height: 10, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  png.writeUInt32BE(20000, 16);
  png.writeUInt32BE(20000, 20);
  await expect(prepareCaptureImage(png)).rejects.toThrow(
    "clipper_image_invalid",
  );
});

it("bounds streamed source bytes even when Content-Length is missing or misleading", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await readCaptureImageResponse(new Response(bytes))).toEqual(bytes);
  await expect(
    readCaptureImageResponse(
      new Response(null, {
        headers: { "content-length": String(MAX_IMAGE_SOURCE_BYTES + 1) },
      }),
    ),
  ).rejects.toThrow("clipper_image_invalid");
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_IMAGE_SOURCE_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readCaptureImageResponse(new Response(stream))).rejects.toThrow(
    "clipper_image_invalid",
  );
  expect(cancelled).toBe(true);
  await expect(
    readCaptureImageResponse(new Response(null, { status: 403 })),
  ).rejects.toThrow("clipper_image_failed");
});
