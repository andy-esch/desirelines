/**
 * Chart Color Constants
 *
 * Centralized color definitions for chart visualizations, as references to theme tokens.
 * The goal colors also mark goals outside the charts (goal controls, the goal table).
 */

import { alpha } from "../utils/colorTokens";

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

/**
 * A prior year's ghost line: the neutral at 45% for last year, keeping two thirds of that for
 * each year further back (30%, 20%, 13%, 9%). The design fades the two years it shows to 45%
 * and 30%; the ratio carries on so the oldest of the five years shown stays visible.
 *
 * @param yearsBack - 0 for last year, 1 for the year before, and so on
 */
export function priorYearStroke(yearsBack: number): string {
  return alpha("var(--color-chart-neutral)", Math.round(45 * (2 / 3) ** yearsBack));
}
