// Compare the actual Web build and OCI layers after a Vite-style chunk update.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.resolve(
  process.argv[2] ?? "artifacts/verification/runtime-web-layers",
);
if (existsSync(output))
  throw new Error("Use a fresh verification output directory");
mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function inventory(directory) {
  const files = {};
  function walk(dir, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : 1),
    )) {
      const source = path.join(dir, entry.name),
        relative = path.posix.join(prefix, entry.name),
        stat = lstatSync(source);
      if (entry.isDirectory()) {
        files[relative + "/"] = { mode: stat.mode & 0o7777 };
        walk(source, relative);
      } else {
        assert(entry.isFile());
        files[relative] = {
          mode: stat.mode & 0o7777,
          sha256: hash(readFileSync(source)),
        };
      }
    }
  }
  walk(directory);
  return files;
}
function compareStaged(source, staged) {
  const expected = inventory(source),
    actual = {},
    locations = {};
  for (const name of readdirSync(staged)
    .filter((name) => name !== "manifest.json")
    .sort()) {
    for (const [file, identity] of Object.entries(
      inventory(path.join(staged, name)),
    )) {
      if (file.endsWith("/")) {
        if (actual[file]) assert.deepEqual(actual[file], identity);
      } else {
        assert(!actual[file], `Duplicate staged Web file: ${file}`);
        locations[file] = name;
      }
      actual[file] = identity;
    }
  }
  assert.deepEqual(actual, expected);
  return {
    entries: Object.keys(actual).length,
    files: Object.keys(locations).length,
    locations,
  };
}
const variants = {};
let changedEntry, renamedEntry;
for (const variant of ["baseline", "changed"]) {
  const app = path.join(output, variant),
    web = path.join(app, "apps/web/dist");
  mkdirSync(path.dirname(web), { recursive: true });
  cpSync(path.join(root, "apps/web/dist"), web, { recursive: true });
  if (variant === "changed") {
    const indexPath = path.join(web, "index.html"),
      html = readFileSync(indexPath, "utf8");
    changedEntry = html.match(/<script[^>]+src="\/?(assets\/[^" ]+\.js)"/)?.[1];
    assert(changedEntry && /-[A-Za-z0-9_-]{8}\.js$/.test(changedEntry));
    renamedEntry = changedEntry.replace(
      /-[A-Za-z0-9_-]{8}\.js$/,
      "-LayerT01.js",
    );
    const original = readFileSync(path.join(web, changedEntry));
    unlinkSync(path.join(web, changedEntry));
    writeFileSync(
      path.join(web, renamedEntry),
      Buffer.concat([
        original,
        Buffer.from("\n// isolated layer reuse probe\n"),
      ]),
    );
    writeFileSync(indexPath, html.replace(changedEntry, renamedEntry));
  }
  const before = inventory(web);
  const stdout = execFileSync(
    process.execPath,
    [path.join(root, "docker/split-runtime-web.mjs"), app],
    { encoding: "utf8" },
  );
  writeFileSync(path.join(output, `${variant}-staging.json`), stdout);
  assert.deepEqual(inventory(web), before, "Staging mutated the Web build");
  const staged = path.join(app, "artifacts/runtime-web-layers");
  const compared = compareStaged(web, staged);
  variants[variant] = { app, staged, compared, buckets: JSON.parse(stdout) };
}
assert.equal(
  variants.baseline.compared.locations[changedEntry],
  variants.changed.compared.locations[renamedEntry],
);
const copyLines = readFileSync(path.join(root, "Dockerfile"), "utf8")
  .split("\n")
  .filter((line) =>
    line.startsWith(
      "COPY --link --from=build /app/artifacts/runtime-web-layers/",
    ),
  );
const names = copyLines.map((line) => {
  const matched = line.match(
    /^COPY --link --from=build \/app\/artifacts\/runtime-web-layers\/([^ ]+) \.\/apps\/web\/dist$/,
  );
  assert(matched, "Unexpected production Web COPY layout");
  return matched[1];
});
assert.deepEqual(
  [...names].sort(),
  Object.keys(variants.baseline.buckets).sort(),
  "Production Dockerfile must copy every Web bucket exactly once",
);
const dockerfile = path.join(output, "Dockerfile");
writeFileSync(
  dockerfile,
  "FROM scratch\n" +
    names.map((name) => `COPY --link ${name}/ /app/apps/web/dist/\n`).join(""),
);
for (const variant of ["baseline", "changed"]) {
  const archive = path.join(output, `${variant}.oci.tar`),
    log = path.join(output, `${variant}-build.log`);
  const result = spawnSync(
    "docker",
    [
      "buildx",
      "build",
      "--progress=plain",
      "--provenance=false",
      "--sbom=false",
      "--platform=linux/arm64",
      "--file",
      dockerfile,
      "--output",
      `type=oci,dest=${archive}`,
      variants[variant].staged,
    ],
    {
      encoding: "utf8",
      maxBuffer: 8_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  writeFileSync(log, String(result.stdout ?? "") + String(result.stderr ?? ""));
  assert.equal(result.status, 0, String(result.error ?? result.stderr));
  const unpacked = path.join(output, `${variant}-oci`);
  mkdirSync(unpacked);
  execFileSync("tar", ["-xf", archive, "-C", unpacked]);
  const index = JSON.parse(
    readFileSync(path.join(unpacked, "index.json"), "utf8"),
  );
  function blob(digest) {
    const bytes = readFileSync(
      path.join(unpacked, "blobs/sha256", digest.split(":")[1]),
    );
    assert.equal("sha256:" + hash(bytes), digest);
    return bytes;
  }
  assert.equal(index.manifests.length, 1);
  const manifest = JSON.parse(blob(index.manifests[0].digest));
  blob(manifest.config.digest);
  for (const layer of manifest.layers)
    assert.equal(blob(layer.digest).length, layer.size);
  assert.equal(manifest.layers.length, names.length);
  variants[variant].manifest = manifest;
}
const baseline = variants.baseline.manifest,
  changed = variants.changed.manifest;
const reused = [],
  downloaded = [];
for (let i = 0; i < names.length; i++) {
  const item = { bucket: names[i], compressedBytes: changed.layers[i].size };
  (baseline.layers[i].digest === changed.layers[i].digest
    ? reused
    : downloaded
  ).push(item);
}
assert.deepEqual(
  downloaded.map((item) => item.bucket).sort(),
  ["entry", variants.changed.compared.locations[renamedEntry]].sort(),
);
const report = {
  passed: true,
  scope:
    "Actual compiled Web; one entry chunk renamed/updated and index rewritten in isolated copies",
  originalFilesPreserved: variants.baseline.compared.files,
  originalEntriesPreserved: variants.baseline.compared.entries,
  changedEntry,
  renamedEntry,
  layers: names.length,
  reusedLayers: reused.length,
  baselineCompressedBytes: baseline.layers.reduce(
    (sum, layer) => sum + layer.size,
    0,
  ),
  changedCompressedBytes: changed.layers.reduce(
    (sum, layer) => sum + layer.size,
    0,
  ),
  newlyDownloadedLayerBytes: downloaded.reduce(
    (sum, item) => sum + item.compressedBytes,
    0,
  ),
  reused,
  downloaded,
};
writeFileSync(
  path.join(output, "results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
