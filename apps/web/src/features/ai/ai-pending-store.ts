import type { PendingSendItem } from "./ai-session-ux.js";

export type PendingQueueScope = {
  docaOrigin: string;
  userId: string;
  connectionId: string;
  profile: { id: string; revision: number } | null;
};

export type LegacyPendingSource = {
  storageKey: string;
  sessionKey: string;
  hash: string;
};

export type LegacyPendingInitialState =
  { state: "accepted"; serverJobId: string } | { state: "withdrawn" };

export type PendingEntry = PendingQueueScope & {
  recordVersion: 1;
  messageId: string;
  sessionId: string | null;
  item: PendingSendItem;
  payloadHash: string;
  state: "pending" | "accepted" | "withdrawn";
  createdAt: string;
  updatedAt: string;
  source?: LegacyPendingSource;
  serverJobId?: string;
};

export class PendingQueueStorageError extends Error {
  readonly code = "pending_storage_unavailable";
  constructor(options?: ErrorOptions) {
    super("pending_storage_unavailable", options);
    this.name = "PendingQueueStorageError";
  }
}

export class PendingQueueChangedError extends Error {
  readonly code = "pending_message_conflict";
  constructor() {
    super("pending_message_conflict");
    this.name = "PendingQueueChangedError";
  }
}

const DATABASE = "doca-ai-pending";
const DATABASE_VERSION = 1;
const STORE = "entries";
const KEY_PATH = ["docaOrigin", "userId", "connectionId", "messageId"];
const SCOPE_PATH = KEY_PATH.slice(0, 3);
const HASH = /^[a-f0-9]{64}$/;

