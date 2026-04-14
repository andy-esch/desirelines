/**
 * Checks if a request URL is targeted at our own API gateway.
 * Absolute URLs to other domains must not receive the auth token.
 *
 * Supports both absolute baseURLs (e.g. "https://api.example.com/v1") and
 * same-origin relative baseURLs (e.g. "/api/v1"). A relative baseURL is
 * resolved against window.location.origin before comparison.
 *
 * ---
 * Why we normalize baseURL with a trailing slash before resolving the request
 * URL: this function must match axios's baseURL concatenation behavior, NOT
 * WHATWG URL resolution (used by `fetch` with a Request object).
 *
 * Axios combines `baseURL + url` with slash handling — for
 * `baseURL: "https://api.com/v1"` and `url: "users"`, axios sends the request
 * to `https://api.com/v1/users`. WHATWG URL resolution would instead treat
 * "v1" as the last path segment and produce `https://api.com/users`.
 *
 * Appending a trailing slash to the base before calling `new URL(url, base)`
 * makes WHATWG resolution mirror axios's behavior, so we correctly classify
 * requests like `client.get("activities")` as internal under `/api/v1`.
 */
export function isInternalRequest(url?: string, baseURL?: string): boolean {
  if (!url) return true;

  try {
    const appOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";

    // Resolve baseURL to an absolute URL object once. If baseURL is already
    // absolute this is a no-op; if it's relative (e.g. "/api/v1"), it resolves
    // against the current app origin so it represents a same-origin subpath.
    const base = baseURL ? new URL(baseURL, appOrigin) : undefined;

    if (!base) {
      // No baseURL: only safely internal if the resolved request URL is
      // same-origin as the app. (In SSR there is no window, so we can't tell.)
      if (typeof window === "undefined") return false;
      const req = new URL(url, appOrigin);
      return req.origin === appOrigin;
    }

    // Normalize base to a directory-style string so WHATWG resolution matches
    // axios's concatenation — see the header comment for the full rationale.
    const baseStr = base.toString();
    const resolveAgainst = baseStr.endsWith("/") ? baseStr : baseStr + "/";

    const req = new URL(url, resolveAgainst);

    if (req.origin !== base.origin) return false;

    // Ensure the request path starts with the base path, respecting directory
    // boundaries. Normalize by stripping trailing slashes before comparing.
    const reqPath = req.pathname.replace(/\/$/, "");
    const basePath = base.pathname.replace(/\/$/, "");

    // If basePath is empty (root), any path on this origin is internal.
    if (basePath === "") return true;

    return reqPath === basePath || reqPath.startsWith(basePath + "/");
  } catch {
    // If URL parsing fails, play it safe and treat as external
    return false;
  }
}
