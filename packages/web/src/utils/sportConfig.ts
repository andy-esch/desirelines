/**
 * Sport Configuration Utilities
 *
 * Provides helpers for working with sport configuration data:
 * - Sport colors for charts/visualizations
 * - Display name resolution
 * - Primary metric determination
 *
 * DESIGN DECISIONS:
 * - Colors use NEON theme for charts (full brightness, high contrast)
 * - Colors grouped by sport category for visual coherence
 * - Helpers are pure functions for easy testing
 * - `getPrimaryMetric` has reserved parameter for future user preferences
 *
 * @see constants/chartColors.ts - For goal/chart line colors
 */

import type { SportConfig } from "../api/activities";
export type { SportConfig };

/** Subset of sport category properties used for data generation. */
export interface SportMetricsInfo {
  hasDistance?: boolean;
  hasElevation?: boolean;
}

/**
 * Per-sport identity colors — one sport, one color, everywhere.
 *
 * This is the app's single sport palette: charts, chips, `/activities` badges, the
 * dashboard sparklines, the goals list, and the map all read from it. A sport's color
 * is fixed, never derived from its rank among whichever sports happen to be visible,
 * so changing the filter never repaints the sports that remain.
 *
 * DESIGN NOTES
 *
 * Full-brightness NEON, deliberately. Light-mode legibility is earned with neutral
 * labels and dark outlines (see `--color-chart-mark-outline`), never by dimming these
 * — muting the palette was explicitly rejected.
 *
 * Colors are NOT grouped by sport family. The previous grouping (cyan endurance, green
 * outdoor, magenta fitness…) is exactly what made the palette fail for colorblind
 * users: same-family hues collapse together. Worst case was yoga vs. wheelchair at
 * 1.1 ΔE under deuteranopia — indistinguishable.
 *
 * These values were computed, not picked by eye: greedy farthest-point selection over a
 * full-saturation neon gamut, maximizing the *worst-case* CIE76 ΔE across normal vision,
 * deuteranopia, and protanopia simultaneously. Every one of the 120 pairs clears
 * 15.3 ΔE. `swimming` and `walking` are additionally constrained to blue and green hue
 * bands so they stay intuitive, which cost nothing.
 *
 * The gamut is also floored at 3:1 contrast against the DARK background. Light mode can
 * lean on `--color-chart-mark-outline`, but dark mode has no such fallback — that token
 * resolves to the page ground there — so a mark that is too dark has nothing to save it.
 * The tightest is watersports at 3.10:1.
 *
 * The five sports below marked "anchor" are pinned to the values the dashboard sparkline
 * already showed, so that panel is unchanged by the move to fixed colors.
 *
 * If you change a value here, re-check colorblind separation — the constraint is not
 * visible by looking at the palette in normal vision.
 */
export const SPORT_COLORS: Record<string, string> = {
  cycling: "rgb(255, 0, 255)", // Magenta        (anchor)
  ebike: "rgb(235, 0, 152)", // Deep Pink — next to cycling, its parent sport
  running: "rgb(0, 255, 255)", // Electric Cyan  (anchor)
  walking: "rgb(102, 255, 186)", // Mint
  hiking: "rgb(255, 200, 0)", // Neon Yellow    (anchor)
  swimming: "rgb(0, 129, 235)", // Ocean Blue
  yoga: "rgb(0, 255, 128)", // Neon Green     (anchor)
  workout: "rgb(255, 95, 31)", // Orange         (anchor)
  watersports: "rgb(138, 20, 255)", // Violet
  winter_sports: "rgb(255, 61, 110)", // Coral
  golf: "rgb(232, 255, 102)", // Lime
  racket_sports: "rgb(255, 255, 20)", // Acid Yellow
  team_sports: "rgb(255, 61, 71)", // Red
  skating: "rgb(233, 143, 255)", // Orchid
  climbing: "rgb(235, 0, 211)", // Fuchsia
  wheelchair: "rgb(20, 255, 220)", // Aqua
} as const;

