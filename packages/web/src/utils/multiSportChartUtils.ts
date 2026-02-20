import type { DailyActivity } from "../api/activities";
import type { SportConfig } from "../utils/sportConfig";
import { toDailyArray, normalizeToRange } from "./chartUtils";
import { getSpectrumColor, getSpectrumTextColor } from "./chartColors";
import { getSportDisplayName, isDistanceSport, isTimeSport } from "./sportConfig";

/** Midpoint value used for days with no activity in normalized (0-1) sparkline display */
const NORMALIZED_BASELINE = 0.5;

interface DateRange {
  from: string;
  to: string;
}

export interface ProcessedSportData {
  sport: string;
  displayName: string;
  data: { date: string; value: number }[];
  rawData: { date: string; value: number }[];
  isDistanceSport: boolean;
  isTimeSport: boolean;
  lastActivityYear: number;
}

/**
 * Normalizes metrics data for a single sport into a 0-1 scale.
 */
export function processSportSparkline(
  sport: string,
  sportData: Record<string, DailyActivity>,
  sportConfig: SportConfig | null,
  range: DateRange,
  currentYear: number
): ProcessedSportData {
  // 1. Convert daily data map to sorted array (dense - fills zeros for missing days)
  const dailyValues = toDailyArray(sportData, sport, sportConfig, range);
  // 2. Normalize to 0-1 for sparkline display
  const normalized = normalizeToRange(dailyValues);

  // Find year with most recent actual activity
  const activityDates = Object.keys(sportData).sort();
  const lastActivityDate =
    activityDates.length > 0 ? activityDates[activityDates.length - 1] : null;
  const lastActivityYear = lastActivityDate
    ? parseInt(lastActivityDate.split("-")[0], 10)
    : currentYear;

  return {
    sport,
    displayName: getSportDisplayName(sport, sportConfig),
    data: normalized,
    rawData: dailyValues,
    isDistanceSport: isDistanceSport(sport, sportConfig),
    isTimeSport: isTimeSport(sport, sportConfig),
    lastActivityYear,
  };
}

/**
 * Merges processed sparkline data into a single array for Recharts.
 * Calculates vertical offsets for "lane" based stacking.
 */
export function mergeSparklineData(sparklineData: ProcessedSportData[]) {
  if (sparklineData.length === 0) return [];

  const numSports = sparklineData.length;
  const laneHeight = 1 / numSports;
  const dataHeight = laneHeight * 0.8;
  const padding = laneHeight * 0.1;

  const dates = sparklineData[0]?.data.map((d) => d.date) ?? [];

  return dates.map((date: string, dateIndex: number) => {
    const entry: Record<string, string | number> = { date };
    sparklineData.forEach((sportData, sportIndex) => {
      const normalizedValue = sportData.data[dateIndex]?.value ?? NORMALIZED_BASELINE;
      const rawValue = sportData.rawData[dateIndex]?.value ?? 0;
      const baseOffset = (numSports - 1 - sportIndex) * laneHeight + padding;
      entry[sportData.sport] = baseOffset + normalizedValue * dataHeight;
      entry[`${sportData.sport}_raw`] = rawValue;
    });
    return entry;
  });
}

/**
 * Generates metadata for each sport, including spectrum colors.
 */
export function getSportMetadata(sparklineData: ProcessedSportData[]) {
  const total = sparklineData.length;
  return sparklineData.map((data, index) => ({
    sport: data.sport,
    displayName: data.displayName,
    color: getSpectrumColor(index, total),
    textColor: getSpectrumTextColor(index, total),
    lastActivityYear: data.lastActivityYear,
    isDistanceSport: data.isDistanceSport,
    isTimeSport: data.isTimeSport,
  }));
}
