import type { DB } from "@db/index.js";
import { bindBookPayloadStore } from "@core/modules/knowledge-books/payload-storage.js";
import { payloadHash } from "@core/modules/knowledge-books/payload-codec.js";
/** Explicit isolated storage adapter: never a production fallback. */
export function testBookPayloadStore(db: DB) {
  const objects = new Map<string, Uint8Array>();
  let reads = 0;
  const unbind = bindBookPayloadStore(db, {
    currentId: "test-book-store",
    async putImmutable(key, bytes) {
      const old = objects.get(key);
      if (old && payloadHash(old) !== payloadHash(bytes))
        throw new Error("Immutable test object collision");
      objects.set(key, Uint8Array.from(bytes));
      return {
        storeId: "test-book-store",
        key,
        size: bytes.length,
        sha256: payloadHash(bytes),
      };
    },
    async read(storeId, key, size, sha) {
      reads++;
      if (storeId !== "test-book-store") throw new Error("Unknown test store");
      const bytes = objects.get(key);
      if (!bytes || bytes.length !== size || payloadHash(bytes) !== sha)
        throw new Error("Missing/corrupt test object");
      return Uint8Array.from(bytes);
    },
    async remove(storeId, key) {
      if (storeId !== "test-book-store") throw new Error("Unknown test store");
      objects.delete(key);
    },
  });
  return {
    objects,
    unbind,
    get reads() {
      return reads;
    },
  };
}
