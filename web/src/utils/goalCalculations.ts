import type { DistanceEntry, PacingEntry } from "../types/activity";

export type DistanceTimeseries = DistanceEntry[];
export type PacingTimeseries = PacingEntry[];

/**
 * Individual goal with unique value
 */
export interface Goal {
  id: string;       // Unique identifier
  value: number;    // Distance in miles
  label?: string;   // Optional user label
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
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const daysInYear =
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const line: DistanceTimeseries = [];

  for (let dayOfYear = 1; dayOfYear <= daysInYear; dayOfYear++) {
    const currentDate = new Date(year, 0, dayOfYear);
    const dateStr = currentDate.toISOString().split("T")[0] || "";
    const maxDateStr = maxDate.toISOString().split("T")[0] || "";

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
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const daysInYear =
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
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

  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const daysInYear =
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return (currentDistance / daysElapsed) * daysInYear;
}

/**
 * Helper: Generate default goals based on estimated year-end distance
 * Uses 100-mile granularity and rounds up for motivation
 * Returns 3 default goals: Conservative, Target, Stretch
 */
export function generateDefaultGoals(
  estimatedDistance: number,
  granularity: number = 100
): Goals {
  const rounded = Math.ceil(estimatedDistance / granularity) * granularity;

  return [
    {
      id: '1',
      value: Math.max(0, rounded - granularity),
      label: 'Conservative'
    },
    {
      id: '2',
      value: rounded,
      label: 'Target'
    },
    {
      id: '3',
      value: rounded + granularity,
      label: 'Stretch'
    },
  ];
}

/**
 * Validate goals array
 * - Must have 1-5 goals
 * - All goal values must be unique
 */
export function validateGoals(goals: Goals): { valid: boolean; error?: string } {
  if (goals.length === 0) {
    return { valid: false, error: 'At least one goal required' };
  }
  if (goals.length > 5) {
    return { valid: false, error: 'Maximum 5 goals allowed' };
  }

  const values = goals.map(g => g.value);
  const uniqueValues = new Set(values);
  if (values.length !== uniqueValues.size) {
    return { valid: false, error: 'All goal values must be unique' };
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

  for (let i = 0; i < distanceTraveled.length; i++) {
    const entry = distanceTraveled[i];
    if (!entry) continue;

    const dateStr = entry.x;
    const maxDateStr = maxDate.toISOString().split("T")[0] || "";

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
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const daysInYear =
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const pacing: PacingTimeseries = [];

  for (let i = 0; i < distanceTraveled.length; i++) {
    const entry = distanceTraveled[i];
    if (!entry) continue;

    const dateStr = entry.x;
    const maxDateStr = maxDate.toISOString().split("T")[0] || "";

    if (dateStr > maxDateStr) break;

    const daysElapsed = i + 1;
    const currentDistance = entry.y;
    const distanceRemaining = targetDistance - currentDistance;
    const daysRemaining = daysInYear - daysElapsed;

    // If no days remaining, pace is 0 (year is over)
    // If distance remaining is negative, pace is 0 (goal already achieved)
    const requiredPace =
      daysRemaining > 0 && distanceRemaining > 0
        ? distanceRemaining / daysRemaining
        : 0;

    pacing.push({ x: dateStr, y: requiredPace });
  }

  return pacing;
}
