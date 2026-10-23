// Preserve the installed tree, but put independently updated editors in their
// own COPY --link layers. Install metadata changes must not invalidate common
// runtime dependencies. Nothing in the final module layout is rewritten.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  linkSync,
  symlinkSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const source = path.join(root, "node_modules");
const output = path.join(root, "artifacts/runtime-layers");
if (existsSync(output))
  throw new Error("Use a fresh runtime-layers output directory");
const editors = ["canvas", "markdown", "sheet", "slate", "slides"];
const storePattern =
  /(?:^|\/)@smartdoca\+(canvas|markdown|sheet|slate|slides)@/;
const buckets = Object.fromEntries(
  ["common", ...editors, "metadata"].map((name) => {
    mkdirSync(path.join(output, name, "node_modules"), { recursive: true });
    return [
      name,
      { files: 0, links: 0, bytes: 0, digest: createHash("sha256") },
    ];
  }),
);
for (const editor of editors) {
  const installed = realpathSync(path.join(source, "@smartdoca", editor));
  if (!installed.startsWith(path.join(source, ".pnpm") + path.sep))
    throw new Error(
      `Expected the installed pnpm package for @smartdoca/${editor}`,
    );
}
const metadata = new Set([
  ".modules.yaml",
  ".pnpm/lock.yaml",
  ".pnpm-workspace-state-v1.json",
  ".package-lock.json",
]);
const digestByInode = new Map();
let entries = 0;
function walk(directory, relative = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const from = path.join(directory, entry.name),
      name = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      walk(from, name);
      continue;
    }
    const target = entry.isSymbolicLink() ? readlinkSync(from) : undefined;
    const direct = name.match(
      /^@smartdoca\/(canvas|markdown|sheet|slate|slides)$/,
    )?.[1];
    const bucket = metadata.has(name)
      ? "metadata"
      : (direct ??
        name.match(storePattern)?.[1] ??
        target?.match(storePattern)?.[1] ??
        "common");
    const to = path.join(output, bucket, "node_modules", name),
      record = buckets[bucket];
    mkdirSync(path.dirname(to), { recursive: true });
    if (target !== undefined) {
      symlinkSync(target, to);
      record.links++;
      record.digest.update(`${name}\0link\0${target}\n`);
    } else if (entry.isFile()) {
      const stat = lstatSync(from),
        inode = `${stat.dev}:${stat.ino}`;
      let hash = digestByInode.get(inode);
      if (!hash) {
        hash = createHash("sha256").update(readFileSync(from)).digest("hex");
        digestByInode.set(inode, hash);
      }
      linkSync(from, to);
      record.files++;
      record.bytes += stat.size;
      record.digest.update(`${name}\0${stat.mode}\0${hash}\n`);
    } else throw new Error(`Unexpected runtime module entry: ${name}`);
    entries++;
  }
}
walk(source);
const report = {
  entries,
  buckets: Object.fromEntries(
    Object.entries(buckets).map(([name, { digest, ...counts }]) => [
      name,
      { ...counts, sha256: digest.digest("hex") },
    ]),
  ),
};
writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
