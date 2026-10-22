/**
 * Shared time-range presets. The Activities-group views (`/activities`, `/charts`)
 * carry one in the `?range=` URL param and map it to a `{ from, to }` local-date
 * window with `calculateDateRange`, so the table and the charts derive identical
 * windows. The dashboard uses a subset of the same keys and labels
 * (`DashboardTimeRange`) with its own windows.
 */
import { toLocalDateString, addDays, getTodayLocalMidnight } from "./dateUtils";

export type TimeRange = "2w" | "4w" | "2m" | "6m" | "ytd" | "all";

/** `short` is what a segmented control shows; `label` stays the spoken and written name. */
export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; short: string }[] = [
  { value: "2w", label: "2 Weeks", short: "2W" },
  { value: "4w", label: "4 Weeks", short: "4W" },
  { value: "2m", label: "2 Months", short: "2M" },
  { value: "6m", label: "6 Months", short: "6M" },
  { value: "ytd", label: "Year to Date", short: "YTD" },
  { value: "all", label: "All Time", short: "All" },
];

export const VALID_RANGES: TimeRange[] = ["2w", "4w", "2m", "6m", "ytd", "all"];

/** Narrow a raw URL value to a valid TimeRange, falling back to `fallback`. */
export function coerceTimeRange(value: unknown, fallback: TimeRange): TimeRange {
  return VALID_RANGES.includes(value as TimeRange) ? (value as TimeRange) : fallback;
}

/**
 * The dashboard's presets, the one list that defines them: every range except "all",
 * because the dashboard always shows a bounded window. A new range reaches the
 * dashboard only by being added here. Its windows come from `getTimeRangeCutoff` in
 * `chartUtils`, not `calculateDateRange` below.
 */
const DASHBOARD_RANGES = ["2w", "4w", "2m", "6m", "ytd"] as const satisfies readonly TimeRange[];

export type DashboardTimeRange = (typeof DASHBOARD_RANGES)[number];

/** Narrow a raw value, such as a toggle group's selection, to a dashboard preset. */
export function isDashboardTimeRange(value: unknown): value is DashboardTimeRange {
  return (DASHBOARD_RANGES as readonly unknown[]).includes(value);
}

/** The dashboard's presets in the shared display order, with their labels. */
export const DASHBOARD_TIME_RANGE_OPTIONS = TIME_RANGE_OPTIONS.filter(
  (option): option is (typeof TIME_RANGE_OPTIONS)[number] & { value: DashboardTimeRange } =>
    isDashboardTimeRange(option.value)
);

/**
 * Resolve a range preset to an inclusive local-date window (`all` = unbounded).
 *
 * Uses the local-date helpers from dateUtils (not `.toISOString()`, which
 * converts to UTC and would shift the window a day back in UTC-negative
 * timezones — e.g. YTD's Jan-1 start becoming the prior Dec 31).
 */
export function calculateDateRange(range: TimeRange): { from?: string; to?: string } {
  // Local-midnight basis so addDays()/toLocalDateString() (both local-time) stay on the
  // athlete's calendar day. getTodayUtcAnchored() would shift the window a day early in
  // UTC-negative zones — see its doc for why.
  const today = getTodayLocalMidnight();
  const toDate = toLocalDateString(today);
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
