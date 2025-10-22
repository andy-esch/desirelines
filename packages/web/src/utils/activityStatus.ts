/**
 * Activity status and staleness detection utilities
 *
 * Determines the last activity date and whether activity data
 * is considered stale (no recent activities).
 */

import type { DistanceEntry } from "../types/activity";
import { TRAINING_CONSTANTS } from "../constants/training";
import { daysBetween } from "./dateCalculations";

/**
 * Finds the date of the last actual activity
 *
 * An "actual activity" is defined as a day where distance increased
 * from the previous day. Days with identical distance values are
 * considered "extended" (no activity) and are ignored.
 *
 * @param distanceData - Array of distance entries
 * @returns Date of last activity, or null if no activities found
 *
 * @example
 * const data = [
 *   { x: "2025-01-01", y: 0 },
 *   { x: "2025-01-02", y: 10 },   // Activity
 *   { x: "2025-01-03", y: 10 },   // Extended (no activity)
 *   { x: "2025-01-04", y: 10 },   // Extended (no activity)
 * ];
 * const lastDate = findLastActivityDate(data);
 * // Returns: Date("2025-01-02")
 */
export function findLastActivityDate(
  distanceData: DistanceEntry[]
): Date | null {
  if (distanceData.length === 0) return null;

  // Scan backwards to find last day with actual activity (distance changed)
  for (let i = distanceData.length - 1; i >= 1; i--) {
    if (distanceData[i].y !== distanceData[i - 1].y) {
      return new Date(distanceData[i].x);
    }
  }

  // No activity found (all distances identical, or only one entry)
  return null;
}

/**
 * Checks if activity data is considered stale
 *
 * Data is stale if:
 * - No distance data exists, OR
 * - No actual activities found (all distances identical), OR
 * - Last activity was more than STALE_ACTIVITY_DAYS ago
 *
 * @param distanceData - Array of distance entries
 * @param staleThresholdDays - Number of days without activity to consider stale
 *                             (defaults to TRAINING_CONSTANTS.MOMENTUM.STALE_ACTIVITY_DAYS)
 * @returns true if data is stale, false otherwise
 *
 * @example
 * const data = [
 *   { x: "2025-10-01", y: 1000 },
 *   { x: "2025-10-02", y: 1010 },
 *   // ... (no activities since Oct 2)
 * ];
 * const isStale = isActivityDataStale(data);
 * // Returns: true (if today is >7 days after Oct 2)
 */
export function isActivityDataStale(
  distanceData: DistanceEntry[],
  staleThresholdDays: number = TRAINING_CONSTANTS.MOMENTUM.STALE_ACTIVITY_DAYS
): boolean {
  if (distanceData.length === 0) return true;

  const lastActivityDate = findLastActivityDate(distanceData);
  if (!lastActivityDate) return true;

  const today = new Date();
  const daysSinceActivity = daysBetween(lastActivityDate, today);

  return daysSinceActivity > staleThresholdDays;
}

/**
 * Gets the number of days since the last activity
 *
 * @param distanceData - Array of distance entries
 * @returns Number of days since last activity, or null if no activities found
 *
 * @example
 * const data = [{ x: "2025-10-15", y: 1000 }, { x: "2025-10-16", y: 1010 }];
 * const days = daysSinceLastActivity(data);
 * // Returns: number of days between Oct 16 and today
 */
export function daysSinceLastActivity(
  distanceData: DistanceEntry[]
): number | null {
  const lastActivityDate = findLastActivityDate(distanceData);
  if (!lastActivityDate) return null;

  return daysBetween(lastActivityDate, new Date());
}
