export const MAX_IMAGE_SOURCE_BYTES = 64 * 1024 ** 2;
export const IMAGE_COMPRESSION_BYTES = 4 * 1024 ** 2;
const MAX_IMAGE_BYTES = 20 * 1024 ** 2;
const ORIGINAL_PIXELS = 25_000_000;
const TARGET_PIXELS = 16_000_000;
const invalid = () => {
  throw Error("clipper_image_invalid");
};

function orientation(view, offset, end) {
  if (offset + 8 > end) return 1;
  const little = view.getUint16(offset) === 0x4949;
  if (
    (!little && view.getUint16(offset) !== 0x4d4d) ||
    view.getUint16(offset + 2, little) !== 42
  )
    return 1;
  const ifd = offset + view.getUint32(offset + 4, little);
  if (ifd < offset || ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count && ifd + 2 + (i + 1) * 12 <= end; i++) {
    const entry = ifd + 2 + i * 12;
    if (
      view.getUint16(entry, little) === 0x112 &&
      view.getUint16(entry + 2, little) === 3 &&
      view.getUint32(entry + 4, little) === 1
    ) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Read dimensions/animation before allocating pixels. Never flatten animations. */
export function captureImageInfo(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = (at, length) =>
    String.fromCharCode(...data.subarray(at, at + length));
  let width,
    height,
    mime,
    animated = false,
    rotate = 1;
  if (
    data.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    text(12, 4) === "IHDR"
  ) {
    mime = "image/png";
    width = view.getUint32(16);
    height = view.getUint32(20);
    for (let at = 8; at + 12 <= data.length;) {
      const size = view.getUint32(at),
        kind = text(at + 4, 4),
        end = at + 12 + size;
      if (end > data.length) invalid();
      if (kind === "acTL") animated = true;
      if (kind === "eXIf") rotate = orientation(view, at + 8, end - 4);
      if (kind === "IDAT") break;
      at = end;
    }
  } else if (data.length >= 13 && ["GIF87a", "GIF89a"].includes(text(0, 6))) {
    mime = "image/gif";
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
    animated = true;
  } else if (
    data.length >= 12 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP"
  ) {
    mime = "image/webp";
    for (let at = 12; at + 8 <= data.length;) {
      const kind = text(at, 4),
        size = view.getUint32(at + 4, true),
        start = at + 8,
        end = start + size;
      if (end > data.length) invalid();
      if (kind === "VP8X" && size >= 10) {
        animated = !!(data[start] & 2);
        width =
          1 +
          data[start + 4] +
          (data[start + 5] << 8) +
          (data[start + 6] << 16);
        height =
          1 +
          data[start + 7] +
          (data[start + 8] << 8) +
          (data[start + 9] << 16);
      } else if (
        !width &&
        kind === "VP8L" &&
        size >= 5 &&
        data[start] === 0x2f
      ) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (
        !width &&
        kind === "VP8 " &&
        size >= 10 &&
        text(start + 3, 3) === "\x9d\x01\x2a"
      ) {
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      }
      if (kind === "ANIM" || kind === "ANMF") animated = true;
      if (kind === "EXIF")
        rotate = orientation(
          view,
          start + (text(start, 6) === "Exif\0\0" ? 6 : 0),
          end,
        );
      at = end + (size & 1);
    }
  } else if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    mime = "image/jpeg";
    for (let at = 2; at + 4 <= data.length;) {
      if (data[at++] !== 0xff) invalid();
      while (data[at] === 0xff) at++;
      const marker = data[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > data.length) invalid();
      const size = view.getUint16(at),
        end = at + size;
      if (size < 2 || end > data.length) invalid();
      if (marker === 0xe1 && size >= 8 && text(at + 2, 6) === "Exif\0\0")
        rotate = orientation(view, at + 8, end);
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        size >= 7
      ) {
        height = view.getUint16(at + 3);
        width = view.getUint16(at + 5);
      }
      at = end;
    }
  }
  if (!width || !height || !mime || !Number.isSafeInteger(width * height))
    invalid();
  return {
    width: rotate >= 5 ? height : width,
    height: rotate >= 5 ? width : height,
    mime,
    animated,
  };
}

export async function readCaptureImageResponse(response) {
  if (!response.ok) throw Error("clipper_image_failed");
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_SOURCE_BYTES)
    invalid();
  if (!response.body) invalid();
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_SOURCE_BYTES) {
        await reader.cancel();
        invalid();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  return data;
}

/** Approved new-image policy. Already uploaded images never enter this function. */
export async function prepareCaptureImage(data) {
  if (!data.length || data.length > MAX_IMAGE_SOURCE_BYTES) invalid();
  const info = captureImageInfo(data),
    pixels = info.width * info.height;
  if (info.animated) {
    if (data.length > MAX_IMAGE_BYTES || pixels > ORIGINAL_PIXELS)
      throw Error("clipper_animated_image_too_large");
    return data;
  }
  if (data.length <= IMAGE_COMPRESSION_BYTES && pixels <= ORIGINAL_PIXELS)
    return data;
  // Bound hostile image dimensions before invoking the browser decoder.
  if (pixels > 100_000_000) invalid();
  const scale = Math.min(
    1,
    4096 / Math.max(info.width, info.height),
    Math.sqrt(TARGET_PIXELS / pixels),
  );
  let width = Math.max(1, Math.floor(info.width * scale)),
    height = Math.max(1, Math.floor(info.height * scale));
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([data], { type: info.mime }), {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
      imageOrientation: "from-image",
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw Error("clipper_image_compression_failed");
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of info.mime === "image/png"
        ? [1]
        : [0.86, 0.76, 0.66]) {
        // Keep the source format and filename; PNG/WebP retain alpha.
        const blob = await canvas.convertToBlob({ type: info.mime, quality });
        if (blob.type !== info.mime)
          throw Error("clipper_image_compression_failed");
        if (blob.size && blob.size <= IMAGE_COMPRESSION_BYTES)
          return new Uint8Array(await blob.arrayBuffer());
      }
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
    throw Error("clipper_image_compression_failed");
  } catch (error) {
    throw Error(
      error.message === "clipper_image_invalid"
        ? error.message
        : "clipper_image_compression_failed",
    );
  } finally {
    bitmap?.close();
  }
}
