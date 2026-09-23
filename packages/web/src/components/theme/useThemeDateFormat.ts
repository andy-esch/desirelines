import { useMemo } from "react";
import {
  chartAxisDateFormatter,
  formatDisplayDate as formatDisplayDateWithStyle,
} from "../../utils/dateUtils";
import { formatActivityDate as formatActivityDateWithStyle } from "../../utils/formatActivityDate";
import { formatMonthLabel as formatMonthLabelWithStyle } from "../../utils/dateStyle";
import { useThemeStructure } from "./useThemeStructure";

/**
 * The date formatters, bound to the active theme's spelling.
 *
 * This is the boundary between the theme and the pure formatters in `utils/`: components
 * call these instead of importing the formatters directly, and nothing below has to know
 * which theme is showing. `formatAxisDate` is a stable function so it can be handed to a
 * chart's `tickFormatter` without re-rendering the axis on every parent render.
 */
export function useThemeDateFormat() {
  const { dateFormat } = useThemeStructure();

  return useMemo(
    () => ({
      /** A date for display, e.g. a card heading. */
      formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) =>
        options
          ? formatDisplayDateWithStyle(date, options, dateFormat)
          : formatDisplayDateWithStyle(date, undefined, dateFormat),
      /** A chart axis tick, from a UTC timestamp. */
      formatAxisDate: chartAxisDateFormatter(dateFormat),
      /** A month, from `YYYY-MM`, with or without its year. */
      formatMonth: (month: string, showYear: boolean) =>
        formatMonthLabelWithStyle(month, showYear, dateFormat),
      /** An athlete-local activity date (`YYYY-MM-DD…`), as rows and lists show it. */
      formatActivityDate: (startDateLocal: string, opts?: { year?: boolean }) =>
        formatActivityDateWithStyle(startDateLocal, { ...opts, style: dateFormat }),
    }),
    [dateFormat]
  );
}
