import type { Bootstrap, Detail, Resource } from "./api.js";

export const documentStartupCacheKey = "doca.document-startup.v1";
const maxDocuments = 12;
let identityRevision = 0;
export const startupIdentityRevision = () => identityRevision;
export const invalidateStartupIdentity = () => {
  identityRevision++;
};
type CachedDocument = { detail: Detail; library: Resource | null };
type StartupCache = {
  version: 1;
  bootstrap: Bootstrap;
  documents: CachedDocument[];
};

const isRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const resourceIdPattern = /^[a-f0-9-]{36}$/;
const optionalString = (value: unknown) =>
  value === undefined || typeof value === "string";
const nullableString = (value: unknown) =>
  value === null || typeof value === "string";
function validResource(value: unknown): value is Resource {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    resourceIdPattern.test(value.id) &&
    ["document", "library"].includes(value.kind) &&
    ["rich_text", "markdown", "spreadsheet", "canvas", "presentation"].includes(
      value.format,
    ) &&
    typeof value.title === "string" &&
    typeof value.owner_id === "string" &&
    ["none", "reader", "commenter", "editor", "manager", "owner"].includes(
      value.role,
    ) &&
    Number.isInteger(value.version) &&
    ["inherit", "custom"].includes(value.access_mode) &&
    ["invited", "requestable", "authenticated", "public"].includes(
      value.visibility,
    ) &&
    (value.library_id === null || typeof value.library_id === "string") &&
    nullableString(value.parent_id) &&
    nullableString(value.deleted_at) &&
    (value.page_width == null || typeof value.page_width === "string") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}
