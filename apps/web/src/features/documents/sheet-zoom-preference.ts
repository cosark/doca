import { useCallback, useEffect, useMemo, useState } from "react";

export const DEFAULT_SHEET_ZOOM = 1;
type ZoomRecord = { version: 1; zoomRatio: number };
type PreferenceStatus = "ready" | "unsupported" | "unavailable";
type StoredZoom = { status: PreferenceStatus; value?: ZoomRecord };

export function sheetZoomKey(userId: string | undefined, resourceId: string) {
  return userId
    ? `doca.sheet.zoom.v1:${encodeURIComponent(userId)}:${encodeURIComponent(resourceId)}`
    : undefined;
}

export function isSheetZoomRatio(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.1 &&
    value <= 4
  );
}

export function readSheetZoom(
  storage: Pick<Storage, "getItem">,
  key: string,
): StoredZoom {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "ready" };
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (
        record.version === 1 &&
        isSheetZoomRatio(record.zoomRatio) &&
        Object.keys(record).length === 2
      ) {
        return { status: "ready", value: record as ZoomRecord };
      }
    }
  } catch {
    // Preserve invalid JSON exactly, as with unsupported versions.
  }
  return { status: "unsupported" };
}

export function writeSheetZoom(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  zoomRatio: number,
): PreferenceStatus {
  if (!isSheetZoomRatio(zoomRatio)) return "unsupported";
  const current = readSheetZoom(storage, key);
  if (current.status !== "ready") return current.status;
  try {
    storage.setItem(
      key,
      JSON.stringify({ version: 1, zoomRatio } satisfies ZoomRecord),
    );
    return "ready";
  } catch {
    return "unavailable";
  }
}

/** One display ratio per account/document on this origin; never a content edit. */
export function useSheetZoomPreference(
  userId: string | undefined,
  resourceId: string,
) {
  const key = sheetZoomKey(userId, resourceId);
  const viewId = JSON.stringify([userId ?? null, resourceId]);
  const [revision, refresh] = useState(0);
  const [current, setCurrent] = useState<{
    viewId: string;
    zoomRatio: number;
    status: PreferenceStatus;
  } | null>(null);
  const stored = useMemo<StoredZoom>(() => {
    if (!key) return { status: "ready" };
    try {
      return readSheetZoom(window.localStorage, key);
    } catch {
      return { status: "unavailable" };
    }
  }, [key, revision]);
  useEffect(() => {
    setCurrent(null);
  }, [viewId]);
  useEffect(() => {
    if (!key) return;
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        setCurrent(null);
        refresh((value) => value + 1);
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  const onChange = useCallback(
    (zoomRatio: number) => {
      if (!isSheetZoomRatio(zoomRatio)) return;
      let status: PreferenceStatus = "ready";
      if (key) {
        try {
          // A different tab may have installed an unknown version since mount.
          status = writeSheetZoom(window.localStorage, key, zoomRatio);
        } catch {
          status = "unavailable";
        }
      }
      // Keep an explicit choice usable even when browser storage is denied or an
      // unsupported record must remain intact. Anonymous views are transient too.
      setCurrent({ viewId, zoomRatio, status });
      refresh((value) => value + 1);
    },
    [key, viewId],
  );
  const local = current?.viewId === viewId ? current : null;
  return {
    zoomRatio:
      local?.zoomRatio ?? stored.value?.zoomRatio ?? DEFAULT_SHEET_ZOOM,
    status: local?.status ?? stored.status,
    onChange,
  };
}
