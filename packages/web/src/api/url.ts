/**
 * Checks if a request URL is targeted at our own API gateway.
 * Absolute URLs to other domains must not receive the auth token.
 *
 * Supports both absolute baseURLs (e.g. "https://api.example.com/v1") and
 * same-origin relative baseURLs (e.g. "/api/v1"). A relative baseURL is
 * resolved against window.location.origin before comparison.
 */
export function isInternalRequest(url?: string, baseURL?: string): boolean {
  if (!url) return true;

  try {
    const appOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";

    // Resolve baseURL to an absolute URL. If baseURL is already absolute this is
    // a no-op; if it's relative (e.g. "/api/v1"), we resolve it against the
    // current app origin so it represents a same-origin subpath.
    const absoluteBase = baseURL ? new URL(baseURL, appOrigin).toString() : undefined;

    // For relative request URLs, we need a base to resolve against. If baseURL
    // doesn't end in a slash, append one so a relative path like "users"
    // resolves under the base path rather than replacing its last segment.
    let resolveAgainst = absoluteBase || appOrigin;
    if (absoluteBase && !absoluteBase.endsWith("/")) {
      resolveAgainst += "/";
    }

    const req = new URL(url, resolveAgainst);

    if (!absoluteBase) {
      // If no baseURL is provided, we can only safely assume it's internal if it's the same origin as the app
      return typeof window !== "undefined" && req.origin === window.location.origin;
    }

    const base = new URL(absoluteBase);

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
