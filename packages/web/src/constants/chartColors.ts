/**
 * Chart Color Constants
 *
 * Centralized color definitions for chart visualizations.
 * Used by CumulativeMetricsChart and PacingMetricsChart components.
 */

export const CHART_COLORS = {
  /** Actual data line; each theme sets its color, and its glow is `--chart-actual-glow` */
  ACTUAL_DATA_LINE: "var(--color-chart-actual-line)",

  /** Average pacing line in the cumulative chart: a dashed neutral in the retro themes */
  AVERAGE_LINE: "var(--color-chart-average-line)",
} as const;

/**
 * Goal colors for up to 5 goals, running cool (conservative) to warm (stretch). Each theme
 * sets its own five, and themeCss.test.ts keeps them apart from each other. Used
 * consistently across all chart components.
 */
export const GOAL_COLORS = [
  "var(--color-goal-1)", // conservative
  "var(--color-goal-2)",
  "var(--color-goal-3)",
  "var(--color-goal-4)",
  "var(--color-goal-5)", // stretch
] as const;

/** Prior year ghost line styling: the neutral, at a fading opacity per year back */
export const PRIOR_YEAR_COLOR = "var(--color-chart-neutral)";
export const PRIOR_YEAR_OPACITY_START = 0.45;
export const PRIOR_YEAR_OPACITY_STEP = 0.07;
