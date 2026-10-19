// Read-only confirmation that Docker Hub serves the two accepted image filesystems.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const tag = process.argv[2] ?? version;
assert(tag === version || tag === "latest");
const output = resolve(`docs/verification/release-${version}`);
const accepted = JSON.parse(
  await readFile(resolve(output, "image-build.json"), "utf8"),
);
const run = promisify(execFile);
const docker = async (...args) =>
  (await run("docker", args, { maxBuffer: 10_000_000 })).stdout;
const image = `smartdoca/doca:${tag}`;
const summary = await docker("buildx", "imagetools", "inspect", image);
const indexDigest = summary.match(/^Digest:\s+(sha256:[a-f0-9]{64})/m)?.[1];
assert.equal(
  indexDigest,
  accepted.indexDigest,
  "Published index differs from the accepted candidate",
);
const index = JSON.parse(
  await docker("buildx", "imagetools", "inspect", "--raw", image),
);
const platforms = [];
for (const arch of ["amd64", "arm64"]) {
  const manifest = index.manifests.find(
    (entry) =>
      entry.platform?.os === "linux" && entry.platform?.architecture === arch,
  );
  assert(manifest, `Missing Linux ${arch} image`);
  assert.equal(
    manifest.digest,
    accepted.images[arch].manifestDigest,
    `Published ${arch} manifest differs from the accepted image`,
  );
  const child = JSON.parse(
    await docker(
      "buildx",
      "imagetools",
      "inspect",
      "--raw",
      `smartdoca/doca@${manifest.digest}`,
    ),
  );
  assert.equal(
    child.config.digest,
    accepted.images[arch].configDigest,
    `Published ${arch} filesystem differs from the accepted image`,
  );
  platforms.push({
    os: "linux",
    arch,
    manifestDigest: manifest.digest,
    configDigest: child.config.digest,
  });
}
const report = { passed: true, image, indexDigest, platforms };
await writeFile(
  resolve(output, `registry-${tag}.json`),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
