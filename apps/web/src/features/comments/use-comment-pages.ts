import { useEffect, useRef } from "react";

/** Load every anchor before the linked rail is scrolled to later document blocks. */
export function useCommentPages(
  resourceId: string,
  open: boolean,
  nextCursor: string | null | undefined,
  loadMore: (() => Promise<void>) | undefined,
  retryKey?: boolean,
) {
  const loader = useRef(loadMore);
  loader.current = loadMore;
  const requested = useRef<string | null>(null);
  // Native markers also load while closed. An explicit drawer toggle still
  // allows a failed page to be requested again, without an automatic retry loop.
  useEffect(() => { requested.current = null; }, [retryKey]);
  useEffect(() => {
    if (!open) {
      requested.current = null;
      return;
    }
    if (nextCursor == null) {
      // A later metadata/detail refresh can return the first server page again.
      // It must be allowed to continue from that cursor a second time.
      requested.current = null;
      return;
    }
    if (!loader.current) return;
    const key = `${resourceId}:${nextCursor}`;
    if (requested.current === key) return;
    requested.current = key;
    // Errors are displayed by the owning request handler. Do not retry a failed
    // cursor indefinitely; reopening the drawer allows another attempt.
    void loader.current().catch(() => {});
  }, [resourceId, open, nextCursor, retryKey]);
}
