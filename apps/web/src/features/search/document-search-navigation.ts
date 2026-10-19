/** Navigation intent only: never stored in document content or collaboration state. */
export function searchDocumentHash(
  resource: { id: string; kind: string },
  query: string,
): string {
  const path = `#/r/${resource.id}`;
  return resource.kind === "document" && query.trim()
    ? `${path}?${new URLSearchParams({ find: query.trim() })}`
    : path;
}

export function documentSearchQuery(
  hash: string,
  documentId: string,
): string | null {
  const split = hash.indexOf("?");
  const path = split < 0 ? hash : hash.slice(0, split);
  if (path !== `#/r/${documentId}` && path !== `#/m/r/${documentId}`)
    return null;
  const query = new URLSearchParams(split < 0 ? "" : hash.slice(split + 1)).get(
    "find",
  );
  return query?.trim() || null;
}

export function openSearchDocument(
  resource: { id: string; kind: string },
  query: string,
): void {
  openSearchTarget(searchDocumentHash(resource, query));
}

export function openSearchTarget(path: string): void {
  const hash = path.startsWith("#") ? path : `#${path}`;
  if (window.location.hash === hash) {
    // Selecting the current target must still notify navigation listeners.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else window.location.hash = hash;
}
