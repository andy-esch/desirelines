import { toLocalDateString } from "./dateUtils";

/** The activity calendar's range: the trailing 12 months, or one calendar year. */
export type TimeRangeOption = "trailing12" | number;

/**
 * Calculate date range for a time range option.
 * For specific years, always returns full year (Jan 1 - Dec 31) for stable layout.
 * Data beyond today will just show as 0 activities.
 */
export function getCalendarRange(option: TimeRangeOption): {
  startDate: Date;
  endDate: Date;
  from: string;
  to: string;
} {
  const today = new Date();
  let startDate: Date;
  let endDate: Date;

  if (option === "trailing12") {
    // Trailing 12 months from today
    endDate = today;
    startDate = new Date(today);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(startDate.getDate() + 1); // Start day after same date last year
  } else {
    // Specific year - always show full year for stable layout
    const year = option;
    startDate = new Date(year, 0, 1);
    endDate = new Date(year, 11, 31);
  }

  return {
    startDate,
    endDate,
    from: toLocalDateString(startDate),
    to: toLocalDateString(endDate),
  };
}
