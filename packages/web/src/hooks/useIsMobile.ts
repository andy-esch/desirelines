import { useMediaQuery } from "./useMediaQuery";

// Below Tailwind's `sm` breakpoint (640px) — i.e. phone-width, where the routes
// map uses the bottom-sheet / bottom-dock layout instead of the desktop panels.
const QUERY = "(max-width: 639px)";

/**
 * Returns true on phone-width (sub-`sm`) viewports.
 *
 * Listens for media-query changes so it updates live on rotation / resize.
 * SSR-safe: returns `false` when `window` is unavailable. Mirrors
 * {@link useReducedMotion}.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(QUERY);
}
