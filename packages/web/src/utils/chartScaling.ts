/**
 * Chart Scaling Utilities
 *
 * Centralizes logic for calculating Y-axis domains, headroom, and realistic caps.
 * Ensures consistent visualization behavior across different chart types.
 */

/**
 * Common configuration for chart scaling
 */
const SCALING_CONFIG = {
  /** Standard headroom multiplier (15% padding) */
  DEFAULT_HEADROOM: 1.15,
  /** Minimal padding for markers (10% padding) */
  MIN_PADDING: 1.1,
  /** Absolute cap for pacing charts (2x the danger threshold) */
  PACING_CAP_MULTIPLIER: 2.0,
  /** Safety multiplier for actual data (ensure we never clip user data) */
  DATA_SAFETY_MULTIPLIER: 1.2,
  /**
   * Threshold proximity required to render the "Zone of Unachievability" overlay.
   * The ZOU only shows when the chart's data range reaches 75% of the danger
   * threshold — at that point a user is close enough that the warning is
   * actionable. Below it, the overlay would only inflate the Y-axis and
   * compress the actually-useful pacing data.
   */
  DANGER_ZONE_PROXIMITY: 0.75,
};

/**
 * Decide whether the "Zone of Unachievability" overlay is worth showing.
 *
 * The overlay is meaningful only when the user's pacing data is approaching
 * the danger threshold. Showing it when the user is comfortably below the
 * threshold stretches the Y-axis to include the line and squashes the data
 * that actually matters.
 */
export function shouldShowDangerZone(
  maxActualPace: number,
  maxGoalPace: number,
  dangerThreshold: number
): boolean {
  if (dangerThreshold === Infinity) return false;
  const maxData = Math.max(maxActualPace, maxGoalPace);
  return maxData >= dangerThreshold * SCALING_CONFIG.DANGER_ZONE_PROXIMITY;
}

/**
 * Round a value up to a "clean" number for axis display.
 * @param value - The raw maximum value
 */
export function roundToCleanMax(value: number): number {
  if (value === 0) return 10;
  if (value < 50) return Math.ceil(value / 5) * 5;
  if (value < 100) return Math.ceil(value / 10) * 10;
  if (value < 500) return Math.ceil(value / 50) * 50;
  if (value < 2000) return Math.ceil(value / 250) * 250;
  if (value < 5000) return Math.ceil(value / 500) * 500;
  return Math.ceil(value / 1000) * 1000;
}

/**
 * Calculate the Y-axis domain maximum for pacing charts.
 *
 * Uses adaptive headroom on the data/goals. Only inflates the axis to include
 * the danger threshold when the threshold will actually be drawn (see
 * `shouldShowDangerZone`) — otherwise the threshold line just compresses the
 * meaningful data into the bottom of the chart.
 */
export function calculatePacingYAxisMax(
  maxActualPace: number,
  maxGoalPace: number,
  dangerThreshold: number
): number {
  const baseMax = Math.max(maxActualPace, maxGoalPace);
  const willShowDangerZone = shouldShowDangerZone(maxActualPace, maxGoalPace, dangerThreshold);

  // If no data/goals, show a sensible default based on danger threshold
  if (baseMax === 0) {
    return dangerThreshold !== Infinity ? dangerThreshold * 1.5 : 30;
  }

  // Use standard headroom for data/goals
  let targetMax = baseMax * SCALING_CONFIG.DEFAULT_HEADROOM;

  // Only stretch to include the danger threshold when the overlay is actually
  // going to render. Otherwise we'd waste vertical space on an invisible line.
  if (willShowDangerZone) {
    targetMax = Math.max(targetMax, dangerThreshold * SCALING_CONFIG.MIN_PADDING);

    // CAP: If required pace is way beyond danger threshold, don't expand indefinitely.
    // Cap at 2x threshold or 1.2x actual max (whichever is higher to avoid clipping data).
    const absoluteCap = Math.max(
      dangerThreshold * SCALING_CONFIG.PACING_CAP_MULTIPLIER,
      maxActualPace * SCALING_CONFIG.DATA_SAFETY_MULTIPLIER
    );
    targetMax = Math.min(targetMax, absoluteCap);
  }

  return targetMax;
}

/**
 * Calculate the Y-axis domain maximum for cumulative charts.
 * Primarily uses tiered rounding to create clean axis values.
 */
export function calculateCumulativeYAxisMax(dataMax: number): number {
  // Cumulative charts usually just need clean rounding of the max value
  // since they are additive and don't have "realistic caps" in the same way.
  return roundToCleanMax(dataMax);
}
