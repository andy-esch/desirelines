/**
 * Year Context - Encapsulates year-related state and derived flags
 *
 * Provides a single source of truth for whether we're viewing current/past/future years
 * and whether time-based calculations (pacing, days remaining, etc.) make sense.
 */

export interface YearContext {
  /** The year being viewed */
  year: number;

  /** Whether this is the current calendar year */
  isCurrentYear: boolean;

  /** Whether this year is in the past */
  isPastYear: boolean;

  /** Whether this year is in the future */
  isFutureYear: boolean;

  /**
   * Days elapsed in the year (from Jan 1 to today)
   * - Current year: Actual days elapsed
   * - Past year: Full year (365 or 366)
   * - Future year: 0
   */
  daysElapsed: number;

  /**
   * Days remaining in the year (from today to Dec 31)
   * - Current year: Actual days remaining (can be 0 on Dec 31)
   * - Past year: 0 (year is complete)
   * - Future year: Full year (365 or 366)
   */
  daysRemaining: number;

  /**
   * Whether pacing calculations make sense
   * True only for current year with days remaining
   */
  shouldShowPacing: boolean;

  /**
   * Whether to show "days elapsed" metrics
   * True for current and past years
   */
  shouldShowProgress: boolean;
}

import { getCurrentLocalDate } from "./dateUtils";

/**
 * Create a YearContext for the given year
 * Calculates all year-related flags and time metrics
 */
export function createYearContext(year: number): YearContext {
  const today = getCurrentLocalDate();
  const currentYear = today.getFullYear();

  const isCurrentYear = year === currentYear;
  const isPastYear = year < currentYear;
  const isFutureYear = year > currentYear;

  // Calculate days in the year (handle leap years)
  const daysInYear = isLeapYear(year) ? 366 : 365;

  let daysElapsed: number;
  let daysRemaining: number;

  if (isCurrentYear) {
    // Current year: calculate actual elapsed/remaining
    // Use UTC date values to avoid DST issues while still respecting local day boundaries
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfYearUTC = Date.UTC(year, 0, 1);
    const endOfYearUTC = Date.UTC(year, 11, 31);

    // Days elapsed = days from Jan 1 to today (inclusive of both endpoints)
    daysElapsed = Math.floor((todayUTC - startOfYearUTC) / (1000 * 60 * 60 * 24)) + 1;

    // Days remaining = days from today to Dec 31 (inclusive of both endpoints)
    daysRemaining = Math.max(0, Math.floor((endOfYearUTC - todayUTC) / (1000 * 60 * 60 * 24)) + 1);
  } else if (isPastYear) {
    // Past year: year is complete
    daysElapsed = daysInYear;
    daysRemaining = 0;
  } else {
    // Future year: hasn't started yet
    daysElapsed = 0;
    daysRemaining = daysInYear;
  }

  // Derived flags
  const shouldShowPacing = isCurrentYear && daysRemaining > 0;
  const shouldShowProgress = isCurrentYear || isPastYear;

  return {
    year,
    isCurrentYear,
    isPastYear,
    isFutureYear,
    daysElapsed,
    daysRemaining,
    shouldShowPacing,
    shouldShowProgress,
  };
}

/**
 * Check if a year is a leap year
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
