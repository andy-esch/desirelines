/** sessionStorage key used to track whether a chunk-error reload has already been attempted. */
const RELOAD_KEY = "chunk-load-reload";

/**
 * Detect stale chunk load errors and trigger a one-time page reload.
 *
 * After a new deploy, users with cached pages may request JS chunk URLs that
 * no longer exist. Firebase's catch-all rewrite returns `index.html` (HTML)
 * instead of 404, causing errors like:
 * - "Failed to fetch dynamically imported module"
 * - "is not a valid JavaScript MIME type"
 * - "Importing a module script failed"
 *
 * This function checks for those error signatures and calls
 * `window.location.reload()` so the browser fetches the latest `index.html`
 * with up-to-date chunk references.
 *
 * A sessionStorage guard prevents infinite reload loops — if a reload was
 * already attempted this session, the error is re-thrown so the error
 * boundary can display it normally.
 *
 * @param error - The error caught by the route error boundary.
 * @returns `true` if a reload was triggered (page is navigating away).
 * @throws Re-throws the original error if it is not a chunk load error
 *   or if a reload was already attempted.
 */
export function handleChunkLoadError(error: unknown): true {
  const isChunkError =
    error instanceof Error &&
    (error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("is not a valid JavaScript MIME type") ||
      error.message.includes("Importing a module script failed"));

  if (isChunkError) {
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      // Set the guard *before* reloading. Because reload() is non-blocking,
      // we return immediately to prevent any further execution (including
      // clearing the guard) before the page actually reloads.
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
      return true;
    }
    // Reload was already attempted and the error persists — clear the guard
    // so a future deploy can trigger a fresh reload, then fall through to
    // throw the error for the error boundary to display.
    sessionStorage.removeItem(RELOAD_KEY);
  }

  throw error;
}
