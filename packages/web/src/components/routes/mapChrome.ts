import type { CSSProperties } from "react";

/**
 * Scoped token override for the routes-map drawers. Remapping `--color-accent-cyan` on
 * the drawer re-tints everything that resolves through it — the drawer accents AND the
 * Base UI primitives inside (Slider/ToggleGroup paint with `--color-primary` →
 * `accent-cyan`) — to `--color-map-chrome-accent`, scoped to the map only.
 *
 * Each theme block sets `--color-map-chrome-accent` (vivid neon on dark themes, the
 * readable interactive accent on light ones), so this stays a single constant rather
 * than a per-theme branch. Magenta accents use the theme-aware `accent-magenta` token.
 */
export const MAP_CHROME_STYLE = {
  "--color-accent-cyan": "var(--color-map-chrome-accent)",
} as CSSProperties;
