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
    // Trailing 12 months, starting the day after this date a year ago.
    //
    // Feb 29 has to be handled both ways round. Stepping the year back from a leap day
    // rolls to Mar 1, which is already the day after that year's Feb 28, so adding a day
    // there would skip one. Stepping the day first instead breaks the mirror case, where
    // today is Feb 28 and the earlier year does have a Feb 29 to include.
    endDate = today;
    startDate = new Date(today);
    startDate.setFullYear(startDate.getFullYear() - 1);
    const rolledPastLeapDay = startDate.getMonth() !== today.getMonth();
    if (!rolledPastLeapDay) startDate.setDate(startDate.getDate() + 1);
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