function storageError(cause?: unknown) {
  return cause instanceof PendingQueueStorageError ||
    cause instanceof PendingQueueChangedError
    ? cause
    : new PendingQueueStorageError({ cause });
}

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = [],
) {
  return (
    Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function timestamp(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

function optional(value: unknown, predicate: (input: unknown) => boolean) {
  return value === undefined || predicate(value);
}

/** JSON payloads only: no prototype conversion, dropped fields or guessed values. */
function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (!Array.isArray(value) && !object(value))
    throw new PendingQueueStorageError();
  if (seen.has(value)) throw new PendingQueueStorageError();
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    // Sparse arrays and undefined array entries would otherwise become null.
    const names = Object.keys(value);
    if (
      names.length !== value.length ||
      names.some((key, index) => key !== String(index)) ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      throw new PendingQueueStorageError();
    result = `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
  } else {
    result = `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function validItem(
  value: unknown,
  requireSelection: boolean,
): value is PendingSendItem {
  if (
    !object(value) ||
    !keys(
      value,
      [
        "id",
        "text",
        "attachments",
        "files",
        "references",
        "createdAt",
        "modelId",
        "scope",
        "currentResourceId",
        "currentFolder",
        "skillIds",
        "webSearch",
        "skipApprovals",
      ],
      ["id", "text", "attachments", "references", "createdAt"],
    )
  )
    return false;
  if (
    !text(value.id) ||
    typeof value.text !== "string" ||
    !timestamp(value.createdAt)
  )
    return false;
  if (
    !optional(value.modelId, text) ||
    !optional(value.scope, (input) => input === "all" || input === "document")
  )
    return false;
  if (
    requireSelection &&
    (!text(value.modelId) ||
      (value.scope !== "all" && value.scope !== "document"))
  )
    return false;
  if (
    !Array.isArray(value.attachments) ||
    !value.attachments.every(
      (file) =>
        object(file) &&
        keys(
          file,
          [
            "id",
            "filename",
            "mime",
            "size",
            "sourceFileId",
            "sourceName",
            "url",
            "extractStatus",
            "preview",
            "description",
          ],
          ["id", "filename", "mime", "size"],
        ) &&
        text(file.id) &&
        typeof file.filename === "string" &&
        typeof file.mime === "string" &&
        typeof file.size === "number" &&
        Number.isFinite(file.size) &&
        file.size >= 0 &&
        optional(file.sourceFileId, text) &&
        optional(file.sourceName, (input) => typeof input === "string") &&
        optional(file.url, (input) => typeof input === "string") &&
        optional(
          file.extractStatus,
          (input) =>
            input === "pending" || input === "ready" || input === "failed",
        ) &&
        optional(file.preview, (input) => typeof input === "string") &&
        optional(file.description, (input) => typeof input === "string") &&
        (!requireSelection ||
          (file.extractStatus !== "pending" &&
            file.extractStatus !== "failed")),
    )
  )
    return false;
  if (
    !optional(
      value.files,
      (input) =>
        Array.isArray(input) &&
        input.every(
          (file) =>
            object(file) &&
            keys(file, ["kind", "id", "name"], ["kind", "id"]) &&
            (file.kind === "file" || file.kind === "folder") &&
            text(file.id) &&
            optional(file.name, (name) => typeof name === "string"),
        ),
    )
  )
    return false;
  if (
    !Array.isArray(value.references) ||
    !value.references.every(
      (reference) =>
        object(reference) &&
        keys(
          reference,
          [
            "resourceId",
            "anchor",
            "label",
            "format",
            "description",
            "epochId",
            "seq",
          ],
          ["resourceId"],
        ) &&
        text(reference.resourceId) &&
        ["label", "format", "description", "epochId"].every((key) =>
          optional(reference[key], (input) => typeof input === "string"),
        ) &&
        optional(
          reference.seq,
          (input) =>
            typeof input === "number" &&
            Number.isSafeInteger(input) &&
            input >= 0,
        ),
    )
  )
    return false;
  if (
    !optional(value.currentResourceId, text) ||
    !optional(
      value.currentFolder,
      (folder) =>
        object(folder) &&
        keys(folder, ["type", "id"], ["type", "id"]) &&
        ["system", "folder", "document"].includes(folder.type as string) &&
        text(folder.id),
    )
  )
    return false;
  if (
    !optional(value.skillIds, (ids) => Array.isArray(ids) && ids.every(text)) ||
    !optional(value.webSearch, (input) => typeof input === "boolean") ||
    !optional(
      value.skipApprovals,
      (input) =>
        object(input) &&
        keys(input, ["create", "delete", "modify"]) &&
        Object.values(input).every(
          (entry) => entry === undefined || typeof entry === "boolean",
        ),
    )
  )
    return false;
  try {
    canonical(value);
    return true;
  } catch {
    return false;
  }
}

/** Strict known DTO check; legacy callers may inspect missing selection fields
 * without selecting historical defaults. New writes always require them. */
export function validatePendingItem(
  value: unknown,
  requireComplete = false,
): value is PendingSendItem {
  return validItem(value, requireComplete);
}

function assertScope(scope: PendingQueueScope) {
  if (
    !object(scope) ||
    !keys(
      scope,
      ["docaOrigin", "userId", "connectionId", "profile"],
      ["docaOrigin", "userId", "connectionId", "profile"],
    ) ||
    !text(scope.docaOrigin) ||
    !text(scope.userId) ||
    !text(scope.connectionId)
  )
    throw new PendingQueueStorageError();
  try {
    const url = new URL(scope.docaOrigin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== scope.docaOrigin
    )
      throw new PendingQueueStorageError();
  } catch (error) {
    throw storageError(error);
  }
  if (scope.connectionId === "website") {
    if (scope.profile !== null) throw new PendingQueueStorageError();
  } else if (
    !object(scope.profile) ||
    !keys(scope.profile, ["id", "revision"], ["id", "revision"]) ||
    !text(scope.profile.id) ||
    typeof scope.profile.revision !== "number" ||
    !Number.isSafeInteger(scope.profile.revision) ||
    scope.profile.revision < 1
  ) {
    throw new PendingQueueStorageError();
  }
}

function validSource(source: unknown): source is LegacyPendingSource {
  return (
    object(source) &&
    keys(
      source,
      ["storageKey", "sessionKey", "hash"],
      ["storageKey", "sessionKey", "hash"],
    ) &&
    text(source.storageKey) &&
    text(source.sessionKey) &&
    typeof source.hash === "string" &&
    HASH.test(source.hash)
  );
}

function entryShape(value: unknown): asserts value is PendingEntry {
  if (
    !object(value) ||
    !keys(
      value,
      [
        "recordVersion",
        ...KEY_PATH,
        "profile",
        "sessionId",
        "item",
        "payloadHash",
        "state",
        "createdAt",
        "updatedAt",
        "source",
        "serverJobId",
      ],
      [
        "recordVersion",
        ...KEY_PATH,
        "profile",
        "sessionId",
        "item",
        "payloadHash",
        "state",
        "createdAt",
        "updatedAt",
      ],
    )
  )
    throw new PendingQueueStorageError();
  assertScope({
    docaOrigin: value.docaOrigin as string,
    userId: value.userId as string,
    connectionId: value.connectionId as string,
    profile: value.profile as PendingQueueScope["profile"],
  });
  if (
    value.recordVersion !== 1 ||
    !text(value.messageId) ||
    (value.sessionId !== null && !text(value.sessionId)) ||
    !validItem(value.item, true) ||
    value.item.id !== value.messageId ||
    typeof value.payloadHash !== "string" ||
    !HASH.test(value.payloadHash) ||
    !["pending", "accepted", "withdrawn"].includes(value.state as string) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !optional(value.source, validSource) ||
    !optional(value.serverJobId, text) ||
    (value.state === "accepted"
      ? !text(value.serverJobId)
      : value.serverJobId !== undefined)
  )
    throw new PendingQueueStorageError();
}

export function pendingScopeKey(scope: PendingQueueScope): string {
  assertScope(scope);
  return canonical(scope);
}

export function samePendingItem(
  a: PendingSendItem,
  b: PendingSendItem,
): boolean {
  try {
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}

async function digest(value: string): Promise<string> {
  try {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch (error) {
    throw storageError(error);
  }
}

export async function hashPendingItem(item: PendingSendItem): Promise<string> {
  if (!validItem(item, false)) throw new PendingQueueStorageError();
  return digest(canonical(item));
}

function pathsEqual(actual: string | string[] | null, expected: string[]) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error?: unknown) => {
      if (!settled) {
        settled = true;
        reject(storageError(error));
      }
    };
    try {
      const request = indexedDB.open(DATABASE, DATABASE_VERSION);
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail();
      request.onupgradeneeded = (event) => {
        try {
          if (settled) {
            request.transaction!.abort();
            return;
          }
          if (event.oldVersion !== 0) {
            request.transaction!.abort();
            fail();
            return;
          }
          const store = request.result.createObjectStore(STORE, {
            keyPath: KEY_PATH,
          });
          store.createIndex("scope", SCOPE_PATH, { unique: false });
        } catch (error) {
          request.transaction?.abort();
          fail(error);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        db.onversionchange = () => db.close();
        try {
          if (
            db.version !== DATABASE_VERSION ||
            db.objectStoreNames.length !== 1 ||
            !db.objectStoreNames.contains(STORE)
          )
            throw new PendingQueueStorageError();
          const transaction = db.transaction(STORE, "readonly");
          const store = transaction.objectStore(STORE);
          const index = store.index("scope");
          if (
            !pathsEqual(store.keyPath, KEY_PATH) ||
            store.autoIncrement ||
            store.indexNames.length !== 1 ||
            !pathsEqual(index.keyPath, SCOPE_PATH) ||
            index.unique ||
            index.multiEntry
          )
            throw new PendingQueueStorageError();
          transaction.onabort = () => {
            db.close();
            fail(transaction.error);
          };
          transaction.oncomplete = () => {
            if (settled) {
              db.close();
              return;
            }
            settled = true;
            resolve(db);
          };
        } catch (error) {
          db.close();
          fail(error);
        }
      };
    } catch (error) {
      fail(error);
    }
  });
}

/** The callback is synchronous. Hashing and network work must stay outside IDB transactions. */
async function transaction<T>(
  mode: IDBTransactionMode,
  start: (
    store: IDBObjectStore,
    done: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      let result: T;
      let hasResult = false;
      let failure: unknown;
      try {
        tx = db.transaction(STORE, mode);
        tx.onabort = () => reject(storageError(failure ?? tx.error));
        tx.onerror = () => {
          /* onabort reports the final transaction outcome. */
        };
        tx.oncomplete = () =>
          hasResult ? resolve(result) : reject(new PendingQueueStorageError());
        const fail = (error: unknown) => {
          failure = error;
          try {
            tx.abort();
          } catch {
            reject(storageError(error));
          }
        };
        try {
          start(
            tx.objectStore(STORE),
            (value) => {
              result = value;
              hasResult = true;
            },
            fail,
          );
        } catch (error) {
          fail(error);
        }
      } catch (error) {
        reject(storageError(error));
      }
    });
  } finally {
    db.close();
  }
}

function key(scope: PendingQueueScope, id: string): IDBValidKey {
  return [scope.docaOrigin, scope.userId, scope.connectionId, id];
}

function matchesScope(entry: PendingEntry, scope: PendingQueueScope) {
  return (
    entry.docaOrigin === scope.docaOrigin &&
    entry.userId === scope.userId &&
    entry.connectionId === scope.connectionId &&
    canonical(entry.profile) === canonical(scope.profile)
  );
}

async function checkedRead(
  value: unknown,
  scope: PendingQueueScope,
): Promise<PendingEntry> {
  entryShape(value);
  if (!matchesScope(value, scope)) throw new PendingQueueChangedError();
  if ((await hashPendingItem(value.item)) !== value.payloadHash)
    throw new PendingQueueStorageError();
  return value;
}

export async function listPendingEntries(
  scope: PendingQueueScope,
): Promise<PendingEntry[]> {
  assertScope(scope);
  const values = await transaction<unknown[]>("readonly", (store, done) => {
    const request = store
      .index("scope")
      .getAll([scope.docaOrigin, scope.userId, scope.connectionId]);
    request.onsuccess = () => done(request.result);
  });
  const checked = await Promise.all(
    values.map(async (value) => {
      entryShape(value);
      // Validate all records in the connection, including other profiles, before
      // selecting this profile. Unknown values are never hidden or rewritten.
      if ((await hashPendingItem(value.item)) !== value.payloadHash)
        throw new PendingQueueStorageError();
      return value;
    }),
  );
  return checked
    .filter((entry) => matchesScope(entry, scope))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.messageId.localeCompare(b.messageId),
    );
}

