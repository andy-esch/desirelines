import { useCurrentYear } from "../hooks/useCurrentYear";
import { useDailySportData } from "../hooks/useDailySportData";
import { useVisibleSports } from "../hooks/useVisibleSports";
import { useSportConfig } from "../hooks/useSportConfig";
import { useUserConfig } from "../hooks/useUserConfig";
import type { TimeRange } from "../utils/dataNormalization";
import type { TuningParams } from "../utils/demoDataGenerator";
import { filterValidSports } from "../utils/sportConfig";
import { getTimeRangeCutoff } from "../utils/chartUtils";
import { toLocalDateString } from "../utils/dateUtils";
import { getUserSettings } from "../utils/units";
import {
  processSportSparkline,
  mergeSparklineData,
  getSportMetadata,
} from "../utils/multiSportChartUtils";

const SPARKLINE_ROW_HEIGHT = 36;
const SPARKLINE_XAXIS_HEIGHT = 12;
const SPARKLINE_PADDING = 16;
const MIN_SPORTS_FOR_HEIGHT = 3;
const MAX_SPORTS_DISPLAY = 8;

function getDateRangeFromTimeRange(timeRange: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = toLocalDateString(now);
  const cutoff = getTimeRangeCutoff(now, timeRange);
  const from = toLocalDateString(cutoff);
  return { from, to };
}

function getActivityPageSize(sportCount: number): number {
  const effectiveCount = Math.max(sportCount, MIN_SPORTS_FOR_HEIGHT);
  if (effectiveCount <= 3) return 4;
  if (effectiveCount <= 5) return 5;
  if (effectiveCount <= 7) return 6;
  return 7;
}

/**
 * Hook for managing multi-sport comparison chart data.
 *
 * Note: Manual memoization (useCallback/useMemo) is omitted as the
 * React Compiler handles reference stability automatically.
 */
export function useMultiSportChartData(timeRange: TimeRange, tuningParams?: TuningParams) {
  const currentYear = useCurrentYear();

  // Get visible sports, sport config, and user preferences
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();
  const { data: prefs } = useUserConfig("preferences");
  const userSettings = getUserSettings(prefs);

  // Filter visible sports to only those in config
  const validSports = filterValidSports(visibleSports, sportConfig);

  // Calculate date range for API query
  const { from, to } = getDateRangeFromTimeRange(timeRange);

  // Fetch data for visible sports only
  const {
    data,
    isLoading: dataLoading,
    error,
  } = useDailySportData({
    year: currentYear,
    from,
    to,
    sports: validSports,
    tuningParams,
  });

  // Process data for each sport's sparkline
  const sparklineData = validSports.map((sport) =>
    processSportSparkline(sport, data[sport] ?? {}, sportConfig, { from, to }, currentYear)
  );

  // Merged data for unified chart
  const unifiedChartData = mergeSparklineData(sparklineData);

  // Sport metadata for chart legend and styling
  const sportMeta = getSportMetadata(sparklineData);

  // Calculate dynamic layout parameters
  const displayCount = Math.min(
    Math.max(validSports.length, MIN_SPORTS_FOR_HEIGHT),
    MAX_SPORTS_DISPLAY
  );
  const sparklineContainerHeight =
    displayCount * SPARKLINE_ROW_HEIGHT + SPARKLINE_XAXIS_HEIGHT + SPARKLINE_PADDING;

  const activityPageSize = getActivityPageSize(validSports.length);
  const isLoading = prefsLoading || configLoading || dataLoading;

  const hasAnyData = validSports.some((sport) => {
    const sportData = data[sport];
    return sportData && Object.keys(sportData).length > 0;
  });

  return {
    sparklineData,
    unifiedChartData,
    sportMeta,
    validSports,
    distanceUnit: userSettings.distanceUnit,
    isLoading,
    error,
    activityPageSize,
    sparklineContainerHeight,
    hasAnyData,
    MAX_SPORTS_DISPLAY,
    SPARKLINE_ROW_HEIGHT,
    SPARKLINE_XAXIS_HEIGHT,
  };
}
