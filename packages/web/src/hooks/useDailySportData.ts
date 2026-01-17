import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { fetchDailySummary, type DailyActivity } from "../api/activities";
import { generateDemoDailyData, getSessionFillLevels } from "../utils/demoDataGenerator";

/**
 * @deprecated Use string sport keys instead. Kept for backwards compatibility.
 */
export type Sport = "cycling" | "running" | "yoga";

/** Daily data for a single sport - map of date to activity */
export type DailySportData = Record<string, DailyActivity>;

/** Daily data for multiple sports - dynamic record */
export type MultiSportData = Record<string, DailySportData>;

/**
 * @deprecated Use MultiSportData instead. Kept for backwards compatibility.
 */
export interface MultiDailySportData {
  cycling: DailySportData;
  running: DailySportData;
  yoga: DailySportData;
}

export interface DailySportDataResult {
  /** Daily data for each requested sport */
  data: MultiSportData;
  /** True while fetching data */
  isLoading: boolean;
  /** Error if fetch failed */
  error: Error | null;
}

export interface UseDailySportDataOptions {
  /** Year for the query (used in URL path) */
  year: number;
  /** Start date (YYYY-MM-DD) for date-range queries */
  from: string;
  /** End date (YYYY-MM-DD) for date-range queries */
  to: string;
  /**
   * Sports to fetch data for.
   * If not provided, defaults to ["cycling", "running", "yoga"] for backwards compatibility.
   */
  sports?: string[];
}

/**
 * Hook for fetching daily activity data for multiple sports from the /source endpoint.
 * Returns daily totals (not cumulative) for each day with activity.
 *
 * For unauthenticated users, generates demo data for all sports using
 * sensible defaults based on sport properties.
 *
 * @example
 * ```tsx
 * // Fetch data for specific sports
 * const { data, isLoading } = useDailySportData({
 *   year: 2026,
 *   from: "2026-01-01",
 *   to: "2026-01-31",
 *   sports: ["cycling", "running", "hiking"]
 * });
 *
 * // Access data per sport
 * const cyclingData = data.cycling;
 * const hikingData = data.hiking;
 * ```
 */
/** Default sports for backwards compatibility */
const DEFAULT_SPORTS = ["cycling", "running", "yoga"];

export function useDailySportData(options: UseDailySportDataOptions): DailySportDataResult {
  const { user, loading: authLoading } = useAuth();

  const { year, from, to } = options;
  // Note: Callers must ensure `options.sports` is referentially stable (memoized) to prevent
  // unnecessary re-renders or query churn. We avoid internal memoization hacks here.
  const sports = options.sports ?? DEFAULT_SPORTS;

  // Generate demo data using useMemo for stability
  const demoData = useMemo(() => {
    // Get coordinated fill levels for all requested sports
    const fillLevels = getSessionFillLevels(sports);
    const result: MultiSportData = {};

    for (const sport of sports) {
      const fillLevel = fillLevels[sport] ?? "full";
      result[sport] = generateDemoDailyData(sport, from, to, {
        overrideFillLevel: fillLevel,
        allSports: sports,
      });
    }

    return result;
  }, [sports, from, to]);

  const queries = useQueries({
    queries: sports.map((sport) => ({
      queryKey: ["dailySummary", year, sport, from, to],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchDailySummary({
          year,
          sport,
          from,
          to,
          signal,
        }),
      enabled: !authLoading && !!user,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const data = useMemo(() => {
    if (!user) return demoData;

    const result: MultiSportData = {};
    // Initialize all sports with empty objects to prevent undefined access
    for (const sport of sports) {
      result[sport] = {};
    }

    queries.forEach((query, index) => {
      const sport = sports[index];
      if (query.data) {
        result[sport] = query.data;
      }
    });
    return result;
  }, [user, demoData, queries, sports]);

  const isQueriesLoading = queries.some((q) => q.isLoading);
  const queryError = queries.find((q) => q.error)?.error;

  return {
    data,
    isLoading: authLoading || (!!user && isQueriesLoading),
    error: (queryError as Error) || null,
  };
}
