// Run after dependency installation and the Web build. The image executes JS
// and tsx; it does not typecheck dependencies or compile SQLite on startup.
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const apply = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((value) => value !== "--apply");
if (args.length > 1 || args.some((value) => value.startsWith("--")))
  throw new Error(
    "Usage: prune-runtime-build-inputs.mjs [--apply] [app-directory]",
  );
const root = path.resolve(args[0] ?? ".");
const modules = path.join(root, "node_modules");
const sqlite = realpathSync(path.join(modules, "better-sqlite3"));
const require = createRequire(path.join(root, "package.json"));
const Database = require("better-sqlite3");
const database = new Database(":memory:");
try {
  if (database.prepare("select 1 as ready").get().ready !== 1)
    throw new Error("SQLite binding did not execute its readiness query");
} finally {
  database.close();
}
const loadedBindings = Object.keys(require.cache).filter(
  (file) => file.startsWith(sqlite + path.sep) && file.endsWith(".node"),
);
if (loadedBindings.length !== 1 || !existsSync(loadedBindings[0]))
  throw new Error(
    "Cannot identify the installed SQLite binding; keep all build inputs",
  );
const activeBinding = realpathSync(loadedBindings[0]);

const candidates = [];
const retainedInodes = new Set();
const inodeSizes = new Map();
const counts = {
  declarations: 0,
  buildMetadata: 0,
  sqliteCompilerInputs: 0,
  foreignSqlitePrebuilds: 0,
};
function classify(file) {
  const relative = path.relative(sqlite, file);
  if (/^prebuilds\/[^/]+\.node$/.test(relative) && file !== activeBinding)
    return "foreignSqlitePrebuilds";
  // Retain executable code, native binaries, package manifests and notices.
  if (
    /^(?:licen[cs]e|notice|copyright|authors)(?:\..*)?$/i.test(
      path.basename(file),
    )
  )
    return;
  if (/\.d\.(?:ts|mts|cts)$/.test(file)) return "declarations";
  if (/\.(?:js|mjs|cjs|node|json|ts|tsx|mts|cts)$/.test(file)) return;
  if (file.endsWith(".tsbuildinfo")) return "buildMetadata";
  if (
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    /^(?:src\/|deps\/|build\/Release\/(?:obj(?:\.target)?|\.deps)\/)/.test(
      relative,
    )
  )
    return "sqliteCompilerInputs";
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!entry.isFile()) continue; // Never follow workspace/package symlinks.
    const stat = lstatSync(file),
      inode = `${stat.dev}:${stat.ino}`;
    inodeSizes.set(inode, stat.size);
    const category = classify(file);
    if (category) {
      candidates.push({ file, inode });
      counts[category]++;
    } else retainedInodes.add(inode);
  }
}
walk(modules);
const droppedInodes = new Set(candidates.map((value) => value.inode));
const uniqueFileBytes = [...droppedInodes].reduce(
  (total, inode) =>
    total + (retainedInodes.has(inode) ? 0 : inodeSizes.get(inode)),
  0,
);
if (apply) for (const { file } of candidates) unlinkSync(file);
console.log(
  JSON.stringify({
    applied: apply,
    files: candidates.length,
    uniqueFileBytes,
    counts,
    sqliteBinding: path.relative(root, activeBinding),
    preserves: [
      "runtime JS/TS sources",
      "active native bindings",
      "package manifests",
      "licenses/notices",
    ],
  }),
);
