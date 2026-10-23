import { expect, it } from "vitest";
import {
  canvasPreferenceKey,
  readCanvasPreference,
  writeCanvasPreference,
} from "@web/features/documents/canvas-browser-preferences.js";

const valid = (value: unknown): value is { version: 1; gridVisible: boolean } =>
  !!value &&
  typeof value === "object" &&
  (value as any).version === 1 &&
  typeof (value as any).gridVisible === "boolean" &&
  Object.keys(value).length === 2;

it("keeps account, document and preference kinds separate without anonymous persistence", () => {
  expect(canvasPreferenceKey(undefined, "board", "view")).toBeUndefined();
  const keys = new Set([
    canvasPreferenceKey("a", "first", "view"),
    canvasPreferenceKey("b", "first", "view"),
    canvasPreferenceKey("a", "second", "view"),
    canvasPreferenceKey("a", "first", "creation"),
    canvasPreferenceKey("a:b", "first", "view"),
  ]);
  expect(keys.size).toBe(5);
});

it("leaves absent and unsupported records untouched, including a newer write from another tab", () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
  const key = canvasPreferenceKey("owner", "board", "view")!;
  expect(readCanvasPreference(storage, key, valid)).toEqual({
    status: "ready",
  });
  expect(records.size).toBe(0);
  const current = { version: 1 as const, gridVisible: false };
  expect(writeCanvasPreference(storage, key, current, valid)).toBe("ready");
  expect(readCanvasPreference(storage, key, valid)).toEqual({
    status: "ready",
    value: current,
  });
  for (const raw of [
    '{"version":2,"gridVisible":true}',
    '{"version":1,"gridVisible":true,"unknown":1}',
    "{broken",
  ]) {
    records.set(key, raw);
    expect(readCanvasPreference(storage, key, valid).status).toBe(
      "unsupported",
    );
    expect(writeCanvasPreference(storage, key, current, valid)).toBe(
      "unsupported",
    );
    expect(records.get(key)).toBe(raw);
  }
});

it("reports denied browser storage and never converts it to an empty saved preference", () => {
  const denied = {
    getItem() {
      throw new Error("Denied");
    },
    setItem() {
      throw new Error("Denied");
    },
  };
  expect(readCanvasPreference(denied, "key", valid).status).toBe("unavailable");
  expect(
    writeCanvasPreference(
      denied,
      "key",
      { version: 1, gridVisible: true },
      valid,
    ),
  ).toBe("unavailable");
});