function validCache(value: unknown): value is StartupCache {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bootstrap))
    return false;
  const b = value.bootstrap;
  return (
    typeof b.siteName === "string" &&
    typeof b.initialized === "boolean" &&
    typeof b.registrationEnabled === "boolean" &&
    isRecord(b.capabilities) &&
    Object.values(b.capabilities).every((flag) => typeof flag === "boolean") &&
    isRecord(b.user) &&
    typeof b.user.id === "string" &&
    resourceIdPattern.test(b.user.id) &&
    typeof b.user.display_name === "string" &&
    typeof b.user.admin === "boolean" &&
    optionalString(b.user.public_id) &&
    optionalString(b.defaultLocale) &&
    optionalString(b.defaultTimezone) &&
    (b.needsProfile === undefined || typeof b.needsProfile === "boolean") &&
    (b.forcedLoginMethod === undefined ||
      nullableString(b.forcedLoginMethod)) &&
    (b.authOptions === undefined ||
      (isRecord(b.authOptions) &&
        [
          b.authOptions.passwordEnabled,
          b.authOptions.smsEnabled,
          b.authOptions.recoveryEnabled,
        ].every((flag) => typeof flag === "boolean"))) &&
    Array.isArray(b.plugins) &&
    b.plugins.every(
      (p) =>
        isRecord(p) &&
        typeof p.id === "string" &&
        typeof p.version === "string",
    ) &&
    Array.isArray(value.documents) &&
    value.documents.length <= maxDocuments &&
    value.documents.every(
      (entry) =>
        isRecord(entry) &&
        isRecord(entry.detail) &&
        validResource(entry.detail.resource) &&
        entry.detail.resource.kind === "document" &&
        entry.detail.resource.deleted_at === null &&
        entry.detail.resource.role !== "none" &&
        Array.isArray(entry.detail.comments) &&
        entry.detail.comments.length === 0 &&
        Array.isArray(entry.detail.grants) &&
        entry.detail.grants.length === 0 &&
        typeof entry.detail.ownerName === "string" &&
        nullableString(entry.detail.lastEditorName) &&
        nullableString(entry.detail.lastEditedAt) &&
        typeof entry.detail.likes === "number" &&
        typeof entry.detail.liked === "boolean" &&
        typeof entry.detail.favorite === "boolean" &&
        typeof entry.detail.pinned === "boolean" &&
        (entry.library === null ||
          (validResource(entry.library) &&
            entry.library.kind === "library" &&
            entry.library.id === entry.detail.resource.library_id)),
    )
  );
}
function readCache(): StartupCache | null {
  try {
    const raw = localStorage.getItem(documentStartupCacheKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validCache(value) ? value : null;
  } catch {
    return null;
  }
}
function writeCache(value: StartupCache) {
  try {
    // Unknown/corrupt formats are left intact. No conversion or missing-field defaults.
    if (localStorage.getItem(documentStartupCacheKey) && !readCache()) return;
    localStorage.setItem(documentStartupCacheKey, JSON.stringify(value));
  } catch {
    /* Startup metadata is optional; the durable Yjs outbox is separate. */
  }
}

/** Display metadata only. No credentials, document projection or duplicate save channel. */
export function cacheStartupBootstrap(bootstrap: Bootstrap) {
  if (!bootstrap.user) {
    clearDocumentStartupCache();
    return;
  }
  if (!Array.isArray(bootstrap.plugins)) return;
  const previous = readCache();
  if (previous && previous.bootstrap.user?.id !== bootstrap.user.id)
    invalidateStartupIdentity();
  const value: StartupCache = {
    version: 1,
    bootstrap: {
      siteName: bootstrap.siteName,
      initialized: bootstrap.initialized,
      registrationEnabled: bootstrap.registrationEnabled,
      defaultLocale: bootstrap.defaultLocale,
      defaultTimezone: bootstrap.defaultTimezone,
      needsProfile: bootstrap.needsProfile,
      forcedLoginMethod: bootstrap.forcedLoginMethod,
      authOptions: bootstrap.authOptions,
      capabilities: bootstrap.capabilities,
      plugins: bootstrap.plugins.map(({ id, version }) => ({ id, version })),
      user: {
        id: bootstrap.user.id,
        display_name: bootstrap.user.display_name,
        public_id: bootstrap.user.public_id,
        admin: !!bootstrap.user.admin,
      },
    },
    documents:
      previous?.bootstrap.user?.id === bootstrap.user.id
        ? previous.documents
        : [],
  };
  if (validCache(value)) writeCache(value);
}

export function cacheStartupDocument(
  userId: string,
  detail: Detail,
  library: Resource | null,
) {
  const cache = readCache();
  if (
    !cache ||
    cache.bootstrap.user?.id !== userId ||
    detail.resource.kind !== "document" ||
    detail.resource.deleted_at !== null ||
    detail.resource.role === "none"
  )
    return;
  const entry = {
    detail: {
      resource: detail.resource,
      ownerName: detail.ownerName,
      lastEditorName: detail.lastEditorName,
      lastEditedAt: detail.lastEditedAt,
      likes: detail.likes,
      liked: detail.liked,
      favorite: detail.favorite,
      pinned: detail.pinned,
      comments: [],
      grants: [],
      commentsNextCursor: null,
    },
    library: library?.id === detail.resource.library_id ? library : null,
  };
  const value: StartupCache = {
    ...cache,
    documents: [
      entry,
      ...cache.documents.filter(
        (item) => item.detail.resource.id !== detail.resource.id,
      ),
    ].slice(0, maxDocuments),
  };
  if (validCache(value)) writeCache(value);
}

export function readDocumentStartup(hash: string) {
  const id = /^#\/(?:m\/)?r\/([a-f0-9-]{36})(?:\?|$)/.exec(hash)?.[1];
  const cache = readCache();
  if (!id || !cache) return null;
  const entry = cache.documents.find((item) => item.detail.resource.id === id);
  return entry ? { bootstrap: cache.bootstrap, ...entry } : null;
}

export function readStartupAccount() {
  return readCache()?.bootstrap.user?.id;
}

export function forgetStartupDocument(id: string) {
  const cache = readCache();
  if (cache)
    writeCache({
      ...cache,
      documents: cache.documents.filter(
        (entry) => entry.detail.resource.id !== id,
      ),
    });
}

/** Logout/revocation hides metadata, without deleting checkpoints or pending edits. */
export function clearDocumentStartupCache() {
  invalidateStartupIdentity();
  try {
    if (readCache()) localStorage.removeItem(documentStartupCacheKey);
  } catch {}
}
