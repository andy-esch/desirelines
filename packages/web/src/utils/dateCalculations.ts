/**
 * Date calculation utilities for year-based tracking
 *
 * Provides functions for calculating time-based metrics within a year,
 * including days elapsed, days remaining, and average pace calculations.
 */

export interface YearStats {
  /** Start of the year (January 1) */
  startOfYear: Date;
  /** End of the year (December 31) */
  endOfYear: Date;
  /** Number of days elapsed from start of year to today */
  daysElapsed: number;
  /** Number of days remaining from today to end of year */
  daysRemaining: number;
  /** Current date used for calculations */
  today: Date;
}

/**
 * Calculates year-based time statistics
 *
 * Uses local timezone for all calculations to ensure "today" matches the user's
 * actual local day, not UTC which can be tomorrow in evening hours.
 *
 * @param year - The year to calculate stats for
 * @returns Object containing year boundaries and day counts
 *
 * @example
 * const stats = calculateYearStats(2025);
 * console.log(stats.daysElapsed); // e.g., 295 (if today is October 22)
 * console.log(stats.daysRemaining); // e.g., 70
 */
export function calculateYearStats(year: number): YearStats {
  const today = new Date();
  const startOfYear = new Date(year, 0, 1); // January 1 at local midnight

  // Use UTC date values to avoid DST issues in day counting
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfYearUTC = Date.UTC(year, 0, 1);
  const endOfYearUTC = Date.UTC(year, 11, 31);

  // Days elapsed = days from Jan 1 to today (inclusive of both endpoints)
  // Use Math.floor for consistency - UTC dates should be exact multiples but floor is safer
  const daysElapsed = Math.floor((todayUTC - startOfYearUTC) / (1000 * 60 * 60 * 24)) + 1;

  // Days remaining = days from today to Dec 31 (inclusive of both endpoints)
  const daysRemaining = Math.floor((endOfYearUTC - todayUTC) / (1000 * 60 * 60 * 24)) + 1;

  return {
    startOfYear,
    endOfYear: new Date(year, 11, 31, 23, 59, 59, 999), // Return end of day for backwards compat
    daysElapsed,
    daysRemaining,
    today,
  };
}

/**
 * Calculates average pace (distance per day) for a given year
 *
 * @param currentDistance - Total distance covered so far
 * @param year - The year to calculate pace for
 * @returns Average distance per day, or 0 if no days have elapsed
 *
 * @example
 * const pace = calculateAveragePace(1500, 2025);
 * console.log(pace); // e.g., 5.08 mi/day (if 295 days have elapsed)
 */
export function calculateAveragePace(currentDistance: number, year: number): number {
  const { daysElapsed } = calculateYearStats(year);
  return daysElapsed > 0 ? currentDistance / daysElapsed : 0;
}

/**
 * Calculates the number of days between two dates
 *
 * @param fromDate - Start date
 * @param toDate - End date
 * @returns Number of days between dates (can be negative if fromDate > toDate)
 *
 * @example
 * const days = daysBetween(new Date('2025-01-01'), new Date('2025-01-15'));
 * console.log(days); // 14
 */
export function daysBetween(fromDate: Date, toDate: Date): number {
  return Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}
