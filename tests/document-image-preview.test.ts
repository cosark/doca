// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@web/shared/i18n.js";
import {
  DocumentImagePreview,
  imageDownloadUrl,
  type DocumentImageSource,
} from "@web/features/documents/document-image-preview.js";
import { useAttachmentPreview } from "@web/features/documents/attachment-preview.js";
import type { MarkdownImagePreviewEvent } from "@smartdoca/markdown";
import type { PresentationImagePreviewEvent } from "@smartdoca/slides";
import type {
  SpreadsheetImageGalleryItem,
  SpreadsheetImagePreviewEvent,
} from "@smartdoca/sheet";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let unmount = () => {};
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

it("keeps SVG projection URLs intact and uses the host's authorized original path", () => {
  const svg =
    "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
  expect(
    imageDownloadUrl({ name: "map.svg", mime: "image/svg+xml" }, svg),
  ).toBe(svg);
  expect(
    imageDownloadUrl(
      {
        name: "photo.png",
        mime: "image/png",
        downloadUrl: "/api/v1/assets/asset/content?trashPreview=1&download=1",
      },
      "/preview-only",
    ),
  ).toBe("/api/v1/assets/asset/content?trashPreview=1&download=1");
});

it("resolves only the selected media and ignores an earlier result after navigation", async () => {
  let releaseFirst = (_url: string) => {};
  const first = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const second = vi.fn(async () => "data:image/svg+xml,%3Csvg%2F%3E");
  const items: DocumentImageSource[] = [
    {
      id: "diagram",
      name: "diagram.svg",
      mime: "image/svg+xml",
      resolveUrl: first,
    },
    {
      id: "mindmap",
      name: "mindmap.svg",
      mime: "image/svg+xml",
      resolveUrl: second,
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(() =>
    root.render(
      createElement(LocaleProvider, {
        children: createElement(DocumentImagePreview, {
          file: items[0]!,
          gallery: items,
          close() {},
        }),
      }),
    ),
  );
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  const next = document.querySelector<HTMLButtonElement>(
    '[aria-label="下一张图片"]',
  )!;
  await act(() => next.click());
  expect(second).toHaveBeenCalledOnce();
  expect(
    document
      .querySelector(".document-image-preview-viewport img")
      ?.getAttribute("src"),
  ).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  await act(() => releaseFirst("data:image/svg+xml,stale"));
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
  ).toBe("mindmap.svg");
  expect(
    document
      .querySelector(".document-image-preview-viewport img")
      ?.getAttribute("src"),
  ).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  expect(
    document
      .querySelector<HTMLAnchorElement>("a[download]")
      ?.getAttribute("href"),
  ).toBe("data:image/svg+xml,%3Csvg%2F%3E");
});

it("keeps unresolved Markdown occurrences and resolves their original paths through host assets", async () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const images: MarkdownImagePreviewEvent["images"] = [
    {
      id: "first",
      kind: "image",
      path: firstId,
      src: "https://untrusted.invalid/ignored.png",
      alt: "first.png",
    },
    { id: "second", kind: "image", path: secondId, alt: "second.png" },
  ];
  let open = (_event: MarkdownImagePreviewEvent) => {};
  function Harness() {
    const preview = useAttachmentPreview({ trash: true });
    open = preview.onMarkdownImagePreview;
    return preview.dialog;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(() =>
    root.render(
      createElement(LocaleProvider, { children: createElement(Harness) }),
    ),
  );
  await act(() => open({ image: images[0]!, images, index: 0 }));
  expect(
    document
      .querySelector(".document-image-preview-viewport img")
      ?.getAttribute("src"),
  ).toBe(`/api/v1/assets/${firstId}/content?trashPreview=1`);
  expect(
    document.querySelector(".document-image-preview-position")?.textContent,
  ).toBe("1 / 2");
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="下一张图片"]')!
      .click(),
  );
  expect(
    document
      .querySelector(".document-image-preview-viewport img")
      ?.getAttribute("src"),
  ).toBe(`/api/v1/assets/${secondId}/content?trashPreview=1`);
  expect(
    document
      .querySelector<HTMLAnchorElement>("a[download]")
      ?.getAttribute("href"),
  ).toBe(`/api/v1/assets/${secondId}/content?trashPreview=1&download=1`);
});

