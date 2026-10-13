import Sqlite from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { Pool } from "pg";
import { resolve } from "node:path";
import type { Schema } from "@db/index.js";
import { registerDriver } from "@db/transactions.js";
import { bindBookPayloadStore } from "@core/modules/knowledge-books/payload-storage.js";
import { createHostFileStore } from "../services/host-file-store.js";
import { storageRuntime } from "../adapters/storage.js";
import { convertBookStorage } from "../services/knowledge-book-storage-maintenance.js";
import { config } from "./config.js";
const [action, ...args] = process.argv.slice(2);
if (action !== "upgrade" && action !== "rollback")
  throw new Error(
    "Use knowledge-books:storage upgrade|rollback [--apply --hosts-stopped --manifest <file>]",
  );
const cfg = config().database;
function sqlite(path: string) {
  const database = new Sqlite(path, { fileMustExist: true });
  database.pragma("foreign_keys=ON");
  database.pragma("busy_timeout=5000");
  database.pragma("synchronous=FULL");
  return new SqliteDialect({ database });
}
// Dedicated maintenance connection: ordinary startup deliberately rejects these generations.
const db = new Kysely<Schema>({
  dialect:
    cfg.driver === "sqlite"
      ? sqlite(cfg.path)
      : new PostgresDialect({
          pool: new Pool({ connectionString: cfg.url, max: 1 }),
        }),
});
registerDriver(db, cfg.driver);
const unbind = bindBookPayloadStore(db, createHostFileStore(storageRuntime()));
try {
  const at = args.indexOf("--manifest");
  const manifestPath = at >= 0 ? args[at + 1] : undefined;
  if (manifestPath?.startsWith("--")) throw new Error("Invalid manifest path");
  const result = await convertBookStorage(db, action, {
    apply: args.includes("--apply"),
    hostsStopped: args.includes("--hosts-stopped"),
    manifestPath: manifestPath ? resolve(manifestPath) : undefined,
  });
  console.log(
    JSON.stringify({ action, ...result, entries: undefined }, null, 2),
  );
} finally {
  unbind();
  await db.destroy();
}
