import { useState, useEffect } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Returns true when the user prefers reduced motion.
 *
 * Listens for changes to the `prefers-reduced-motion` media query so
 * the value updates in real time if the user toggles their OS setting.
 *
 * SSR-safe: returns `false` when `window` is not available.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(QUERY);
    const handler = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reducedMotion;
}
