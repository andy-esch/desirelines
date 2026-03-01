import type { DistanceEntry, PacingEntry } from "../types/activity";
import { toLocalDateString } from "./dateUtils";

export type DistanceTimeseries = DistanceEntry[];
export type PacingTimeseries = PacingEntry[];

/**
 * Calculate the number of days in a year using UTC to avoid DST issues
 * @param year - The year to calculate for
 * @returns 365 for regular years, 366 for leap years
 */
function getDaysInYear(year: number): number {
  // Use UTC dates to avoid DST issues
  const startOfYearUTC = Date.UTC(year, 0, 1);
  const endOfYearUTC = Date.UTC(year, 11, 31);
  // Math.floor for consistency, +1 for inclusive counting (Jan 1 to Dec 31)
  return Math.floor((endOfYearUTC - startOfYearUTC) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Create a UTC date for a specific day of the year and return as YYYY-MM-DD string
 * Uses UTC throughout to avoid timezone-related off-by-one errors
 */
function dayOfYearToDateString(year: number, dayOfYear: number): string {
  // Create date in UTC to avoid local timezone issues
  const utcDate = new Date(Date.UTC(year, 0, dayOfYear));
  return utcDate.toISOString().split("T")[0];
}

/**
 * Pace ratio thresholds for determining goal status.
 * paceRatio = currentValue / proratedGoal (where 1.0 = exactly on pace).
 *
 * Used by GoalSummaryTable (sport page) and GoalProgressCard (dashboard).
 */
export const PACE_THRESHOLDS = {
  AHEAD: 1.1,
  ON_TRACK: 0.9,
  SLIGHTLY_BEHIND: 0.75,
  BEHIND: 0.5,
} as const;

/**
 * Extract the target goal value from a list of goal entries.
 * Prefers the goal labeled "Target", falls back to the middle value when sorted.
 * Returns null if the array is empty.
 */
export function getTargetGoalValue(
  goals: ReadonlyArray<{ value: number; label?: string }>
): number | null {
  if (goals.length === 0) return null;
  const targetEntry = goals.find((g) => g.label === "Target");
  if (targetEntry) return targetEntry.value;
  const sorted = [...goals].sort((a, b) => a.value - b.value);
  return sorted[Math.floor(sorted.length / 2)].value;
}

/**
 * Individual goal with unique value
 */
export interface Goal {
  id: string; // Unique identifier
  value: number; // Display-unit value (miles/km for distance sports, raw count for session sports)
  label?: string; // Optional user label
  metric?: string; // e.g., "distance_meters", "time_minutes", "activities"
}

/**
 * Array of goals (1-5 goals)
 */
export type Goals = Goal[];

/**
 * Calculate a straight "desire line" with daily goal from Jan 1 to Dec 31
 *
 * On day 1 (Jan 1), goal is targetDistance/daysInYear (not 0)
 * On day N, goal is targetDistance * N / daysInYear
 *
 * @param targetDistance - End-of-year goal (e.g., 2000, 2500, 3000 miles)
 * @param year - Year to calculate for (handles leap years)
 * @param maxDate - Don't plot beyond this date (typically today)
 * @returns Timeseries with linear progression from day 1
 */
export function calculateDesireLine(
  targetDistance: number,
  year: number,
  maxDate: Date
): DistanceTimeseries {
  const daysInYear = getDaysInYear(year);
  const line: DistanceTimeseries = [];

  const maxDateStr = toLocalDateString(maxDate);

  for (let dayOfYear = 1; dayOfYear <= daysInYear; dayOfYear++) {
    const dateStr = dayOfYearToDateString(year, dayOfYear);

    // Include up to and including maxDate
    if (dateStr > maxDateStr) break;

    // Goal for day N: complete N days worth of distance
    const targetForDay = (targetDistance * dayOfYear) / daysInYear;
    line.push({ x: dateStr, y: targetForDay });
  }

  return line;
}

/**
 * Calculate "current average" line - projects current pace to end of year
 *
 * Slope = (distance traveled so far) / (days elapsed)
 * Projected end distance = slope * daysInYear
 *
 * @param distanceTraveled - Actual cumulative distance data
 * @param year - Year to calculate for
 * @param maxDate - Don't plot beyond this date
 * @returns Timeseries with linear projection of current average pace
 */
export function calculateCurrentAverageLine(
  distanceTraveled: DistanceTimeseries,
  year: number,
  maxDate: Date
): DistanceTimeseries {
  if (distanceTraveled.length === 0) return [];

  // Current pace
  const lastEntry = distanceTraveled[distanceTraveled.length - 1];
  if (!lastEntry) return [];

  const currentDistance = lastEntry.y;
  const daysElapsed = distanceTraveled.length;
  const dailyAverage = currentDistance / daysElapsed;

  // Projected year-end distance at current pace
  const daysInYear = getDaysInYear(year);
  const projectedEndDistance = dailyAverage * daysInYear;

  // Use same line calculation as desire lines
  return calculateDesireLine(projectedEndDistance, year, maxDate);
}

/**
 * Helper: Estimate end-of-year distance based on current pace
 */
export function estimateYearEndDistance(
  distanceTraveled: DistanceTimeseries,
  year: number
): number {
  if (distanceTraveled.length === 0) return 0;

  const lastEntry = distanceTraveled[distanceTraveled.length - 1];
  if (!lastEntry) return 0;

  const currentDistance = lastEntry.y;
  const daysElapsed = distanceTraveled.length;
  const daysInYear = getDaysInYear(year);

  return (currentDistance / daysElapsed) * daysInYear;
}

/**
 * Helper: Generate default goals based on estimated year-end distance
 * Uses granularity for rounding and rounds up for motivation
 * Returns 3 default goals: Conservative, Target, Stretch
 *
 * All goals are guaranteed to be:
 * - Greater than 0
 * - Unique (no duplicates)
 *
 * @param estimatedDistance - Estimated year-end distance/value
 * @param granularity - Rounding increment (default 100)
 * @param minValue - Minimum base value for goal generation (default: granularity)
 *                   Use this to ensure meaningful goals when no data exists
 */
export function generateDefaultGoals(
  estimatedDistance: number,
  granularity: number = 100,
  minValue?: number
): Goals {
  // Ensure we have a meaningful base value for goal generation
  // minValue prevents meaningless goals (like 0, 0, 100) when there's no data
  const effectiveMin = minValue ?? granularity;
  const effectiveDistance = Math.max(estimatedDistance, effectiveMin);

  const rounded = Math.ceil(effectiveDistance / granularity) * granularity;

  // Conservative goal: one step below target
  // Edge case: if rounded equals granularity, use half-granularity to keep goals unique
  let conservativeValue: number;
  if (rounded > granularity) {
    conservativeValue = rounded - granularity;
  } else {
    // rounded == granularity (edge case with small estimates)
    // Use half of granularity to ensure uniqueness and > 0
    conservativeValue = Math.max(1, Math.round(granularity / 2));
  }

  return [
    {
      id: "1",
      value: conservativeValue,
      label: "Conservative",
    },
    {
      id: "2",
      value: rounded,
      label: "Target",
    },
    {
      id: "3",
      value: rounded + granularity,
      label: "Stretch",
    },
  ];
}

/**
 * Validate a single goal value
 * Returns error message if invalid, null if valid
 *
 * Only validates that value is a positive integer.
 * Increment buttons use sport-specific granularity, but manual text entry
 * allows any positive value for flexibility.
 */
export function validateGoalValue(value: number): string | null {
  if (!Number.isInteger(value)) {
    return "Goal must be a whole number";
  }

  if (value <= 0) {
    return "Goal must be greater than 0";
  }

  return null;
}

/**
 * Validate goals array
 * - Must have 1-5 goals
 * - All goal values must be greater than 0
 * - All goal values must be unique
 */
export function validateGoals(goals: Goals): { valid: boolean; error?: string } {
  if (goals.length === 0) {
    return { valid: false, error: "At least one goal required" };
  }
  if (goals.length > 5) {
    return { valid: false, error: "Maximum 5 goals allowed" };
  }

  // Check for zero or negative values
  const invalidValue = goals.find((g) => g.value <= 0);
  if (invalidValue) {
    return { valid: false, error: "Goal values must be greater than 0" };
  }

  const values = goals.map((g) => g.value);
  const uniqueValues = new Set(values);
  if (values.length !== uniqueValues.size) {
    return { valid: false, error: "All goal values must be unique" };
  }

  return { valid: true };
}

/**
 * Calculate actual pacing from cumulative distance data
 *
 * Pacing = distance / days elapsed (average miles per day so far)
 *
 * @param distanceTraveled - Actual cumulative distance data
 * @param maxDate - Don't plot beyond this date
 * @returns Timeseries with actual average pace over time
 */
export function calculateActualPacing(
  distanceTraveled: DistanceTimeseries,
  maxDate: Date
): PacingTimeseries {
  const pacing: PacingTimeseries = [];
  const maxDateStr = toLocalDateString(maxDate);

  for (let i = 0; i < distanceTraveled.length; i++) {
    const entry = distanceTraveled[i];
    if (!entry) continue;

    const dateStr = entry.x;

    if (dateStr > maxDateStr) break;

    // Average pace = cumulative distance / days elapsed
    const daysElapsed = i + 1;
    const avgPace = entry.y / daysElapsed;

    pacing.push({ x: dateStr, y: avgPace });
  }

  return pacing;
}

/**
 * Calculate dynamic pacing goal - pace needed NOW to reach goal by year end
 *
 * For each day: pacing = (targetDistance - currentDistance) / daysRemaining
 * This adjusts dynamically as distance accumulates
 *
 * @param distanceTraveled - Actual cumulative distance data
 * @param targetDistance - End-of-year distance goal
 * @param year - Year to calculate for
 * @param maxDate - Don't plot beyond this date
 * @returns Timeseries with dynamic pacing needed to achieve goal
 */
export function calculateDynamicPacingGoal(
  distanceTraveled: DistanceTimeseries,
  targetDistance: number,
  year: number,
  maxDate: Date
): PacingTimeseries {
  const daysInYear = getDaysInYear(year);
  const pacing: PacingTimeseries = [];
  const maxDateStr = toLocalDateString(maxDate);

  for (let i = 0; i < distanceTraveled.length; i++) {
    const entry = distanceTraveled[i];
    if (!entry) continue;

    const dateStr = entry.x;

    if (dateStr > maxDateStr) break;

    const daysElapsed = i + 1;
    const currentDistance = entry.y;
    const distanceRemaining = targetDistance - currentDistance;
    const daysRemaining = daysInYear - daysElapsed;

    // If no days remaining, pace is 0 (year is over)
    // If distance remaining is negative, pace is 0 (goal already achieved)
    const requiredPace =
      daysRemaining > 0 && distanceRemaining > 0 ? distanceRemaining / daysRemaining : 0;

    pacing.push({ x: dateStr, y: requiredPace });
  }

  return pacing;
}
