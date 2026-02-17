/**
 * Chart Color Constants
 *
 * Centralized color definitions for chart visualizations.
 * Used by CumulativeMetricsChart and PacingMetricsChart components.
 */

export const CHART_COLORS = {
  /** Actual data line — uses CSS variable to flip between dark/light themes */
  ACTUAL_DATA_LINE: "var(--color-chart-actual-line)",

  /** Average pacing line (orange, used in CumulativeMetricsChart) */
  AVERAGE_LINE: "rgb(255, 95, 31)",
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
  "rgb(255, 0, 255)", // Bright Magenta (target)
  "rgb(255, 200, 0)", // Neon Yellow-Orange (ambitious)
  "rgb(255, 0, 128)", // Neon Pink-Red (stretch)
] as const;
