import { useState, useEffect } from "react";

/**
 * Subscribe to a CSS media query and re-render when it changes.
 *
 * SSR-safe: returns `false` when `window` is unavailable, both for the initial
 * value and for the subscription.
 *
 * Behaviour is byte-for-byte what `useIsMobile` and `useReducedMotion` each did
 * before this extraction — including the gap where a change between the
 * `useState` initializer and the effect subscribing is missed. Adding a mount
 * re-sync would close that, but it is a behaviour change and this sweep is
 * strictly behaviour-preserving; it belongs in its own commit.
 *
 * @param query - A media query string, e.g. `"(max-width: 639px)"`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
