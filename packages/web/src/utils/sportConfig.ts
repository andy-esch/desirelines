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
 * @see chartColors.ts - For goal/chart line colors
 * @see uiColors.ts - For UI element colors (toned down)
 */

import type { SportConfig } from "../api/activities";
export type { SportConfig };

/**
 * Sport colors for chart visualizations (sparklines, etc.)
 *
 * Grouped by category for visual coherence:
 * - Endurance: Cyan/Blue family
 * - Outdoor/Adventure: Green/Teal family
 * - Fitness/Mind-Body: Magenta/Pink family
 * - Ball/Racket Sports: Yellow/Orange family
 * - Alternative Transport: Purple family
 *
 * Colors are NEON (full brightness) to match chart color philosophy.
 * Each color is distinct and readable on both light and dark backgrounds.
 */
export const SPORT_COLORS: Record<string, string> = {
  // Endurance - Cyan/Blue family
  cycling: "rgb(0, 255, 255)", // Electric Cyan
  running: "rgb(0, 200, 255)", // Sky Blue
  swimming: "rgb(0, 150, 255)", // Ocean Blue
  ebike: "rgb(100, 220, 255)", // Light Cyan

  // Outdoor/Adventure - Green/Teal family
  hiking: "rgb(0, 255, 128)", // Neon Green
  walking: "rgb(100, 255, 150)", // Light Green
  winter_sports: "rgb(150, 255, 200)", // Mint
  watersports: "rgb(0, 200, 180)", // Teal

  // Fitness/Mind-Body - Magenta/Pink family
  yoga: "rgb(255, 0, 255)", // Magenta
  workout: "rgb(255, 100, 200)", // Hot Pink
  climbing: "rgb(200, 50, 255)", // Purple-Pink

  // Ball/Racket Sports - Yellow/Orange family
  racket_sports: "rgb(255, 200, 0)", // Neon Yellow
  team_sports: "rgb(255, 150, 50)", // Orange
  golf: "rgb(200, 255, 100)", // Lime

  // Alternative Transport - Purple family
  skating: "rgb(180, 100, 255)", // Lavender
  wheelchair: "rgb(150, 150, 255)", // Periwinkle
} as const;

/**
 * Darker versions of sport colors for text labels on light backgrounds.
 * These maintain the hue but reduce brightness for readability.
 */
export const SPORT_TEXT_COLORS: Record<string, string> = {
  // Endurance
  cycling: "rgb(0, 160, 160)",
  running: "rgb(0, 130, 180)",
  swimming: "rgb(0, 100, 180)",
  ebike: "rgb(60, 150, 180)",

  // Outdoor/Adventure
  hiking: "rgb(0, 160, 80)",
  walking: "rgb(60, 160, 90)",
  winter_sports: "rgb(90, 160, 120)",
  watersports: "rgb(0, 130, 120)",

  // Fitness/Mind-Body
  yoga: "rgb(180, 0, 180)",
  workout: "rgb(180, 60, 140)",
  climbing: "rgb(140, 30, 180)",

  // Ball/Racket Sports
  racket_sports: "rgb(180, 140, 0)",
  team_sports: "rgb(180, 100, 30)",
  golf: "rgb(130, 170, 60)",

  // Alternative Transport
  skating: "rgb(120, 60, 180)",
  wheelchair: "rgb(100, 100, 180)",
} as const;

/** Fallback color for unknown sports */
export const DEFAULT_SPORT_COLOR = "rgb(150, 150, 150)";
export const DEFAULT_SPORT_TEXT_COLOR = "rgb(100, 100, 100)";

/**
 * Get the chart color for a sport.
 *
 * @param sport - Sport key (e.g., "cycling", "yoga")
 * @returns RGB color string for chart use
 */
export function getSportColor(sport: string): string {
  return SPORT_COLORS[sport] ?? DEFAULT_SPORT_COLOR;
}

/**
 * Get the text color for a sport (darker, for labels on light backgrounds).
 *
 * @param sport - Sport key (e.g., "cycling", "yoga")
 * @returns RGB color string for text use
 */
export function getSportTextColor(sport: string): string {
  return SPORT_TEXT_COLORS[sport] ?? DEFAULT_SPORT_TEXT_COLOR;
}

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
