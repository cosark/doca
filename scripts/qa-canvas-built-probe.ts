import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext } from "playwright-core";

const installed = new WeakSet<BrowserContext>();

/** Read the public engine registry from the exact chunk already loaded by the
 * built app. No second engine, app mutation, or modified Web build is used. */
export async function installBuiltCanvasProbe(context: BrowserContext, route: string) {
  if (installed.has(context)) return;
  const matches = (await readdir(resolve("apps/web/dist/assets")))
    .filter(name => /^web\.esm\.min-[\w-]+\.js$/.test(name));
  assert.equal(matches.length, 1, "Expected one actual compiled Leafer engine chunk");
  const url = "/assets/" + matches[0];
  await context.route(route, request => request.fulfill({ contentType: "text/javascript", body: `
    import * as engine from ${JSON.stringify(url)};
    const candidates = Object.values(engine).filter(value => typeof value === 'function' && Array.isArray(value.list?.list));
    if (!candidates.length || new Set(candidates.map(value => value.list)).size !== 1)
      throw new Error('Compiled engine does not expose one unambiguous public registry');
    export const Leafer = candidates[0];
  ` }));
  installed.add(context);
  return url;
}
