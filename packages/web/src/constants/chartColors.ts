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
  AVERAGE_LINE: "var(--color-chart-average-line)",
} as const;

/**
 * Goal Colors - Neon Theme
 *
 * Semantic progression from cool (conservative goals) to warm (stretch goals)
 * Array of colors for up to 5 goals.
 * Used consistently across all chart components.
 */
export const GOAL_COLORS = [
  "var(--color-goal-1)", // Electric Cyan (conservative)
  "var(--color-goal-2)", // Neon Green-Cyan (moderate)
  "var(--color-goal-3)", // Bright Magenta (target)
  "var(--color-goal-4)", // Neon Yellow-Orange (ambitious)
  "var(--color-goal-5)", // Neon Pink-Red (stretch)
] as const;

/** Prior year ghost line styling: the neutral, at a fading opacity per year back */
export const PRIOR_YEAR_COLOR = "var(--color-chart-neutral)";
export const PRIOR_YEAR_OPACITY_START = 0.45;
export const PRIOR_YEAR_OPACITY_STEP = 0.07;
