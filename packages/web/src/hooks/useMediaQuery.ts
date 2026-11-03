import { useCallback, useSyncExternalStore } from "react";

const getServerSnapshot = () => false;

/**
 * Subscribe to a CSS media query and re-render when it changes.
 *
 * The value is read through `useSyncExternalStore`, which re-reads
 * `matchMedia(query).matches` after subscribing, so a change between the first
 * render and the subscription is not missed.
 *
 * SSR-safe: returns `false` when `window` is unavailable, both for the initial
 * value and for the subscription.
 *
 * @param query - A media query string, e.g. `"(max-width: 639px)"`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );
  const getSnapshot = () =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
