/**
 * Checks if a request URL is targeted at our own API gateway.
 * Absolute URLs to other domains must not receive the auth token.
 */
export function isInternalRequest(url?: string, baseURL?: string): boolean {
  if (!url) return true;

  // Relative URLs are always internal
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("//")) {
    return true;
  }

  if (!baseURL) return false;

  try {
    const req = new URL(url, baseURL);
    const base = new URL(baseURL);

    if (req.origin !== base.origin) return false;

    // Ensure the request path starts with the base path, respecting directory boundaries.
    const reqPath = req.pathname.replace(/\/$/, "");
    const basePath = base.pathname.replace(/\/$/, "");

    return reqPath === basePath || reqPath.startsWith(basePath + "/");
  } catch {
    // If URL parsing fails, play it safe and treat as external
    return false;
  }
}
