/**
 * Readouts for the dashboard's year clock. Every function takes a UTC-anchored calendar
 * date (see `getTodayUtcAnchored`) and reads it with UTC getters only.
 */

/** ISO 8601 week number: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function getIsoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * How far through the year a date is when each month counts equally: whole months done,
 * plus the share of the current month through that day. On a 12-segment meter the
 * current month's segment fills to the day.
 */
export function getMonthShareOfYear(date: Date): number {
  const month = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return (month + date.getUTCDate() / daysInMonth) / 12;
}
