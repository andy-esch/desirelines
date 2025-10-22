/**
 * Training momentum calculation utilities
 *
 * Calculates training momentum by analyzing the slope of daily pacing over
 * a lookback period. Uses linear regression to determine if pace is
 * accelerating, steady, or declining.
 */

import type { DistanceEntry } from "../types/activity";
import { TRAINING_CONSTANTS } from "../constants/training";

/**
 * Filters out extended data (consecutive days with identical distance).
 * Extended data represents days with no activity and shouldn't affect momentum.
 *
 * @param distanceData - Full distance data including extended entries
 * @returns Filtered data containing only days with actual activity
 */
export function filterActualActivityData(
  distanceData: DistanceEntry[]
): DistanceEntry[] {
  const actualData: DistanceEntry[] = [];

  for (let i = 0; i < distanceData.length; i++) {
    // Include first point always
    if (i === 0) {
      actualData.push(distanceData[i]);
      continue;
    }

    // Include point if distance changed from previous day (indicates real activity)
    if (distanceData[i].y !== distanceData[i - 1].y) {
      actualData.push(distanceData[i]);
    }
  }

  return actualData;
}

/**
 * Calculates daily pace (miles per day) between consecutive data points
 *
 * @param data - Distance data entries
 * @returns Array of daily pace values
 */
export function calculateDailyPaces(data: DistanceEntry[]): number[] {
  const dailyPaces: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const prevDistance = data[i - 1].y;
    const currDistance = data[i].y;
    const prevDate = new Date(data[i - 1].x).getTime();
    const currDate = new Date(data[i].x).getTime();
    const daysDiff = (currDate - prevDate) / (1000 * 60 * 60 * 24);

    if (daysDiff > 0) {
      dailyPaces.push((currDistance - prevDistance) / daysDiff);
    }
  }

  return dailyPaces;
}

/**
 * Performs simple linear regression on a dataset
 *
 * @param values - Y-values (X-values are assumed to be indices: 0, 1, 2, ...)
 * @returns Object containing slope and intercept, or null if insufficient data
 */
export function calculateLinearRegression(values: number[]): {
  slope: number;
  intercept: number;
} | null {
  const n = values.length;
  if (n < TRAINING_CONSTANTS.PACE.MIN_DATA_POINTS) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  // Slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Intercept = (Σy - slope*Σx) / n
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/**
 * Calculates training momentum as percentage change in pace per week
 *
 * Momentum is calculated by:
 * 1. Filtering out extended (flat-line) data
 * 2. Looking back N days of actual activity
 * 3. Computing daily paces between consecutive activities
 * 4. Applying linear regression to find pace trend
 * 5. Converting slope to weekly percentage change relative to average pace
 *
 * @param distanceData - Full distance data (may include extended entries)
 * @param averagePace - Current average pace (miles/day) for relativization
 * @param lookbackDays - Number of activity days to analyze (default: 14)
 * @returns Weekly percentage change in pace, or null if insufficient data
 *
 * @example
 * // If pace is increasing by 2% per week:
 * calculateTrainingMomentum(data, 10.0) // Returns ~2.0
 *
 * // If pace is declining by 3% per week:
 * calculateTrainingMomentum(data, 10.0) // Returns ~-3.0
 */
export function calculateTrainingMomentum(
  distanceData: DistanceEntry[],
  averagePace: number,
  lookbackDays: number = TRAINING_CONSTANTS.MOMENTUM.LOOKBACK_DAYS
): number | null {
  if (distanceData.length < TRAINING_CONSTANTS.PACE.MIN_DATA_POINTS) {
    return null;
  }

  if (averagePace === 0) {
    return null;
  }

  // Filter out extended data (consecutive days with identical distance)
  const actualData = filterActualActivityData(distanceData);

  if (actualData.length < TRAINING_CONSTANTS.PACE.MIN_DATA_POINTS) {
    return null;
  }

  // Get last N days of ACTUAL activity data (or all if less than N days)
  const recentData = actualData.slice(-Math.min(lookbackDays, actualData.length));

  if (recentData.length < TRAINING_CONSTANTS.PACE.MIN_DATA_POINTS) {
    return null;
  }

  // Calculate daily pace for each day
  const dailyPaces = calculateDailyPaces(recentData);

  if (dailyPaces.length < TRAINING_CONSTANTS.PACE.MIN_DATA_POINTS) {
    return null;
  }

  // Linear regression: calculate slope of pacing line
  const regression = calculateLinearRegression(dailyPaces);

  if (!regression) {
    return null;
  }

  // Make it relative to current pace (percentage change per day)
  const relativeSlope = (regression.slope / averagePace) * 100;

  // Convert to weekly percentage change for more intuitive reading
  return relativeSlope * 7;
}

/**
 * Training momentum levels based on weekly percentage change
 */
export type MomentumLevel =
  | "significantly-up"
  | "up"
  | "steady"
  | "down"
  | "significantly-down"
  | "stale"
  | null;

/**
 * Categorizes training momentum into discrete levels
 *
 * @param momentum - Weekly percentage change (from calculateTrainingMomentum)
 * @param isStale - Whether activity data is stale (no recent activities)
 * @returns Categorized momentum level
 */
export function getMomentumLevel(
  momentum: number | null,
  isStale: boolean
): MomentumLevel {
  if (momentum === null) return null;
  if (isStale) return "stale";

  const { THRESHOLDS } = TRAINING_CONSTANTS.MOMENTUM;

  if (momentum > THRESHOLDS.SIGNIFICANTLY_UP) return "significantly-up";
  if (momentum > THRESHOLDS.UP) return "up";
  if (momentum >= THRESHOLDS.STEADY) return "steady";
  if (momentum >= THRESHOLDS.DOWN) return "down";
  return "significantly-down";
}