it("locates a Sheet occurrence by drawing identity and keeps later worksheet images", async () => {
  const asset = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  const cell = {
    sheetId: "one",
    startRow: 0,
    endRow: 0,
    startColumn: 0,
    endColumn: 0,
  };
  const gallery: SpreadsheetImageGalleryItem[] = [
    {
      drawingId: "drawing-a",
      placement: "inline",
      sheetId: "one",
      cell,
      resource: { id: asset, kind: "image", name: "first.png" },
    },
    {
      drawingId: "drawing-b",
      placement: "inline",
      sheetId: "one",
      cell,
      resource: { id: asset, kind: "image", name: "repeated.png" },
    },
    {
      drawingId: "drawing-c",
      placement: "inline",
      sheetId: "two",
      cell: { ...cell, sheetId: "two" },
      resource: { id: other, kind: "image", name: "other.png" },
    },
  ];
  const readGallery = vi.fn(() => gallery);
  let open = (_event: SpreadsheetImagePreviewEvent) => {};
  function Harness() {
    const preview = useAttachmentPreview({ sheetImages: readGallery });
    open = preview.onSheetImagePreview;
    return preview.dialog;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(() =>
    root.render(
      createElement(LocaleProvider, { children: createElement(Harness) }),
    ),
  );
  await act(() =>
    open({
      drawingId: "drawing-b",
      resource: gallery[1]!.resource,
      cell: { workbookId: "book", sheetId: "one", row: 0, column: 0 },
    }),
  );
  expect(readGallery).toHaveBeenCalledOnce();
  expect(
    document.querySelector(".document-image-preview-position")?.textContent,
  ).toBe("2 / 3");
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
  ).toBe("repeated.png");
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="下一张图片"]')!
      .click(),
  );
  expect(
    document
      .querySelector(".document-image-preview-viewport img")
      ?.getAttribute("src"),
  ).toBe(`/api/v1/assets/${other}/content`);
});

it("keeps Canvas occurrence IDs when one asset is referenced more than once", async () => {
  const path = "11111111-1111-4111-8111-111111111111";
  const resources = [
    { id: "canvas-first", kind: "image" as const, path, name: "first.png" },
    { id: "canvas-second", kind: "image" as const, path, name: "second.png" },
  ];
  let open = (_resource: (typeof resources)[number]) => {};
  function Harness() {
    const preview = useAttachmentPreview({ imageResources: () => resources });
    open = preview.onCanvasResourcePreview;
    return preview.dialog;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(() =>
    root.render(
      createElement(LocaleProvider, { children: createElement(Harness) }),
    ),
  );
  await act(() => open(resources[1]!));
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
  ).toBe("second.png");
  expect(
    document.querySelector(".document-image-preview-position")?.textContent,
  ).toBe("2 / 2");
});

it("keeps Slides opaque occurrence identity across pages and resolves through trash authorization", async () => {
  const first = "11111111-1111-4111-8111-111111111111",
    second = "22222222-2222-4222-8222-222222222222";
  const gallery: PresentationImagePreviewEvent["gallery"] = [
    {
      id: "opaque-first",
      slideId: "slide-one",
      elementId: "a",
      assetId: first,
      alt: "first.png",
    },
    {
      id: "opaque-reused",
      slideId: "slide-two",
      elementId: "b",
      assetId: first,
      alt: "reused.png",
    },
    {
      id: "opaque-later",
      slideId: "slide-two",
      elementId: "c",
      assetId: second,
      alt: "later.png",
    },
  ];
  let open = (_event: PresentationImagePreviewEvent) => {};
  function Harness() {
    const preview = useAttachmentPreview({ trash: true });
    open = preview.onSlidesImagePreview;
    return preview.dialog;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(() =>
    root.render(
      createElement(LocaleProvider, { children: createElement(Harness) }),
    ),
  );
  await act(() => open({ currentId: "opaque-reused", gallery }));
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
  ).toBe("reused.png");
  expect(
    document.querySelector(".document-image-preview-position")?.textContent,
  ).toBe("2 / 3");
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="下一张图片"]')!
      .click(),
  );
  expect(
    document
      .querySelector(".document-image-preview-viewport img")
      ?.getAttribute("src"),
  ).toBe(`/api/v1/assets/${second}/content?trashPreview=1`);
  expect(
    document
      .querySelector<HTMLAnchorElement>("a[download]")
      ?.getAttribute("href"),
  ).toBe(`/api/v1/assets/${second}/content?trashPreview=1&download=1`);
});
