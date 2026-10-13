import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
export const payloadHash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pointer = z
  .object({ kind: z.enum(["data", "index"]), sha256: hash })
  .strict();
const indexSchema = z
  .object({
    type: z.literal("knowledge_book_payload_index"),
    version: z.literal(1),
    children: z.array(pointer).min(1).max(128),
  })
  .strict();
const rootSchema = z
  .object({
    type: z.literal("knowledge_book_payload_root"),
    version: z.literal(1),
    rawSha256: hash,
    rawSize: z.number().int().positive(),
    tree: pointer,
  })
  .strict();
export type PayloadKind = "data" | "index" | "root";
export type PayloadPointer = { kind: "data" | "index"; sha256: string };
export type EncodedObject = {
  kind: PayloadKind;
  sha256: string;
  bytes: Buffer;
  rawSize: number;
  storedSha256: string;
  children: PayloadPointer[];
};
export const payloadObjectLimit = 1024 * 1024;
/** Intern raw quoted tokens, preserving whitespace, escapes, field order and UTF-8 bytes. */
export function encodeBookPayload(raw: string) {
  JSON.parse(raw);
  const objects = new Map<string, EncodedObject>();
  const add = (
    kind: PayloadKind,
    body: Buffer,
    children: PayloadPointer[] = [],
  ) => {
    if (!body.length || body.length > payloadObjectLimit)
      throw new Error("Invalid payload chunk size");
    const sha256 = payloadHash(body),
      bytes = gzipSync(body);
    objects.set(`${kind}:${sha256}`, {
      kind,
      sha256,
      bytes,
      rawSize: body.length,
      storedSha256: payloadHash(bytes),
      children,
    });
    return { kind, sha256 } as PayloadPointer;
  };
  const pieces: PayloadPointer[] = [];
  const append = (text: string) => {
    const bytes = Buffer.from(text);
    for (let i = 0; i < bytes.length; i += payloadObjectLimit)
      pieces.push(add("data", bytes.subarray(i, i + payloadObjectLimit)));
  };
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '"') continue;
    const tokenStart = i++;
    while (i < raw.length) {
      if (raw[i] === "\\") i += 2;
      else if (raw[i++] === '"') break;
    }
    const token = raw.slice(tokenStart, i);
    if (Buffer.byteLength(token) >= 1024) {
      append(raw.slice(start, tokenStart));
      append(token);
      start = i;
    }
    i--;
  }
  append(raw.slice(start));
  let level = pieces;
  while (level.length > 1) {
    const next: PayloadPointer[] = [];
    for (let i = 0; i < level.length; i += 128) {
      const children = level.slice(i, i + 128);
      next.push(
        add(
          "index",
          Buffer.from(
            JSON.stringify({
              type: "knowledge_book_payload_index",
              version: 1,
              children,
            }),
          ),
          children,
        ),
      );
    }
    level = next;
  }
  const rawSha256 = payloadHash(raw),
    rawSize = Buffer.byteLength(raw);
  const tree = level[0]!;
  const root = add(
    "root",
    Buffer.from(
      JSON.stringify({
        type: "knowledge_book_payload_root",
        version: 1,
        rawSha256,
        rawSize,
        tree,
      }),
    ),
    [tree],
  );
  return {
    objects: [...objects.values()],
    rootSha256: root.sha256,
    rawSha256,
    rawSize,
  };
}
export function decodePayloadObject(
  bytes: Uint8Array,
  rawSize: number,
  sha256: string,
  storedSha256: string,
) {
  if (
    payloadHash(bytes) !== storedSha256 ||
    rawSize <= 0 ||
    rawSize > payloadObjectLimit
  )
    throw new Error("Invalid stored payload");
  const raw = gunzipSync(bytes, { maxOutputLength: payloadObjectLimit });
  if (raw.length !== rawSize || payloadHash(raw) !== sha256)
    throw new Error("Invalid raw payload");
  return raw;
}
export async function decodeBookPayload(
  rootSha256: string,
  rawSha256: string,
  rawSize: number,
  load: (kind: PayloadKind, sha256: string) => Promise<Buffer>,
) {
  const root = rootSchema.parse(
    JSON.parse((await load("root", rootSha256)).toString("utf8")),
  );
  if (root.rawSha256 !== rawSha256 || root.rawSize !== rawSize)
    throw new Error("Payload root mismatch");
  const parts: Buffer[] = [];
  let size = 0;
  const walk = async (p: PayloadPointer, depth: number) => {
    if (depth > 16) throw new Error("Payload index exceeds depth limit");
    const raw = await load(p.kind, p.sha256);
    if (p.kind === "data") {
      size += raw.length;
      if (size > rawSize) throw new Error("Payload exceeds recorded size");
      parts.push(raw);
    } else
      for (const child of indexSchema.parse(JSON.parse(raw.toString("utf8")))
        .children)
        await walk(child, depth + 1);
  };
  await walk(root.tree, 0);
  const raw = Buffer.concat(parts);
  if (raw.length !== rawSize || payloadHash(raw) !== rawSha256)
    throw new Error("Reconstructed payload mismatch");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  JSON.parse(text);
  return text;
}

export function payloadObjectChildren(
  kind: PayloadKind,
  raw: Buffer,
): PayloadPointer[] {
  if (kind === "data") return [];
  if (kind === "root")
    return [rootSchema.parse(JSON.parse(raw.toString("utf8"))).tree];
  return indexSchema.parse(JSON.parse(raw.toString("utf8"))).children;
}
