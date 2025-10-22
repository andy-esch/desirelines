/**
 * Chart Color Constants
 *
 * Centralized color definitions for chart visualizations.
 * These colors are used across DistanceChart and PacingChart components.
 */

export const CHART_COLORS = {
  // Actual data line (black with transparency)
  ACTUAL_DATA_LINE: "rgb(0, 0, 0, 0.8)",
  ACTUAL_DATA_FILL: "rgb(0, 0, 0, 0.5)",

  // Goal lines
  LOWER_GOAL_LINE: "rgb(0, 255, 255)", // Cyan
  UPPER_GOAL_LINE: "rgb(255, 0, 255)", // Magenta

  // Average pacing line (only in DistanceChart)
  AVERAGE_LINE: "rgb(255, 95, 31)", // Orange
} as const;

/**
 * Goal Colors - Neon Theme
 *
 * Semantic progression from cool (conservative goals) to warm (stretch goals)
 * Array of colors for up to 5 goals.
 * Used consistently across all chart components.
 */
export const GOAL_COLORS = [
  "rgb(0, 255, 255)", // Electric Cyan (conservative)
  "rgb(0, 255, 128)", // Neon Green-Cyan (moderate)
  "rgb(255, 0, 255)", // ✨ BRIGHT MAGENTA ✨ (target)
  "rgb(255, 200, 0)", // Neon Yellow-Orange (ambitious)
  "rgb(255, 0, 128)", // Neon Pink-Red (stretch)
] as const;
