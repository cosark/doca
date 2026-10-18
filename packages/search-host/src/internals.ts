import type { SearchSourceDescriptor } from "./types.js";

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function copyDescriptor(
  descriptor: SearchSourceDescriptor,
): SearchSourceDescriptor {
  return {
    pluginId: descriptor.pluginId,
    sourceId: descriptor.sourceId,
    schemaVersion: descriptor.schemaVersion,
    renderer: { ...descriptor.renderer },
  };
}
