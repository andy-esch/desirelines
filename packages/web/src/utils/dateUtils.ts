/**
 * Date Utilities
 *
 * Shared date formatting and parsing functions used across the application.
 * These utilities handle local timezone correctly to avoid common pitfalls
 * with JavaScript Date objects.
 *
 * KEY DESIGN DECISIONS:
 * - All functions work in LOCAL timezone, not UTC
 * - Date strings use YYYY-MM-DD format (ISO 8601 date portion)
 * - Parsing functions handle the "midnight UTC vs local" problem
 *
 * COMMON PITFALL AVOIDED:
 * `new Date("2026-01-15")` creates midnight UTC, which can be
 * "2026-01-14 7:00 PM" in US timezones. These utilities prevent this.
 *
 * @see https://stackoverflow.com/questions/7556591/is-the-javascript-date-object-always-one-day-off
 */

/**
 * Format a Date object as YYYY-MM-DD string in local timezone.
 *
 * Use this instead of `date.toISOString().split('T')[0]` which
 * converts to UTC and can shift the date by one day.
 *
 * @param date - Date object to format
 * @returns Date string in YYYY-MM-DD format
 *
 * @example
 * ```ts
 * const date = new Date(2026, 0, 15); // Jan 15, 2026 local
 * toLocalDateString(date); // "2026-01-15"
 * ```
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string as a Date at local midnight.
 *
 * Use this instead of `new Date(dateStr)` which parses as UTC midnight
 * and can result in the wrong day in local timezone.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object at local midnight, or null if invalid
 *
 * @example
 * ```ts
 * parseLocalDate("2026-01-15"); // Jan 15, 2026 00:00:00 local time
 * parseLocalDate("invalid");    // null
 * ```
 */
export function parseLocalDate(dateStr: string): Date | null {
  // Validate format: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }

  const [yearStr, monthStr, dayStr] = dateStr.split("-") as [string, string, string];
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // JS months are 0-indexed
  const day = parseInt(dayStr, 10);

  // Validate ranges
  if (month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month, day);

  // Verify the date is valid (handles cases like Feb 30)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}

/**
 * Parse a YYYY-MM-DD string as a Date, throwing on invalid input.
 *
 * Use this when you're confident the input is valid and want
 * to fail fast if it's not. For user input, prefer `parseLocalDate`.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object at local midnight
 * @throws Error if dateStr is invalid
 *
 * @example
 * ```ts
 * parseLocalDateStrict("2026-01-15"); // Jan 15, 2026 00:00:00 local
 * parseLocalDateStrict("invalid");    // throws Error
 * ```
 */
export function parseLocalDateStrict(dateStr: string): Date {
  const date = parseLocalDate(dateStr);
  if (date === null) {
    throw new Error(`Invalid date string: "${dateStr}". Expected YYYY-MM-DD format.`);
  }
  return date;
}

/**
 * Get today's calendar date as a UTC-midnight Date object.
 *
 * Reads the user's local year/month/day and returns a Date at UTC midnight
 * for that calendar date. This aligns with the app-wide convention that all
 * chart dates are UTC timestamps (see useCumulativeChartData.ts header).
 *
 * Why UTC? The API returns "YYYY-MM-DD" strings from `start_date_local`,
 * which JS parses as UTC midnight. All computed boundaries use `Date.UTC()`.
 * Returning local midnight here would cause off-by-one errors when the
 * local timezone offset shifts the Date into the previous/next UTC day.
 */
export function getCurrentLocalDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Get today's date as a YYYY-MM-DD string in local timezone.
 *
 * @returns Today's date in YYYY-MM-DD format
 *
 * @example
 * ```ts
 * getTodayString(); // "2026-01-12" (if today is Jan 12, 2026)
 * ```
 */
export function getTodayString(): string {
  return toLocalDateString(new Date());
}

/**
 * Add days to a date and return a new Date object.
 *
 * @param date - Starting date
 * @param days - Number of days to add (can be negative)
 * @returns New Date object
 *
 * @example
 * ```ts
 * const date = new Date(2026, 0, 15);
 * addDays(date, 7);  // Jan 22, 2026
 * addDays(date, -7); // Jan 8, 2026
 * ```
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Check if two dates represent the same calendar day in local timezone.
 *
 * @param date1 - First date
 * @param date2 - Second date
 * @returns true if both dates are the same calendar day
 *
 * @example
 * ```ts
 * const morning = new Date(2026, 0, 15, 8, 0);
 * const evening = new Date(2026, 0, 15, 20, 0);
 * isSameDay(morning, evening); // true
 * ```
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Format a date for display (e.g., "Jan 15").
 *
 * @param date - Date to format
 * @param options - Intl.DateTimeFormat options (defaults to month: short, day: numeric)
 * @returns Formatted date string
 *
 * @example
 * ```ts
 * const date = new Date(2026, 0, 15);
 * formatDisplayDate(date);                    // "Jan 15"
 * formatDisplayDate(date, { weekday: 'short' }); // "Thu"
 * ```
 */
export function formatDisplayDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
): string {
  return date.toLocaleDateString("en-US", options);
}

/**
 * Format a timestamp for chart X-axis tick labels.
 *
 * Uses UTC timezone because chart data timestamps are stored in UTC.
 * This ensures consistent display regardless of user's local timezone.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string (e.g., "Jan 15")
 *
 * @example
 * ```ts
 * formatChartAxisDate(1705276800000); // "Jan 15"
 * ```
 */
export function formatChartAxisDate(timestamp: number): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Generate an array of date strings from start to end (inclusive).
 *
 * Useful for creating dense date arrays that include days with no data.
 *
 * @param from - Start date in YYYY-MM-DD format
 * @param to - End date in YYYY-MM-DD format
 * @returns Array of date strings in YYYY-MM-DD format
 *
 * @example
 * ```ts
 * generateDateRange("2026-01-01", "2026-01-05");
 * // ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]
 * ```
 */
export function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);

  if (!start || !end) {
    return [];
  }

  const current = new Date(start);
  while (current <= end) {
    dates.push(toLocalDateString(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
