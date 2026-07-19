/**
 * Date Utilities
 *
 * Shared date formatting/parsing for the web app. Read this before touching dates:
 * there are TWO deliberate conventions here, and MIXING them is the source of the
 * timezone off-by-one bugs this module exists to prevent.
 *
 * THE INVARIANT
 * Activity dates come from Strava's `start_date_local` — the athlete's WALL-CLOCK
 * time, delivered stamped with a misleading `Z` and stored as-if-UTC through the whole
 * pipeline. Never round-trip such a value (or a derived "today") through the OTHER
 * convention. Every bug in this space is the same shape: build a Date in one
 * convention, then read or format it in the other.
 *
 * CONVENTION A — local-string (calendar dates and the range filters; the default)
 * For anything derived from `start_date_local` or shown to the athlete:
 *   - today            -> getTodayLocalMidnight()
 *   - format a Date    -> toLocalDateString(d)   (never d.toISOString())
 *   - advance a Date   -> addDays(d, n)
 *   - display a string -> slice "YYYY-MM-DD" and build new Date(y, m-1, d) from the
 *                         parts (see formatActivityDate); do NOT new Date(startDateLocal)
 *   - read a Date back -> LOCAL getters (getFullYear/getMonth/getDate)
 *
 * CONVENTION B — UTC-midnight (the chart-data pipeline only)
 * Chart points parse "YYYY-MM-DD" as UTC midnight and build boundaries with Date.UTC();
 * see the useCumulativeChartData.ts header.
 *   - today             -> getTodayUtcAnchored()
 *   - build a boundary  -> new Date(Date.UTC(y, m, d))
 *   - read a Date back  -> UTC getters (getUTCFullYear/...) and getTime()
 *   - format for display -> Intl with { timeZone: "UTC" }
 *
 * COMMON PITFALL: `new Date("2026-01-15")` is midnight UTC, i.e. "2026-01-14 19:00" in
 * US timezones. Mixing a UTC-anchored/parsed Date with local getters/formatters (or
 * vice versa) shifts the day. Pick a convention and stay in it.
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

  const [yearStr = "", monthStr = "", dayStr = ""] = dateStr.split("-");
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
 * Today's local calendar date, anchored to **UTC midnight**.
 *
 * Reads the user's local year/month/day and returns a Date at UTC midnight for that
 * calendar date. Belongs to the chart-pipeline convention where all dates are UTC
 * timestamps (see the useCumulativeChartData.ts header): the API's "YYYY-MM-DD"
 * strings parse as UTC midnight via `new Date(str)`, and boundaries use `Date.UTC()`,
 * so "today" must be UTC-anchored to compare correctly.
 *
 * READ IT WITH UTC METHODS ONLY (`getUTCFullYear`/`getUTCMonth`/`getUTCDate`/`getTime`).
 * Do NOT pass it to the local-time helpers {@link addDays} or {@link toLocalDateString}:
 * in UTC-negative timezones (the Americas) the UTC-midnight instant reads back through
 * local `getDate()` as the *previous* day, shifting the result. For that (local-string)
 * convention use {@link getTodayLocalMidnight}.
 */
export function getTodayUtcAnchored(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Today's local calendar date, anchored to **local midnight**.
 *
 * The counterpart to {@link getTodayUtcAnchored} for the local-string convention: safe
 * to advance with {@link addDays} and format with {@link toLocalDateString} (both work
 * in local time). Use this whenever "today" flows through those helpers — e.g. the
 * Activities/Charts range filters in `timeRange.ts`.
 */
export function getTodayLocalMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
