/**
 * Axios's definition of an absolute URL: scheme + "//" or protocol-relative "//".
 * Mirrors `isAbsoluteURL` in axios's source (helpers/isAbsoluteURL.js). We must
 * use the same predicate axios uses so this function's classification matches
 * where axios will actually send the request.
 */
const AXIOS_ABSOLUTE_URL_REGEX = /^([a-z][a-z\d+\-.]*:)?\/\//i;

/**
 * Checks if a request URL is targeted at our own API gateway.
 * Absolute URLs to other domains must not receive the auth token.
 *
 * Supports both absolute baseURLs (e.g. "https://api.example.com/v1") and
 * same-origin relative baseURLs (e.g. "/api/v1"). A relative baseURL is
 * resolved against window.location.origin before comparison.
 *
 * ---
 * This function must mirror axios's URL handling, NOT WHATWG URL resolution
 * (used by `fetch` with a Request object). The two differ in two places that
 * both affect security-critical auth-token attachment:
 *
 * 1. **Trailing-slash handling on the base.** For `baseURL: "https://api.com/v1"`
 *    and `url: "users"`, axios sends to `https://api.com/v1/users`. WHATWG
 *    would treat "v1" as a file and produce `https://api.com/users`. We fix
 *    this by appending a trailing slash to the base before resolving.
 *
 * 2. **Leading-slash paths are NOT absolute in axios.** For
 *    `baseURL: "https://api.com/v1"` and `url: "/users"`, axios's
 *    `combineURLs` strips the leading slash and produces
 *    `https://api.com/v1/users`. WHATWG would treat "/users" as an
 *    absolute-path reference and replace the base path entirely, producing
 *    `https://api.com/users`. We fix this by stripping leading slashes from
 *    non-absolute request URLs before resolving. Truly absolute URLs (matching
 *    AXIOS_ABSOLUTE_URL_REGEX — scheme+`//` or protocol-relative `//`) bypass
 *    this normalization and are resolved directly, so cross-origin URLs are
 *    still correctly classified as external.
 *
 * See `node_modules/axios/lib/helpers/combineURLs.js` and
 * `node_modules/axios/lib/helpers/isAbsoluteURL.js` for the source of truth.
 */
export function isInternalRequest(url?: string, baseURL?: string): boolean {
  if (!url) return true;

  try {
    const appOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";

    // Resolve baseURL to an absolute URL object once. If baseURL is already
    // absolute this is a no-op; if it's relative (e.g. "/api/v1"), it resolves
    // against the current app origin so it represents a same-origin subpath.
    const base = baseURL ? new URL(baseURL, appOrigin) : undefined;

    const isAxiosAbsolute = AXIOS_ABSOLUTE_URL_REGEX.test(url);

    if (!base) {
      // No baseURL: only safely internal if the resolved request URL is
      // same-origin as the app. (In SSR there is no window, so we can't tell.)
      if (typeof window === "undefined") return false;
      const req = new URL(url, appOrigin);
      return req.origin === appOrigin;
    }

    let req: URL;
    if (isAxiosAbsolute) {
      // Axios would leave this URL untouched (no baseURL combining). Resolve
      // against appOrigin so protocol-relative URLs ("//host/path") pick up a
      // scheme; fully absolute URLs ignore the base.
      req = new URL(url, appOrigin);
    } else {
      // Axios would combine this URL with baseURL via combineURLs: strip
      // leading slashes from the request URL, ensure base ends with "/", and
      // concatenate. Mirror exactly.
      const baseStr = base.toString();
      const resolveAgainst = baseStr.endsWith("/") ? baseStr : baseStr + "/";
      const strippedUrl = url.replace(/^\/+/, "");
      req = new URL(strippedUrl, resolveAgainst);
    }

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
