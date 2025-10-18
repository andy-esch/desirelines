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
