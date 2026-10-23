// Stage unchanged Web files in independently reusable COPY --link layers.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  readFileSync,
  linkSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

if (process.argv.length > 3)
  throw new Error("Usage: split-runtime-web.mjs [app-directory]");
const root = path.resolve(process.argv[2] ?? ".");
const source = path.join(root, "apps/web/dist");
const output = path.join(root, "artifacts/runtime-web-layers");
if (!existsSync(path.join(source, "index.html")))
  throw new Error("Build the Web app before staging runtime layers");
if (existsSync(output))
  throw new Error("Use a fresh runtime-web-layers directory");
const names = [
  "entry",
  "cad",
  "fonts",
  ...Array.from(
    { length: 16 },
    (_, i) => `code-${i.toString(16).padStart(2, "0")}`,
  ),
  ...Array.from(
    { length: 8 },
    (_, i) => `large-${i.toString(16).padStart(2, "0")}`,
  ),
];
const buckets = Object.fromEntries(
  names.map((name) => {
    mkdirSync(path.join(output, name), { recursive: true });
    return [name, { files: 0, bytes: 0, digest: createHash("sha256") }];
  }),
);
const directories = [];
function bucket(relative, size) {
  if (!relative.includes("/")) return "entry";
  if (relative.startsWith("cad/")) return "cad";
  if (/\.(?:woff2?|ttf|otf|ttc)(?:\.(?:br|gz))?$/i.test(relative))
    return "fonts";
  // Vite's final content hash changes URLs. Keep a renamed chunk and its
  // compressed companions in the same bucket as the preceding build.
  const identity = relative
    .replace(/\.(?:br|gz)$/, "")
    .replace(/-[A-Za-z0-9_-]{8}(\.[^.]+)$/, "$1");
  const original = path.join(source, relative.replace(/\.(?:br|gz)$/, ""));
  if (original !== path.join(source, relative) && existsSync(original))
    size = lstatSync(original).size;
  // Isolate large, often unchanged libraries from the many small chunks whose
  // imports are renamed together by a CSS or entry update.
  const large = size >= 512 * 1024;
  const number =
    createHash("sha256").update(identity).digest()[0] & (large ? 7 : 15);
  return `${large ? "large" : "code"}-${number.toString(16).padStart(2, "0")}`;
}
function walk(directory, relative = "") {
  directories.push({ relative, mode: lstatSync(directory).mode & 0o7777 });
  const entries = readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  if (!entries.length && relative) {
    const to = path.join(output, "entry", relative);
    mkdirSync(to, { recursive: true });
  }
  for (const entry of entries) {
    const from = path.join(directory, entry.name),
      name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      walk(from, name);
      continue;
    }
    if (!entry.isFile() || lstatSync(from).isSymbolicLink())
      throw new Error(`Unexpected Web build entry: ${name}`);
    const stat = lstatSync(from);
    const selected = bucket(name, stat.size),
      to = path.join(output, selected, name),
      record = buckets[selected];
    mkdirSync(path.dirname(to), { recursive: true });
    const hash = createHash("sha256").update(readFileSync(from)).digest("hex");
    linkSync(from, to);
    record.files++;
    record.bytes += stat.size;
    record.digest.update(`${name}\0${stat.mode}\0${hash}\n`);
  }
}
walk(source);
for (const name of names)
  for (const directory of directories) {
    const target = path.join(output, name, directory.relative);
    if (existsSync(target)) chmodSync(target, directory.mode);
  }
const report = Object.fromEntries(
  Object.entries(buckets).map(([name, { digest, ...counts }]) => [
    name,
    { ...counts, sha256: digest.digest("hex") },
  ]),
);
writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
