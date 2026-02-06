import { useState, useMemo } from "react";
import { useDailySportData } from "../hooks/useDailySportData";
import { useVisibleSports } from "../hooks/useVisibleSports";
import { useSportConfig } from "../hooks/useSportConfig";
import type { TimeRange } from "../utils/dataNormalization";
import {
  getSportDisplayName,
  filterValidSports,
  isDistanceSport,
  isTimeSport,
} from "../utils/sportConfig";
import { toDailyArray, normalizeToRange, getTimeRangeCutoff } from "../utils/chartUtils";
import { toLocalDateString } from "../utils/dateUtils";

const SPARKLINE_ROW_HEIGHT = 36;
const SPARKLINE_XAXIS_HEIGHT = 24;
const SPARKLINE_PADDING = 16;
const MIN_SPORTS_FOR_HEIGHT = 3;
const MAX_SPORTS_DISPLAY = 8;

/**
 * NEON spectrum colors for sparklines (top to bottom).
 * Uses the project's NEON color theme from chartColors.ts.
 * Progression: Magenta -> Cyan -> Green -> Yellow -> Orange
 */
const SPARKLINE_SPECTRUM = [
  { r: 255, g: 0, b: 255 }, // Magenta (top)
  { r: 0, g: 255, b: 255 }, // Electric Cyan
  { r: 0, g: 255, b: 128 }, // Neon Green-Cyan
  { r: 255, g: 200, b: 0 }, // Neon Yellow-Orange
  { r: 255, g: 95, b: 31 }, // Orange (bottom)
] as const;

/**
 * Interpolate between two RGB colors.
 */
function interpolateColor(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  };
}

/**
 * Generate a NEON spectrum color based on position.
 * Interpolates through: Magenta -> Cyan -> Green -> Yellow -> Orange (top to bottom)
 *
 * @param index - Position in the list (0 = top)
 * @param total - Total number of items
 * @returns RGB color string
 */
export function getSpectrumColor(index: number, total: number): string {
  if (total <= 1) {
    const c = SPARKLINE_SPECTRUM[0];
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }

  // Map index to position in the spectrum (0 to 1)
  const t = index / (total - 1);

  // Find which segment of the spectrum we're in
  const numSegments = SPARKLINE_SPECTRUM.length - 1;
  const segmentIndex = Math.min(Math.floor(t * numSegments), numSegments - 1);
  const segmentT = t * numSegments - segmentIndex;

  const c1 = SPARKLINE_SPECTRUM[segmentIndex];
  const c2 = SPARKLINE_SPECTRUM[segmentIndex + 1];
  const color = interpolateColor(c1, c2, segmentT);

  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

/**
 * Get a darker version of a spectrum color for text labels.
 * Reduces brightness while maintaining the hue.
 */
function getSpectrumTextColor(index: number, total: number): string {
  if (total <= 1) {
    const c = SPARKLINE_SPECTRUM[0];
    // Darken by reducing each channel by ~50%
    return `rgb(${Math.round(c.r * 0.5)}, ${Math.round(c.g * 0.5)}, ${Math.round(c.b * 0.5)})`;
  }

  const t = index / (total - 1);
  const numSegments = SPARKLINE_SPECTRUM.length - 1;
  const segmentIndex = Math.min(Math.floor(t * numSegments), numSegments - 1);
  const segmentT = t * numSegments - segmentIndex;

  const c1 = SPARKLINE_SPECTRUM[segmentIndex];
  const c2 = SPARKLINE_SPECTRUM[segmentIndex + 1];
  const color = interpolateColor(c1, c2, segmentT);

  // Darken for text readability (reduce by ~50%)
  return `rgb(${Math.round(color.r * 0.5)}, ${Math.round(color.g * 0.5)}, ${Math.round(color.b * 0.5)})`;
}

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
      // 1. Convert daily data map to sorted array (dense - fills zeros for missing days)
      const dailyValues = toDailyArray(sportData, sport, sportConfig, { from, to });
      // 2. Normalize to 0-1 for sparkline display
      const normalized = normalizeToRange(dailyValues);

      // Find year with most recent actual activity (not filled zeros)
      // Uses raw data keys since they only contain dates with activity
      const activityDates = Object.keys(sportData).sort();
      const lastActivityDate =
        activityDates.length > 0 ? activityDates[activityDates.length - 1] : null;
      const lastActivityYear = lastActivityDate
        ? parseInt(lastActivityDate.split("-")[0], 10)
        : new Date().getFullYear();

      return {
        sport,
        displayName: getSportDisplayName(sport, sportConfig),
        data: normalized,
        rawData: dailyValues, // Keep raw values for tooltip display
        isDistanceSport: isDistanceSport(sport, sportConfig),
        isTimeSport: isTimeSport(sport, sportConfig),
        lastActivityYear,
      };
    });
  }, [validSports, data, sportConfig, from, to]);

  // Merged data for unified chart: [{date, sport1: value, sport2: value, sport1_raw: rawValue, ...}]
  // Each sport gets a vertical offset to create stacked "lanes"
  // Raw values are stored with _raw suffix for tooltip display
  const unifiedChartData = useMemo(() => {
    if (sparklineData.length === 0) return [];

    const numSports = sparklineData.length;
    // Leave some padding between lanes (80% of lane used for data, 20% gap)
    const laneHeight = 1 / numSports;
    const dataHeight = laneHeight * 0.8;
    const padding = laneHeight * 0.1; // Padding on each side

    // All sports have same dates (dense arrays), use first sport's dates as base
    const dates = sparklineData[0]?.data.map((d) => d.date) ?? [];

    return dates.map((date, dateIndex) => {
      const entry: Record<string, string | number> = { date };
      sparklineData.forEach((sportData, sportIndex) => {
        const normalizedValue = sportData.data[dateIndex]?.value ?? 0.5;
        const rawValue = sportData.rawData[dateIndex]?.value ?? 0;
        // Stack from top to bottom: first sport at top, last at bottom
        const baseOffset = (numSports - 1 - sportIndex) * laneHeight + padding;
        // Scale normalized value (0-1) to fit within the lane
        entry[sportData.sport] = baseOffset + normalizedValue * dataHeight;
        // Store raw value for tooltip
        entry[`${sportData.sport}_raw`] = rawValue;
      });
      return entry;
    });
  }, [sparklineData]);

  // Sport metadata for chart legend and styling
  // Uses rainbow spectrum colors based on vertical position
  const sportMeta = useMemo(() => {
    const total = sparklineData.length;
    return sparklineData.map(
      (
        { sport, displayName, lastActivityYear, isDistanceSport: isDistance, isTimeSport: isTime },
        index
      ) => ({
        sport,
        displayName,
        color: getSpectrumColor(index, total),
        textColor: getSpectrumTextColor(index, total),
        lastActivityYear,
        isDistanceSport: isDistance,
        isTimeSport: isTime,
      })
    );
  }, [sparklineData]);

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

  // Check raw data for any actual activity (before normalization converts zeros to 0.5)
  const hasAnyData = validSports.some((sport) => {
    const sportData = data[sport];
    return sportData && Object.keys(sportData).length > 0;
  });

  return {
    timeRange,
    setTimeRange,
    sparklineData,
    unifiedChartData,
    sportMeta,
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
