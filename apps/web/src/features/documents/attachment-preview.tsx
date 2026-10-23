import { useCallback, useRef, useState } from "react";
import type { CanvasImageResource, CanvasResource } from "@smartdoca/canvas";
import type { CanvasEditorProps } from "@smartdoca/canvas";
import type { RichTextEditorProps } from "@smartdoca/slate";
import type {
  SpreadsheetAttachmentPreviewHandler,
  SpreadsheetImagePreviewHandler,
  SpreadsheetImageGalleryItem,
} from "@smartdoca/sheet";
import type { MarkdownImagePreviewEvent } from "@smartdoca/markdown";
import type { PresentationImagePreviewHandler } from "@smartdoca/slides";
import { assetUrl } from "@web/shared/api.js";
import { platformAssetId } from "@web/shared/utils/asset-path.js";
import {
  DocumentImagePreview,
  type DocumentImageSource,
} from "./document-image-preview.js";
import {
  DocumentFilePreview,
  guessMime,
  type PreviewSource,
} from "./document-file-preview.js";

export function useAttachmentPreview({
  trash = false,
  audit = false,
  imageResources,
  sheetImages,
}: {
  trash?: boolean;
  audit?: boolean;
  imageResources?: () => readonly CanvasResource[];
  sheetImages?: () => readonly SpreadsheetImageGalleryItem[];
} = {}) {
  const [file, previewFile] = useState<PreviewSource | null>(null);
  const [image, previewImage] = useState<{
    items: readonly DocumentImageSource[];
    index: number;
    key: number;
  } | null>(null);
  const imageSequence = useRef(0);
  const openImagePreview = useCallback(
    (items: readonly DocumentImageSource[], index: number) => {
      if (!items[index]) return;
      previewFile(null);
      previewImage({ items, index, key: ++imageSequence.current });
    },
    [],
  );
  const getImages = useRef(imageResources);
  getImages.current = imageResources;
  const getSheetImages = useRef(sheetImages);
  getSheetImages.current = sheetImages;
  const imageSource = useCallback(
    (resource: CanvasImageResource): PreviewSource => ({
      url:
        assetUrl(resource.path) +
        (audit ? "?audit=1" : trash ? "?trashPreview=1" : ""),
      name: resource.name ?? resource.path,
      mime: resource.mimeType || "image/png",
    }),
    [audit, trash],
  );
  const open = useCallback(
    (id: string | undefined, name: string, mime?: string) => {
      if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return;
      previewImage(null);
      previewFile({
        url:
          assetUrl(id) + (audit ? "?audit=1" : trash ? "?trashPreview=1" : ""),
        name,
        mime: guessMime(name, mime),
      });
    },
    [audit, trash],
  );
  const onRichAttachmentPreview = useCallback<
    NonNullable<RichTextEditorProps["onAttachmentPreview"]>
  >(
    (attachment) => open(attachment.path, attachment.name, attachment.mimeType),
    [open],
  );
  const onRichMediaPreview = useCallback<
    NonNullable<RichTextEditorProps["onMediaPreview"]>
  >(
    (event) => {
      const items = event.items.map((item): DocumentImageSource => {
        if (item.type === "image") {
          const resource = imageSource({
            path: item.path ?? "",
            name: item.name,
          });
          return {
            id: item.id,
            name: item.name,
            mime: guessMime(item.name),
            downloadUrl:
              resource.url +
              (resource.url.includes("?") ? "&" : "?") +
              "download=1",
            resolveUrl: async () => {
              if (!item.path || !/^[a-f0-9-]{36}$/i.test(item.path))
                throw new Error("IMAGE_PREVIEW_DENIED");
              return item.resolveUrl();
            },
          };
        }
        return {
          id: item.id,
          name: /\.svg$/i.test(item.name) ? item.name : `${item.name}.svg`,
          mime: "image/svg+xml",
          resolveUrl: async () => {
            const url = await item.resolveUrl();
            if (!/^data:image\/svg\+xml[;,]/i.test(url))
              throw new Error("DIAGRAM_PREVIEW_UNAVAILABLE");
            return url;
          },
        };
      });
      openImagePreview(items, event.index);
    },
    [imageSource, openImagePreview],
  );
  const onSheetAttachmentPreview =
    useCallback<SpreadsheetAttachmentPreviewHandler>(
      ({ node }) => open(node.refId, node.label),
      [open],
    );
  const onSheetImagePreview = useCallback<SpreadsheetImagePreviewHandler>(
    (event) => {
      const gallery = getSheetImages.current?.() ?? [];
      const index = gallery.findIndex(
        (item) =>
          item.drawingId === event.drawingId &&
          item.sheetId === event.cell.sheetId &&
          item.cell?.startRow === event.cell.row &&
          item.cell.startColumn === event.cell.column,
      );
      if (index < 0) throw new Error("IMAGE_GALLERY_UNAVAILABLE");
      const items = gallery.map((item): DocumentImageSource => {
        const resource = imageSource({
          path: item.resource.id,
          name: item.resource.name,
        });
        return {
          id: `${item.sheetId}:${item.drawingId}:${item.cell?.startRow}:${item.cell?.startColumn}`,
          name: resource.name,
          mime: guessMime(resource.name),
          downloadUrl:
            resource.url +
            (resource.url.includes("?") ? "&" : "?") +
            "download=1",
          resolveUrl: () => {
            if (!/^[a-f0-9-]{36}$/i.test(item.resource.id))
              throw new Error("IMAGE_PREVIEW_DENIED");
            return resource.url;
          },
        };
      });
      openImagePreview(items, index);
    },
    [imageSource, openImagePreview],
  );
  const onSlidesImagePreview = useCallback<PresentationImagePreviewHandler>(
    (event) => {
      const index = event.gallery.findIndex(
        (item) => item.id === event.currentId,
      );
      if (index < 0) return;
      const items = event.gallery.map((item): DocumentImageSource => {
        const resource = imageSource({
          path: item.assetId,
          name: item.alt || item.assetId,
        });
        return {
          id: item.id,
          name: resource.name,
          mime: guessMime(resource.name),
          downloadUrl:
            resource.url +
            (resource.url.includes("?") ? "&" : "?") +
            "download=1",
          resolveUrl: () => {
            if (!/^[a-f0-9-]{36}$/i.test(item.assetId))
              throw new Error("IMAGE_PREVIEW_DENIED");
            return resource.url;
          },
        };
      });
      openImagePreview(items, index);
    },
    [imageSource, openImagePreview],
  );
  const onMarkdownImagePreview = useCallback(
    (event: MarkdownImagePreviewEvent) => {
      const items = event.images.map((item): DocumentImageSource => {
        if (item.kind === "mermaid") {
          return {
            id: item.id,
            name: `${item.alt || "Mermaid"}.svg`,
            mime: "image/svg+xml",
            resolveUrl: () => {
              if (!item.src || !/^data:image\/svg\+xml[;,]/i.test(item.src))
                throw new Error("DIAGRAM_PREVIEW_UNAVAILABLE");
              return item.src;
            },
          };
        }
        const id = platformAssetId(item.path ?? "");
        const source = id
          ? imageSource({ path: id, name: item.title || item.alt || id })
          : null;
        return {
          id: item.id,
          name: source?.name ?? item.title ?? item.alt,
          mime: guessMime(source?.name ?? item.alt),
          downloadUrl: source
            ? source.url + (source.url.includes("?") ? "&" : "?") + "download=1"
            : undefined,
          resolveUrl: () => {
            if (!source) throw new Error("IMAGE_PREVIEW_DENIED");
            return source.url;
          },
        };
      });
      openImagePreview(items, event.index);
    },
    [imageSource, openImagePreview],
  );
  const onCanvasResourcePreview = useCallback<
    NonNullable<CanvasEditorProps["onResourcePreview"]>
  >(
    (resource) => {
      if (resource.kind !== "image") {
        open(resource.path, resource.name ?? resource.path, resource.mimeType);
        return;
      }
      if (!/^[a-f0-9-]{36}$/i.test(resource.path)) return;
      const items = (getImages.current?.() ?? []).map((item) => ({
        ...imageSource(item),
        id: item.id,
      }));
      const file = { ...imageSource(resource), id: resource.id };
      let index = items.findIndex((item) => item.id === resource.id);
      if (index < 0) index = items.push(file) - 1;
      openImagePreview(items, index);
    },
    [open, imageSource, openImagePreview],
  );
  const onCanvasAttachmentPreview = useCallback<
    NonNullable<CanvasEditorProps["onAttachmentPreview"]>
  >(
    (resource) =>
      open(resource.path, resource.name ?? resource.path, resource.mimeType),
    [open],
  );
  return {
    previewFile,
    openImagePreview,
    onCanvasResourcePreview,
    onCanvasAttachmentPreview,
    onRichAttachmentPreview,
    onRichMediaPreview,
    onMarkdownImagePreview,
    onSheetAttachmentPreview,
    onSheetImagePreview,
    onSlidesImagePreview,
    dialog: image ? (
      <DocumentImagePreview
        key={image.key}
        file={image.items[image.index]!}
        gallery={image.items}
        initialIndex={image.index}
        close={() => previewImage(null)}
      />
    ) : file ? (
      <DocumentFilePreview file={file} close={() => previewFile(null)} />
    ) : null,
  };
}
