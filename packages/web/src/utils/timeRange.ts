/**
 * Shared time-range presets for the Activities-group views (`/activities`,
 * `/charts`). The `?range=` URL param carries one of these keys; each maps to a
 * `{ from, to }` local-date window for the activities list API. Extracted so the
 * table and the charts derive identical windows from the same param.
 */
import { getCurrentLocalDate, getTodayString, toLocalDateString, addDays } from "./dateUtils";

export type TimeRange = "2w" | "4w" | "2m" | "6m" | "ytd" | "all";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "2w", label: "2 Weeks" },
  { value: "4w", label: "4 Weeks" },
  { value: "2m", label: "2 Months" },
  { value: "6m", label: "6 Months" },
  { value: "ytd", label: "Year to Date" },
  { value: "all", label: "All Time" },
];

export const VALID_RANGES: TimeRange[] = ["2w", "4w", "2m", "6m", "ytd", "all"];

/** Narrow a raw URL value to a valid TimeRange, falling back to `fallback`. */
export function coerceTimeRange(value: unknown, fallback: TimeRange): TimeRange {
  return VALID_RANGES.includes(value as TimeRange) ? (value as TimeRange) : fallback;
}

/**
 * Resolve a range preset to an inclusive local-date window (`all` = unbounded).
 *
 * Uses the local-date helpers from dateUtils (not `.toISOString()`, which
 * converts to UTC and would shift the window a day back in UTC-negative
 * timezones — e.g. YTD's Jan-1 start becoming the prior Dec 31).
 */
export function calculateDateRange(range: TimeRange): { from?: string; to?: string } {
  const today = getCurrentLocalDate();
  const toDate = getTodayString();
  const daysAgo = (days: number) => ({
    from: toLocalDateString(addDays(today, -days)),
    to: toDate,
  });

  switch (range) {
    case "2w":
      return daysAgo(14);
    case "4w":
      return daysAgo(28);
    case "2m":
      return daysAgo(60);
    case "6m":
      return daysAgo(180);
    case "ytd":
      return { from: toLocalDateString(new Date(today.getFullYear(), 0, 1)), to: toDate };
    case "all":
    default:
      return {};
  }
}