export async function getPendingEntry(
  scope: PendingQueueScope,
  id: string,
): Promise<PendingEntry | null> {
  assertScope(scope);
  if (!text(id)) throw new PendingQueueStorageError();
  const value = await transaction<unknown>("readonly", (store, done) => {
    const request = store.get(key(scope, id));
    request.onsuccess = () => done(request.result);
  });
  return value === undefined ? null : checkedRead(value, scope);
}

async function prepare(scope: PendingQueueScope, item: PendingSendItem) {
  assertScope(scope);
  if (!validItem(item, true)) throw new PendingQueueStorageError();
  // Clone before hashing: a caller cannot edit the payload while digest awaits.
  const snapshot = structuredClone(item);
  return {
    scope: structuredClone(scope),
    item: snapshot,
    payloadHash: await hashPendingItem(snapshot),
    encoded: canonical(snapshot),
  };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

function currentEntry(value: unknown, prepared: Prepared): PendingEntry {
  entryShape(value);
  if (
    !matchesScope(value, prepared.scope) ||
    value.messageId !== prepared.item.id ||
    value.payloadHash !== prepared.payloadHash ||
    canonical(value.item) !== prepared.encoded
  )
    throw new PendingQueueChangedError();
  return value;
}

function nextTime(entry: PendingEntry) {
  return new Date(
    Math.max(Date.now(), Date.parse(entry.updatedAt) + 1),
  ).toISOString();
}

export async function persistPendingEntry(
  scope: PendingQueueScope,
  sessionId: string | null,
  item: PendingSendItem,
  source?: LegacyPendingSource,
  initial?: LegacyPendingInitialState,
): Promise<PendingEntry> {
  if (
    (sessionId !== null && !text(sessionId)) ||
    !optional(source, validSource)
  )
    throw new PendingQueueStorageError();
  if (
    initial !== undefined &&
    (!validSource(source) ||
      !object(initial) ||
      (initial.state === "accepted"
        ? !keys(initial, ["state", "serverJobId"], ["state", "serverJobId"]) ||
          !text(initial.serverJobId) ||
          sessionId === null
        : initial.state !== "withdrawn" ||
          !keys(initial, ["state"], ["state"])))
  )
    throw new PendingQueueStorageError();
  const sourceSnapshot =
    source === undefined ? undefined : structuredClone(source);
  const initialSnapshot =
    initial === undefined ? undefined : structuredClone(initial);
  const prepared = await prepare(scope, item);
  return transaction<PendingEntry>("readwrite", (store, done, fail) => {
    const request = store.get(key(prepared.scope, prepared.item.id));
    request.onsuccess = () => {
      try {
        if (request.result !== undefined) {
          const current = currentEntry(request.result, prepared);
          if (
            current.sessionId !== sessionId ||
            (sourceSnapshot !== undefined &&
              canonical(current.source ?? null) !== canonical(sourceSnapshot))
          )
            throw new PendingQueueChangedError();
          if (
            initialSnapshot !== undefined &&
            (current.state !== initialSnapshot.state ||
              (initialSnapshot.state === "accepted" &&
                current.serverJobId !== initialSnapshot.serverJobId))
          )
            throw new PendingQueueChangedError();
          // Idempotence returns the existing tombstone; it never becomes pending.
          done(current);
          return;
        }
        const now = new Date().toISOString();
        const entry: PendingEntry = {
          ...prepared.scope,
          recordVersion: 1,
          messageId: prepared.item.id,
          sessionId,
          item: prepared.item,
          payloadHash: prepared.payloadHash,
          state: initialSnapshot?.state ?? "pending",
          createdAt: now,
          updatedAt: now,
          ...(sourceSnapshot === undefined ? {} : { source: sourceSnapshot }),
          ...(initialSnapshot?.state === "accepted"
            ? { serverJobId: initialSnapshot.serverJobId }
            : {}),
        };
        store.add(entry);
        done(entry);
      } catch (error) {
        fail(error);
      }
    };
  });
}

async function change(
  scope: PendingQueueScope,
  item: PendingSendItem,
  update: (entry: PendingEntry) => PendingEntry,
): Promise<PendingEntry> {
  const prepared = await prepare(scope, item);
  return transaction<PendingEntry>("readwrite", (store, done, fail) => {
    const request = store.get(key(prepared.scope, prepared.item.id));
    request.onsuccess = () => {
      try {
        if (request.result === undefined) throw new PendingQueueChangedError();
        const current = currentEntry(request.result, prepared);
        const next = update(current);
        if (next !== current) store.put(next);
        done(next);
      } catch (error) {
        fail(error);
      }
    };
  });
}

export async function bindPendingSession(
  scope: PendingQueueScope,
  item: PendingSendItem,
  sessionId: string,
): Promise<PendingEntry> {
  if (!text(sessionId)) throw new PendingQueueStorageError();
  return change(scope, item, (entry) => {
    if (entry.sessionId === sessionId) return entry;
    if (entry.sessionId !== null || entry.state !== "pending")
      throw new PendingQueueChangedError();
    return { ...entry, sessionId, updatedAt: nextTime(entry) };
  });
}

export async function markPendingAccepted(
  scope: PendingQueueScope,
  item: PendingSendItem,
  serverJobId: string,
): Promise<void> {
  if (!text(serverJobId)) throw new PendingQueueStorageError();
  await change(scope, item, (entry) => {
    if (entry.state === "accepted" && entry.serverJobId === serverJobId)
      return entry;
    if (entry.state !== "pending" || entry.sessionId === null)
      throw new PendingQueueChangedError();
    return {
      ...entry,
      state: "accepted",
      serverJobId,
      updatedAt: nextTime(entry),
    };
  });
}

export async function withdrawPendingEntry(
  scope: PendingQueueScope,
  item: PendingSendItem,
): Promise<void> {
  await change(scope, item, (entry) => {
    if (entry.state === "withdrawn") return entry;
    if (entry.state !== "pending") throw new PendingQueueChangedError();
    return { ...entry, state: "withdrawn", updatedAt: nextTime(entry) };
  });
}

export async function promotePendingEntry(
  scope: PendingQueueScope,
  item: PendingSendItem,
): Promise<void> {
  await change(scope, item, (entry) => {
    if (entry.state !== "pending") throw new PendingQueueChangedError();
    return { ...entry, updatedAt: nextTime(entry) };
  });
}
