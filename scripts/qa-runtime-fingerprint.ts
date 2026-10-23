import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const editorPackages = ["@smartdoca/canvas", "@smartdoca/sheet", "@smartdoca/slate", "@smartdoca/markdown", "@smartdoca/slides"];
const digest = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

/** Read every shipped file; nested dependency directories are audited separately
 * by the lockfile rather than counted as files shipped in an editor package. */
async function directoryFingerprint(directory: string, excludeNodeModules = false) {
  const hash = createHash("sha256");
  let files = 0, bytes = 0;
  const walk = async (relative = "") => {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excludeNodeModules && entry.name === "node_modules") continue;
      const file = join(relative, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const content = await readFile(join(directory, file));
        hash.update(file); hash.update(content); files++; bytes += content.length;
      } else throw new Error(`Unexpected non-regular entry in QA fingerprint: ${join(directory, file)}`);
    }
  };
  await walk();
  return { files, bytes, sha256: hash.digest("hex") };
}

export async function captureRuntimeFingerprint(builtWeb: boolean) {
  const pins = JSON.parse(await readFile("package.json", "utf8")).dependencies as Record<string, string>;
  const packages = Object.fromEntries(await Promise.all(editorPackages.map(async name => {
    const directory = resolve("node_modules", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const pin = pins[name];
    if (typeof pin !== "string") throw new Error(`Missing package pin in QA fingerprint: ${name}`);
    return [name, { version: manifest.version as string, pin, ...(pin.startsWith("file:") && pin.endsWith(".tgz") ? { archiveSha256: await digest(resolve(pin.slice(5))) } : {}), ...await directoryFingerprint(directory, true) }];
  })));
  return {
    packages,
    packageJsonSha256: await digest("package.json"),
    pnpmLockSha256: await digest("pnpm-lock.yaml"),
    ...(builtWeb ? { fullWeb: await directoryFingerprint(resolve("apps/web/dist")), builtIndexSha256: await digest("apps/web/dist/index.html") } : {}),
  };
}
