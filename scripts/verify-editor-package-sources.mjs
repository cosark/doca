import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const editors = ["canvas", "markdown", "sheet", "slate", "slides"];

export function assertRegistryEditorSources(manifest, workspace) {
  const pins = {};
  for (const editor of editors) {
    const name = `@smartdoca/${editor}`;
    const pin = manifest.dependencies?.[name];
    if (
      typeof pin !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(pin)
    ) {
      throw new Error(
        `${name} must use an exact npm release before publication (found ${JSON.stringify(pin)})`,
      );
    }
    pins[name] = pin;
  }
  // pnpm records active patches beneath this top-level workspace key. Historical
  // patch files retained for recovery are not installed package modifications.
  const patches =
    workspace.match(
      /^patchedDependencies:\s*\n((?:^[ \t]+.*\n|^\s*\n)*)/m,
    )?.[1] ?? "";
  for (const editor of editors) {
    if (new RegExp(`^[ \\t]+["']?@smartdoca/${editor}@`, "m").test(patches)) {
      throw new Error(
        `@smartdoca/${editor} still has an active local patch; publish the fix upstream first`,
      );
    }
  }
  return pins;
}

export async function verifyRegistryEditorSources(root) {
  const [manifest, workspace] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "pnpm-workspace.yaml"), "utf8"),
  ]);
  return assertRegistryEditorSources(JSON.parse(manifest), workspace);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pins = await verifyRegistryEditorSources(root);
  console.log("Editor npm sources verified:", JSON.stringify(pins));
}
