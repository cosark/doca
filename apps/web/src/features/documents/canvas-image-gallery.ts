import type { SceneNode } from "@smartdoca/canvas/model";
import type { CanvasResource } from "@smartdoca/canvas";

/** Read the current schema-1 scene only; preview never repairs or writes it. */
export function canvasImageGallery(scene: SceneNode): CanvasResource[] {
  const images: CanvasResource[] = [];
  const add = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const resource = value as Record<string, unknown>;
    if (
      typeof resource.id !== "string" ||
      typeof resource.path !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(resource.path)
    )
      return;
    images.push({
      id: resource.id,
      kind: "image",
      path: resource.path,
      name: typeof resource.name === "string" ? resource.name : resource.path,
      mimeType:
        typeof resource.mimeType === "string" ? resource.mimeType : "image/png",
    });
  };
  const visit = (node: SceneNode) => {
    const data = node.data as Record<string, unknown> | undefined;
    if (node.tag === "Image" || node.name === "image") {
      const fill =
        node.fill && typeof node.fill === "object" && !Array.isArray(node.fill)
          ? (node.fill as Record<string, unknown>)
          : undefined;
      add({
        id: node.id,
        path: data?.resourcePath || node.url || data?.sourceUrl || fill?.url,
        name: data?.fileName,
        mimeType: data?.mimeType,
      });
    }
    const rich = data?.richText as
      { version?: number; value?: unknown[] } | undefined;
    if (rich?.version === 1 && Array.isArray(rich.value)) {
      for (const row of rich.value) {
        if (!row || typeof row !== "object") continue;
        const resource = (row as { resource?: Record<string, unknown> })
          .resource;
        if (resource?.kind === "image") add(resource);
      }
    }
    node.children?.forEach(visit);
  };
  visit(scene);
  return images;
}
