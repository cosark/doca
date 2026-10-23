import { useCallback, useEffect, useMemo, useState } from "react";

type PreferenceKind = "view" | "creation";
type Validator<T> = (value: unknown) => value is T;
type PreferenceRecord<T> =
  | { status: "ready"; value?: T }
  | { status: "unsupported" | "unavailable"; value?: undefined };

/** Origin-scoped localStorage additionally separates each account and document. */
export function canvasPreferenceKey(
  userId: string | undefined,
  resourceId: string,
  kind: PreferenceKind,
) {
  return userId
    ? `doca.canvas.personal.v1:${encodeURIComponent(userId)}:${encodeURIComponent(resourceId)}:${kind}`
    : undefined;
}

export function readCanvasPreference<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  validate: Validator<T>,
): PreferenceRecord<T> {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { status: "ready" };
    const value: unknown = JSON.parse(raw);
    return validate(value)
      ? { status: "ready", value }
      : { status: "unsupported" };
  } catch {
    // A malformed saved record is preserved just like an unknown version.
    try {
      return {
        status: storage.getItem(key) === null ? "unavailable" : "unsupported",
      };
    } catch {
      return { status: "unavailable" };
    }
  }
}

export function writeCanvasPreference<T>(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  value: T,
  validate: Validator<T>,
) {
  const current = readCanvasPreference(storage, key, validate);
  if (current.status !== "ready") return current.status;
  if (!validate(value)) return "unsupported" as const;
  try {
    storage.setItem(key, JSON.stringify(value));
    return "ready" as const;
  } catch {
    return "unavailable" as const;
  }
}

/** The package validates its current native preferences; the host owns storage. */
export function useCanvasBrowserPreference<T>(
  userId: string | undefined,
  resourceId: string,
  kind: PreferenceKind,
  validate: Validator<T>,
) {
  const key = canvasPreferenceKey(userId, resourceId, kind);
  const [revision, refresh] = useState(0);
  const [writeStatus, setWriteStatus] = useState<{
    key: string;
    status: "ready" | "unsupported" | "unavailable";
  } | null>(null);
  const [transient, setTransient] = useState<{ key: string; value: T } | null>(
    null,
  );
  const saved = useMemo<PreferenceRecord<T>>(() => {
    if (!key) return { status: "ready" };
    try {
      return readCanvasPreference(window.localStorage, key, validate);
    } catch {
      return { status: "unavailable" };
    }
  }, [key, validate, revision]);
  useEffect(() => {
    setTransient(null);
    setWriteStatus(null);
  }, [key]);
  useEffect(() => {
    if (!key) return;
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        refresh((value) => value + 1);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  const onChange = useCallback(
    (value: T) => {
      if (!key) return;
      if (!validate(value)) return;
      let status: "ready" | "unsupported" | "unavailable";
      try {
        // Recheck immediately before writing: another tab may have saved a newer
        // unsupported record since this editor opened. Never overwrite it.
        status = writeCanvasPreference(
          window.localStorage,
          key,
          value,
          validate,
        );
      } catch {
        status = "unavailable";
      }
      setWriteStatus({ key, status });
      // A denied write or preserved unknown record must not snap the controlled
      // editor back to its previous saved value. Keep only this mounted view's
      // explicit choice; reopening still reads the untouched stored record.
      setTransient(status === "ready" ? null : { key, value });
      refresh((value) => value + 1);
    },
    [key, validate],
  );
  return {
    value: transient && transient.key === key ? transient.value : saved.value,
    onChange: key ? onChange : undefined,
    status:
      writeStatus && writeStatus.key === key && writeStatus.status !== "ready"
        ? writeStatus.status
        : saved.status,
  };
}
