import { useState, useMemo } from "react";
import { useDailySportData } from "../hooks/useDailySportData";
import { useVisibleSports } from "../hooks/useVisibleSports";
import { useSportConfig } from "../hooks/useSportConfig";
import type { TimeRange } from "../utils/dataNormalization";
import {
  getSportColor,
  getSportTextColor,
  getSportDisplayName,
  filterValidSports,
} from "../utils/sportConfig";
import { toDailyArray, normalizeToRange, getTimeRangeCutoff } from "../utils/chartUtils";
import { toLocalDateString } from "../utils/dateUtils";

const SPARKLINE_ROW_HEIGHT = 36;
const SPARKLINE_XAXIS_HEIGHT = 24;
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
 * Handles:
 * - Time range state
 * - Fetching data for multiple visible sports
 * - Normalizing data for sparklines (0-1 scale)
 * - Coordinating layout calculations (height, page size)
 */
export function useMultiSportChartData() {
  const currentYear = new Date().getFullYear();
  const [timeRange, setTimeRange] = useState<TimeRange>("2weeks");

  // Get visible sports and sport config
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();

  // Filter visible sports to only those in config (handles edge case of stale prefs)
  const validSports = useMemo(
    () => filterValidSports(visibleSports, sportConfig),
    [visibleSports, sportConfig]
  );

  // Calculate date range for API query
  const { from, to } = useMemo(() => getDateRangeFromTimeRange(timeRange), [timeRange]);

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
  });

  // Process data for each sport's sparkline
  const sparklineData = useMemo(() => {
    return validSports.map((sport) => {
      const sportData = data[sport] ?? {};
      // 1. Convert daily data map to sorted array
      const dailyValues = toDailyArray(sportData, sport, sportConfig);
      // 2. Normalize to 0-1 for sparkline display
      const normalized = normalizeToRange(dailyValues);
      return {
        sport,
        displayName: getSportDisplayName(sport, sportConfig),
        color: getSportColor(sport),
        textColor: getSportTextColor(sport),
        data: normalized,
      };
    });
  }, [validSports, data, sportConfig]);

  // Calculate dynamic height based on number of sports
  const displayCount = Math.min(
    Math.max(validSports.length, MIN_SPORTS_FOR_HEIGHT),
    MAX_SPORTS_DISPLAY
  );
  const sparklineContainerHeight =
    displayCount * SPARKLINE_ROW_HEIGHT + SPARKLINE_XAXIS_HEIGHT + SPARKLINE_PADDING;

  // Calculate page size for activities
  const activityPageSize = getActivityPageSize(validSports.length);

  // Combined loading state
  const isLoading = prefsLoading || configLoading || dataLoading;

  const hasAnyData = sparklineData.some((s) => s.data.length > 0);

  return {
    timeRange,
    setTimeRange,
    sparklineData,
    validSports,
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
