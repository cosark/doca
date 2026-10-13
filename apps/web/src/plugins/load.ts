import { createWebHost, isolatePluginBundle } from "./web-host.js";
import { webPluginRegistry } from "./registry.js";
import { loadBootstrap } from "@web/shared/bootstrap.js";
import type { Bootstrap } from "@web/shared/api.js";

let loading: Promise<void> | undefined;
const registered = new Set<string>();

/** Browser plugins export default(host) and bundle their own dependencies except React.
 * React is explicitly injected, so dynamically installed packages cannot create a second renderer.
 */
export function loadWebPlugins(bootstrap?: Bootstrap): Promise<void> {
  if (!loading)
    loading = discover(bootstrap).finally(() => {
      loading = undefined;
    });
  return loading;
}
async function discover(current?: Bootstrap) {
  const bootstrap = current ?? (await loadBootstrap());
  const loaded = await Promise.all(
    (bootstrap.plugins ?? []).map(
      async (plugin: { id: string; version: string; web?: string }) => {
        if (!plugin.web) return;
        if (registered.has(`${plugin.id}:${plugin.version}`)) return;
        const expected = `/api/v1/plugin-assets/${plugin.id}/${plugin.version}/`;
        if (typeof plugin.web !== "string" || !plugin.web.startsWith(expected))
          return;
        try {
          const bundle = await bounded(
            (async () => {
              const module = await import(/* @vite-ignore */ plugin.web!);
              return module.default(createWebHost(plugin.id));
            })(),
          );
          if (
            bundle.manifest.pluginId !== plugin.id ||
            bundle.manifest.version !== plugin.version
          )
            throw new Error("Plugin client/server version mismatch");
          return bundle;
        } catch (error) {
          console.error(`Unable to load plugin ${plugin.id}`, error);
        }
      },
    ),
  );
  for (const bundle of loaded) {
    if (!bundle) continue;
    try {
      webPluginRegistry.register(isolatePluginBundle(bundle));
      registered.add(`${bundle.manifest.pluginId}:${bundle.manifest.version}`);
    } catch (error) {
      console.error(
        `Unable to register plugin ${bundle.manifest.pluginId}`,
        error,
      );
    }
  }
}
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Plugin load timed out")),
          10000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