/** Fallback color for unknown sports */
export const DEFAULT_SPORT_COLOR = "rgb(150, 150, 150)";

/**
 * Get the display name for a sport from config.
 *
 * @param sport - Sport key (e.g., "cycling")
 * @param sportConfig - Sport configuration from API
 * @returns Display name (e.g., "Cycling") or formatted key as fallback
 */
export function getSportDisplayName(sport: string, sportConfig: SportConfig | null): string {
  if (sportConfig?.sportCategories?.[sport]) {
    return sportConfig.sportCategories[sport].displayName;
  }
  // Fallback: capitalize and replace underscores
  return sport
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get the primary metric for a sport.
 *
 * Currently returns the server-defined primary metric from sport config.
 * The `userPrefs` parameter is reserved for future user-configurable metrics.
 *
 * @param sport - Sport key (e.g., "cycling")
 * @param sportConfig - Sport configuration from API
 * @param _userPrefs - Reserved for future: user's metric preferences per sport
 * @returns Metric key (e.g., "distance_meters", "time_minutes")
 *
 * @example
 * ```ts
 * const metric = getPrimaryMetric("cycling", sportConfig);
 * // Returns "distance_meters"
 *
 * const metric = getPrimaryMetric("yoga", sportConfig);
 * // Returns "time_minutes"
 * ```
 */
export function getPrimaryMetric(
  sport: string,
  sportConfig: SportConfig | null,
  _userPrefs?: Record<string, string>
): string {
  // Future: Check user preferences first
  // if (_userPrefs?.[sport]) {
  //   return _userPrefs[sport];
  // }

  // Use server-defined primary metric
  if (sportConfig?.sportCategories?.[sport]) {
    return sportConfig.sportCategories[sport].primaryMetric;
  }

  // Fallback for unknown sports
  return "distance_meters";
}

/**
 * Check if a sport uses distance as its primary metric.
 *
 * @param sport - Sport key
 * @param sportConfig - Sport configuration from API
 * @returns true if the sport's primary metric is distance-based
 */
export function isDistanceSport(sport: string, sportConfig: SportConfig | null): boolean {
  const metric = getPrimaryMetric(sport, sportConfig);
  return metric === "distance_meters";
}

/**
 * Check if a sport uses time as its primary metric.
 *
 * @param sport - Sport key
 * @param sportConfig - Sport configuration from API
 * @returns true if the sport's primary metric is time-based
 */
export function isTimeSport(sport: string, sportConfig: SportConfig | null): boolean {
  const metric = getPrimaryMetric(sport, sportConfig);
  return metric === "time_minutes";
}

/**
 * Get all available metrics for a sport.
 *
 * @param sport - Sport key
 * @param sportConfig - Sport configuration from API
 * @returns Array of metric keys, or empty array if sport not found
 */
/** Metrics that are internal/non-displayable and should be excluded from the UI */
const INTERNAL_METRICS = new Set(["activity_ids"]);

export function getSportMetrics(sport: string, sportConfig: SportConfig | null): string[] {
  const metrics = sportConfig?.sportCategories?.[sport]?.metrics ?? [];
  return metrics.filter((m) => !INTERNAL_METRICS.has(m));
}

/**
 * Filter visible sports to only those that exist in sport config.
 * This handles the edge case where a user has a sport in preferences
 * that no longer exists in the config.
 *
 * @param visibleSports - Array of sport keys from user preferences
 * @param sportConfig - Sport configuration from API
 * @returns Filtered array of valid sport keys
 */
export function filterValidSports(
  visibleSports: string[],
  sportConfig: SportConfig | null
): string[] {
  if (!sportConfig?.sportCategories) {
    return visibleSports;
  }
  const validKeys = Object.keys(sportConfig.sportCategories);
  return visibleSports.filter((sport) => validKeys.includes(sport));
}
