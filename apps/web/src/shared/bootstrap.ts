import { api, type Bootstrap } from "./api.js";
import { startupIdentityRevision } from "./document-startup-cache.js";

let pending: Promise<Bootstrap> | undefined;
let loaded: Bootstrap | undefined;
let loadedIdentityRevision: number | undefined;
/** Share the live startup request between plugin discovery and the application. */
export function loadBootstrap(refresh = false): Promise<Bootstrap> {
  if (
    !refresh &&
    loaded &&
    loadedIdentityRevision === startupIdentityRevision()
  )
    return Promise.resolve(loaded);
  if (!pending) {
    pending = api<Bootstrap>(
      "/bootstrap",
      "GET",
      undefined,
      AbortSignal.timeout(10000),
    )
      .then((value) => {
        loaded = value;
        loadedIdentityRevision = startupIdentityRevision();
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}
