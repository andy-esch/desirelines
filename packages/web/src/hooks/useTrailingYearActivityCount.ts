import { useMemo } from "react";
import { useCurrentYear } from "./useCurrentYear";
import { useDailySportData } from "./useDailySportData";
import { useSportConfig } from "./useSportConfig";
import { getCalendarRange } from "../utils/calendarRange";
import type { TuningParams } from "../utils/demoDataGenerator";

/**
 * Activities across every sport in the trailing 12 months. It asks for the same range and
 * sports as the activity calendar's default view, so the two share one cached query.
 */
export function useTrailingYearActivityCount(tuningParams?: TuningParams): {
  count: number;
  isLoading: boolean;
} {
  const currentYear = useCurrentYear();
  const { sportConfig, isLoading: configLoading } = useSportConfig();
  const sports = useMemo(
    () =>
      sportConfig?.sportCategories
        ? Object.keys(sportConfig.sportCategories)
        : ["cycling", "running", "yoga"],
    [sportConfig]
  );
  const { from, to } = useMemo(() => getCalendarRange("trailing12"), []);
  const { data, isLoading } = useDailySportData({
    year: currentYear,
    from,
    to,
    sports,
    tuningParams,
  });

  const count = useMemo(
    () =>
      sports.reduce(
        (sum, sport) =>
          sum +
          Object.values(data[sport] ?? {}).reduce((days, day) => days + (day.activities ?? 0), 0),
        0
      ),
    [data, sports]
  );

  return { count, isLoading: configLoading || isLoading };
}
