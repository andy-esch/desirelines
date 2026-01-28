/**
 * Chart Utility Functions
 *
 * Pure functions for data transformation used by chart components.
 * Extracted for testability and reuse.
 *
 * @see MultiSportComparisonChart - Primary consumer of these utilities
 */

import type { TimeRange } from "./dataNormalization";
import type { DailyActivity, SportConfig } from "../api/activities";
import type { DailySportData } from "../hooks/useDailySportData";
import { isDistanceSport } from "./sportConfig";
import { generateDateRange } from "./dateUtils";

/**
 * Get the primary metric value for a sport from daily activity data.
 * Returns distance for distance-based sports, time for time-based sports.
 *
 * @param activity - Daily activity data containing metrics
 * @param sport - Sport key (e.g., "cycling", "yoga")
 * @param sportConfig - Sport configuration from API
 * @returns Primary metric value (meters for distance sports, minutes for time sports)
 *
 * @example
 * ```ts
 * getMetricValue({ distanceMeters: 5000, timeMinutes: 30 }, "cycling", config);
 * // Returns 5000 (distance)
 *
 * getMetricValue({ distanceMeters: 0, timeMinutes: 60 }, "yoga", config);
 * // Returns 60 (time)
 * ```
 */
export function getMetricValue(
  activity: DailyActivity,
  sport: string,
  sportConfig: SportConfig | null
): number {
  if (isDistanceSport(sport, sportConfig)) {
    return activity.distanceMeters ?? 0;
  }
  return activity.timeMinutes ?? 0;
}

/**
 * Convert daily sport data (map) to sorted array with primary metric values.
 *
 * When a dateRange is provided, generates a dense array with all dates in the range,
 * filling zeros for days without activity. This ensures charts show gaps in training
 * rather than connecting directly between activity days.
 *
 * @param data - Map of date strings to daily activity data
 * @param sport - Sport key (e.g., "cycling")
 * @param sportConfig - Sport configuration from API
 * @param dateRange - Optional date range to fill. If provided, generates entries for all dates.
 * @returns Array of { date, value } objects sorted by date ascending
 *
 * @example
 * ```ts
 * const data = {
 *   "2026-01-03": { distanceMeters: 5000, activities: 1 },
 *   "2026-01-01": { distanceMeters: 3000, activities: 1 },
 * };
 *
 * // Without dateRange - sparse array (original behavior)
 * toDailyArray(data, "cycling", config);
 * // Returns [
 * //   { date: "2026-01-01", value: 3000 },
 * //   { date: "2026-01-03", value: 5000 },
 * // ]
 *
 * // With dateRange - dense array with zeros for missing days
 * toDailyArray(data, "cycling", config, { from: "2026-01-01", to: "2026-01-03" });
 * // Returns [
 * //   { date: "2026-01-01", value: 3000 },
 * //   { date: "2026-01-02", value: 0 },
 * //   { date: "2026-01-03", value: 5000 },
 * // ]
 * ```
 */
export function toDailyArray(
  data: DailySportData,
  sport: string,
  sportConfig: SportConfig | null,
  dateRange?: { from: string; to: string }
): { date: string; value: number }[] {
  // If dateRange provided, generate dense array with all dates
  if (dateRange) {
    const allDates = generateDateRange(dateRange.from, dateRange.to);
    return allDates.map((date) => ({
      date,
      value: data[date] ? getMetricValue(data[date], sport, sportConfig) : 0,
    }));
  }

  // Original sparse behavior (no date range)
  const entries = Object.entries(data);
  if (entries.length === 0) return [];

  return entries
    .map(([date, activity]) => ({
      date,
      value: getMetricValue(activity, sport, sportConfig),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get the cutoff date for a time range.
 *
 * @param now - Reference date (typically today)
 * @param timeRange - Time range specifier
 * @returns Date representing the start of the time range
 *
 * @example
 * ```ts
 * const now = new Date("2026-01-15");
 *
 * getTimeRangeCutoff(now, "2weeks");
 * // Returns Date for 2026-01-01
 *
 * getTimeRangeCutoff(now, "ytd");
 * // Returns Date for 2026-01-01 00:00:00
 * ```
 */
export function getTimeRangeCutoff(now: Date, timeRange: TimeRange): Date {
  const cutoff = new Date(now);

  switch (timeRange) {
    case "2weeks":
      cutoff.setDate(now.getDate() - 14);
      break;
    case "4weeks":
      cutoff.setDate(now.getDate() - 28);
      break;
    case "2months":
      cutoff.setMonth(now.getMonth() - 2);
      break;
    case "6months":
      cutoff.setMonth(now.getMonth() - 6);
      break;
    case "ytd":
      cutoff.setMonth(0);
      cutoff.setDate(1);
      cutoff.setHours(0, 0, 0, 0);
      break;
  }

  return cutoff;
}

/**
 * Normalize daily values to 0-1 scale for sparkline display.
 *
 * This function maps the range of values to a 0-1 scale where:
 * - The minimum value maps to 0
 * - The maximum value maps to 1
 * - If all values are the same, returns 0.5 (flat line in middle)
 *
 * @param data - Array of { date, value } objects
 * @returns Array of { date, value } objects with values normalized to 0-1
 *
 * @example
 * ```ts
 * normalizeToRange([
 *   { date: "2026-01-01", value: 100 },
 *   { date: "2026-01-02", value: 200 },
 *   { date: "2026-01-03", value: 150 },
 * ]);
 * // Returns [
 * //   { date: "2026-01-01", value: 0 },
 * //   { date: "2026-01-02", value: 1 },
 * //   { date: "2026-01-03", value: 0.5 },
 * // ]
 *
 * // Edge case: all same values
 * normalizeToRange([
 *   { date: "2026-01-01", value: 100 },
 *   { date: "2026-01-02", value: 100 },
 * ]);
 * // Returns [
 * //   { date: "2026-01-01", value: 0.5 },
 * //   { date: "2026-01-02", value: 0.5 },
 * // ]
 * ```
 */
export function normalizeToRange(
  data: { date: string; value: number }[]
): { date: string; value: number }[] {
  if (data.length === 0) return [];

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // If no range, return flat line at 0.5
  if (range === 0) {
    return data.map((d) => ({ date: d.date, value: 0.5 }));
  }

  return data.map((d) => ({
    date: d.date,
    value: (d.value - min) / range,
  }));
}
