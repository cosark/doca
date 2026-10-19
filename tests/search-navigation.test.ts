// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GlobalSearch } from "@web/features/search/search.js";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@web/shared/api.js", () => ({
  api,
  assetUrl: (id: string) => `/assets/${id}`,
  fileUrl: (id: string) => `/files/${id}`,
}));
vi.mock("@web/shared/i18n.js", () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: "zh" }) };
});
vi.mock("antd", () => ({ Select: () => null }));
vi.mock("@web/shared/components/user-badge.js", () => ({ UserBadge: () => null }));
vi.mock("@web/features/files/files.js", () => ({ FileGlyph: () => null }));
vi.mock("@web/features/documents/dialogs.js", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const documentId = "11111111-1111-1111-1111-111111111111";
const documentLocation = {
  id: "file-1", name: "image.png", parentType: "document", parentId: documentId,
  navigation: [{ type: "document", id: documentId, name: "📚 项目跟进" }],
};
let locations: Array<{
  id: string; name: string; parentType: string; parentId: string;
  navigation: Array<{ type: string; id: string; name: string }>;
  sharedRoot?: { id: string; name: string };
}>;
let contentResults: unknown[];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  locations = [documentLocation];
  contentResults = [];
  window.history.replaceState(null, "", `#/r/${documentId}`);
  api.mockImplementation(async (path: string) => {
    if (path === "/discovery/policy") return { publicModes: {} };
    if (path.startsWith("/resources?")) return { items: [] };
    if (path.startsWith("/content/sources?")) return { items: [{ id: "test:source", title: { zh: "测试", en: "Test" }, purposes: ["search"], capabilities: { search: true } }] };
    if (path === "/content/search") return { items: contentResults };
    if (path === "/content/resolve") return { path: "/r/content-target", fingerprint: "test" };
    if (path.startsWith("/search/documents?")) return { items: [], total: 0 };
    if (path.startsWith("/files/search?")) return {
      items: [{
        storageObjectId: "object-1", id: "file-1", name: "image.png",
        mime: "image/png", size: 100, updatedAt: "2026-10-19T00:00:00Z",
        description: "早上好", locations,
      }],
    };
    throw new Error(`Unexpected API call: ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function search() {
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? createElement(GlobalSearch, {
      initialQuery: "早上",
      close: () => { close(); setOpen(false); },
    }) : null;
  }
  await act(() => root.render(createElement(Harness)));
  await act(() => vi.advanceTimersByTimeAsync(180));
  return close;
}

it.each([".search-file-result", ".search-file-locations button"])(
  "closes search and notifies navigation when %s opens a file in the current document",
  async (selector) => {
    const close = await search();
    const changed = vi.fn();
    window.addEventListener("hashchange", changed);
    try {
      await act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
      expect(window.location.hash).toBe(`#/r/${documentId}`);
      expect(changed).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      window.removeEventListener("hashchange", changed);
    }
  },
);

it.each([false, true])("opens a file in its %s shared folder with its exact path and focus", async (shared) => {
  const navigation = [
    { type: shared ? "folder" : "system", id: shared ? "shared-root" : "root", name: "文件 & 图片" },
    { type: "folder", id: "folder-1", name: "早上 #1" },
  ];
  locations = [{
    id: "copy-2", name: "image.png", parentType: "folder", parentId: "folder-1", navigation,
    ...(shared ? { sharedRoot: { id: "shared-root", name: "文件 & 图片" } } : {}),
  }];
  const close = await search();
  await act(() => host.querySelector<HTMLButtonElement>(".search-file-result")!.click());
  const [path, query] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  expect(path).toBe(shared ? "#/shared-files/shared-root" : "#/files");
  expect(JSON.parse(params.get("path")!)).toEqual(navigation);
  expect(params.get("focus")).toBe("copy-2");
  if (shared) expect(params.get("name")).toBe("文件 & 图片");
  expect(close).toHaveBeenCalledOnce();
});

it("closes search after successfully resolving a content result", async () => {
  contentResults = [{ title: "早上", ref: { sourceId: "test:source", id: "content-1" }, excerpt: "早上好" }];
  const close = await search();
  await act(async () => host.querySelector<HTMLButtonElement>(".search-content-result")!.click());
  expect(window.location.hash).toBe("#/r/content-target");
  expect(close).toHaveBeenCalledOnce();
});

it("keeps search open when a content result cannot be resolved", async () => {
  contentResults = [{ title: "早上", ref: { sourceId: "test:source", id: "content-1" }, excerpt: "早上好" }];
  const close = await search();
  api.mockImplementationOnce(async () => null);
  await act(async () => host.querySelector<HTMLButtonElement>(".search-content-result")!.click());
  expect(window.location.hash).toBe(`#/r/${documentId}`);
  expect(close).not.toHaveBeenCalled();
  expect(host.textContent).toContain("content.unavailable");
});
