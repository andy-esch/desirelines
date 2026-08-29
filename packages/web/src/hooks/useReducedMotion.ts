import { useMediaQuery } from "./useMediaQuery";

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
  return useMediaQuery(QUERY);
}
