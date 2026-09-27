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
export function filterActualActivityData(distanceData: DistanceEntry[]): DistanceEntry[] {
  // Keep the first point unconditionally, then any point whose cumulative
  // distance moved from the previous day — a flat step means no activity.
  return distanceData.filter((curr, i) => {
    if (!curr) return false;
    if (i === 0) return true;
    const prev = distanceData[i - 1];
    return prev !== undefined && curr.y !== prev.y;
  });
}

/** A daily pace, placed at the midpoint of the interval it covers, in days since the first entry. */
export interface PacePoint {
  day: number;
  pace: number;
}

/**
 * Calculates the daily pace between consecutive data points in the data's own units
 * (miles/day for distance sports, hours/day for time sports, sessions/day, etc.), each
 * placed at its interval's midpoint so a trend can be measured per day however far apart
 * the activities are.
 *
 * @param data - Cumulative metric entries
 * @returns One point per interval with a positive length
 */
export function calculateDailyPacePoints(data: DistanceEntry[]): PacePoint[] {
  const points: PacePoint[] = [];
  const first = data[0];
  if (!first) return points;
  const origin = new Date(first.x).getTime();
  const dayOf = (x: string) => (new Date(x).getTime() - origin) / (1000 * 60 * 60 * 24);

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (!prev || !curr) continue;
    const prevDay = dayOf(prev.x);
    const currDay = dayOf(curr.x);
    const daysDiff = currDay - prevDay;

    if (daysDiff > 0) {
      points.push({ day: (prevDay + currDay) / 2, pace: (curr.y - prev.y) / daysDiff });
    }
  }

  return points;
}

/**
 * Calculates daily pace between consecutive data points in the data's own units
 * (miles/day for distance sports, hours/day for time sports, sessions/day, etc.).
 *
 * @param data - Cumulative metric entries
 * @returns Array of daily pace values
 */
export function calculateDailyPaces(data: DistanceEntry[]): number[] {
  return calculateDailyPacePoints(data).map((p) => p.pace);
}

/**
 * Performs simple linear regression on a dataset
 *
 * @param values - Y-values
 * @param xs - X-values, one per y; the indices (0, 1, 2, ...) when omitted
 * @returns Object containing slope and intercept, or null if insufficient data
 */
export function calculateLinearRegression(
  values: number[],
  xs?: number[]
): {
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
    const v = values[i];
    if (v === undefined) continue;
    const x = xs?.[i] ?? i;
    sumX += x;
    sumY += v;
    sumXY += x * v;
    sumX2 += x * x;
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
 * 4. Applying linear regression, against each pace's day, to find the pace trend
 * 5. Converting slope to weekly percentage change relative to average pace
 *
 * @param distanceData - Full distance data (may include extended entries)
 * @param averagePace - Current average daily pace (in the data's own units) for relativization
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

  // Calculate the daily pace for each interval between activities
  const pacePoints = calculateDailyPacePoints(recentData);

  if (pacePoints.length < TRAINING_CONSTANTS.PACE.MIN_DATA_POINTS) {
    return null;
  }

  // Linear regression against each pace's day, so the slope is per day however far apart
  // the activities are (per index, a pace three days after the last would count as one)
  const regression = calculateLinearRegression(
    pacePoints.map((p) => p.pace),
    pacePoints.map((p) => p.day)
  );

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
  "significantly-up" | "up" | "steady" | "down" | "significantly-down" | "stale" | null;

/**
 * Categorizes training momentum into discrete levels
 *
 * @param momentum - Weekly percentage change (from calculateTrainingMomentum)
 * @param isStale - Whether activity data is stale (no recent activities)
 * @returns Categorized momentum level
 */
export function getMomentumLevel(momentum: number | null, isStale: boolean): MomentumLevel {
  if (momentum === null) return null;
  if (isStale) return "stale";

  const { THRESHOLDS } = TRAINING_CONSTANTS.MOMENTUM;

  if (momentum > THRESHOLDS.SIGNIFICANTLY_UP) return "significantly-up";
  if (momentum > THRESHOLDS.UP) return "up";
  if (momentum >= THRESHOLDS.STEADY) return "steady";
  if (momentum >= THRESHOLDS.DOWN) return "down";
  return "significantly-down";
}
