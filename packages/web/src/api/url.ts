/**
 * Checks if a request URL is targeted at our own API gateway.
 * Absolute URLs to other domains must not receive the auth token.
 */
export function isInternalRequest(url?: string, baseURL?: string): boolean {
  if (!url) return true;

  try {
    // If url is absolute (starts with scheme or //), this will ignore baseOrigin.
    // If url is relative, it will resolve against baseOrigin.
    let baseOrigin =
      baseURL || (typeof window !== "undefined" ? window.location.origin : "http://localhost");

    // If baseURL is provided and doesn't end in a slash, relative URLs might resolve
    // to the parent directory of the last segment. We often want to treat the
    // configured baseURL as a directory.
    if (baseURL && !baseURL.endsWith("/")) {
      baseOrigin += "/";
    }

    const req = new URL(url, baseOrigin);

    if (!baseURL) {
      // If no baseURL is provided, we can only safely assume it's internal if it's the same origin as the app
      return typeof window !== "undefined" && req.origin === window.location.origin;
    }

    const base = new URL(baseURL);

    if (req.origin !== base.origin) return false;

    // Ensure the request path starts with the base path, respecting directory boundaries.
    // We normalize by removing trailing slashes for the comparison.
    const reqPath = req.pathname.replace(/\/$/, "");
    const basePath = base.pathname.replace(/\/$/, "");

    // If basePath is empty (root), then any path on this origin is internal.
    if (basePath === "") return true;

    return reqPath === basePath || reqPath.startsWith(basePath + "/");
  } catch {
    // If URL parsing fails, play it safe and treat as external
    return false;
  }
}
