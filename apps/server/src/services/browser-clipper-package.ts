import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "login-bridge.js",
  "capture.js",
  "ui.html",
  "ui.js",
  "ui.css",
  "messages.js",
  "icon.svg",
  "icon.png",
] as const;

/** Immutable, complete code template. User secrets are added to this response only. */
export async function browserExtensionPackage() {
  const entries = await Promise.all(
    files.map(
      async (name) =>
        [
          name,
          new Uint8Array(
            await readFile(
              new URL(`../../../browser-extension/${name}`, import.meta.url),
            ),
          ),
        ] as const,
    ),
  );
  return (config: { origin: string } & Record<string, unknown>) => {
    const manifest = JSON.parse(
      new TextDecoder().decode(
        entries.find(([name]) => name === "manifest.json")![1],
      ),
    );
    // Automatic selection tools and original-image transfers require HTTP(S) site access.
    // Authentication and destinations remain restricted to the configured Doca origin.
    manifest.host_permissions = ["http://*/*", "https://*/*"];
    return Buffer.from(
      zipSync(
        {
          ...Object.fromEntries(
            entries.filter(([name]) => name !== "manifest.json"),
          ),
          "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
          "connection.json": strToU8(JSON.stringify(config)),
          "INSTALL.txt": strToU8(
            "Doca 浏览器助手\n解压后打开 chrome://extensions 或 edge://extensions，开启开发者模式，加载已解压的扩展程序。\n下载包仅包含Doca站点地址。使用时跟随当前浏览器的Doca登录状态；未登录时打开Doca登录页。\n",
          ),
        },
        { level: 6 },
      ),
    );
  };
}
