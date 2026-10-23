import { expect, it } from "vitest";
import {
  DEFAULT_SHEET_ZOOM,
  sheetZoomKey,
  readSheetZoom,
  writeSheetZoom,
} from "@web/features/documents/sheet-zoom-preference.js";

function browserStore() {
  const records = new Map<string, string>();
  return {
    records,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
}

it("starts at 100% without a browser write and isolates accounts and documents", () => {
  const store = browserStore();
  const first = sheetZoomKey("owner", "first")!;
  expect(DEFAULT_SHEET_ZOOM).toBe(1);
  expect(readSheetZoom(store, first)).toEqual({ status: "ready" });
  expect(store.records.size).toBe(0);
  expect(sheetZoomKey(undefined, "first")).toBeUndefined();
  expect(
    new Set([
      first,
      sheetZoomKey("other", "first"),
      sheetZoomKey("owner", "second"),
      sheetZoomKey("owner:first", "first"),
    ]).size,
  ).toBe(4);
  expect(writeSheetZoom(store, first, 1.45)).toBe("ready");
  expect(readSheetZoom(store, first)).toEqual({
    status: "ready",
    value: { version: 1, zoomRatio: 1.45 },
  });
  expect(readSheetZoom(store, sheetZoomKey("owner", "second")!)).toEqual({
    status: "ready",
  });
});

it("preserves unknown or malformed records even if another tab writes them after opening", () => {
  const store = browserStore(),
    key = sheetZoomKey("owner", "first")!;
  expect(writeSheetZoom(store, key, 1.2)).toBe("ready");
  for (const raw of [
    '{"version":2,"zoomRatio":1.2}',
    '{"version":1,"zoomRatio":1.2,"other":true}',
    '{"version":1,"zoomRatio":"1.2"}',
    '{"version":1,"zoomRatio":0}',
    "{broken",
    "[]",
    "null",
  ]) {
    store.records.set(key, raw);
    expect(readSheetZoom(store, key).status).toBe("unsupported");
    expect(writeSheetZoom(store, key, 1.7)).toBe("unsupported");
    expect(store.records.get(key)).toBe(raw);
  }
});

it("rejects invalid native zoom events without replacing the last valid choice", () => {
  const store = browserStore(),
    key = sheetZoomKey("owner", "first")!;
  writeSheetZoom(store, key, 1.1);
  const before = store.records.get(key);
  for (const value of [NaN, Infinity, -1, 0, 0.09, 4.01]) {
    expect(writeSheetZoom(store, key, value)).toBe("unsupported");
    expect(store.records.get(key)).toBe(before);
  }
  expect(writeSheetZoom(store, key, 0.1)).toBe("ready");
  expect(writeSheetZoom(store, key, 4)).toBe("ready");
});

it("reports read and quota failures while preserving the saved record", () => {
  const unreadable = {
    getItem() {
      throw Error("Denied");
    },
    setItem() {
      throw Error("Denied");
    },
  };
  expect(readSheetZoom(unreadable, "key").status).toBe("unavailable");
  expect(writeSheetZoom(unreadable, "key", 1.5)).toBe("unavailable");
  const store = browserStore();
  writeSheetZoom(store, "key", 1.3);
  expect(
    writeSheetZoom(
      {
        getItem: store.getItem,
        setItem() {
          throw Error("Quota");
        },
      },
      "key",
      1.8,
    ),
  ).toBe("unavailable");
  expect(readSheetZoom(store, "key").value?.zoomRatio).toBe(1.3);
});
