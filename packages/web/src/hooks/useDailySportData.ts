import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useTimezone } from "./usePreferences";
import { fetchMultiSportDailySummary, type DailyActivity } from "../api/activities";
import {
  generateDemoDailyData,
  getSessionFillLevels,
  type TuningParams,
} from "../utils/demoDataGenerator";

/** Daily data for a single sport - map of date to activity */
export type DailySportData = Record<string, DailyActivity>;

/** Daily data for multiple sports - dynamic record */
export type MultiSportData = Record<string, DailySportData>;

export interface DailySportDataResult {
  /** Daily data for each requested sport */
  data: MultiSportData;
  /** True while fetching data */
  isLoading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Fetches the days again after a failure. */
  retry: () => void;
}

export interface UseDailySportDataOptions {
  /** Year for the query (used in URL path) */
  year: number;
  /** Start date (YYYY-MM-DD) for date-range queries */
  from: string;
  /** End date (YYYY-MM-DD) for date-range queries */
  to: string;
  /** Sports to fetch data for; keep the array stable across renders (memoize it). */
  sports: string[];
  /** Tuning overrides for distribution parameters (demo mode only) */
  tuningParams?: TuningParams | undefined;
}

/**
 * Generated demo days per request (sports, range and tuning), kept for the page's lifetime.
 * Cards that ask the same question, such as the dashboard hero's week total and the This
 * Week card, then show the same generated activities instead of two random draws.
 */
const demoDataCache = new Map<string, MultiSportData>();
/** Enough for every range a demo session realistically opens; the oldest entry goes first. */
const DEMO_CACHE_LIMIT = 24;

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
export function useDailySportData(options: UseDailySportDataOptions): DailySportDataResult {
  const { user, loading: authLoading } = useAuth();
  const tz = useTimezone();

  // Callers keep `sports` referentially stable (memoized) to avoid query churn.
  const { year, from, to, sports, tuningParams } = options;

  // Generate demo data only for unauthenticated users (skip when signed in)
  const demoData = useMemo(() => {
    if (user) return {};

    const cacheKey = JSON.stringify([[...sports].sort(), from, to, tuningParams ?? null]);
    const cached = demoDataCache.get(cacheKey);
    if (cached) return cached;

    // Get coordinated fill levels for all requested sports
    const fillLevels = getSessionFillLevels(sports);
    const result: MultiSportData = {};

    for (const sport of sports) {
      const fillLevel = fillLevels[sport] ?? "full";
      result[sport] = generateDemoDailyData(sport, from, to, {
        overrideFillLevel: fillLevel,
        allSports: sports,
        tuningParams,
      });
    }

    if (demoDataCache.size >= DEMO_CACHE_LIMIT) {
      const oldest = demoDataCache.keys().next().value;
      if (oldest !== undefined) demoDataCache.delete(oldest);
    }
    demoDataCache.set(cacheKey, result);
    return result;
  }, [user, sports, from, to, tuningParams]);

  // Sort sports for stable query key (cache invalidates when visibility changes)
  const sortedSports = useMemo(() => [...sports].sort(), [sports]);

  const query = useQuery({
    queryKey: ["dailySummary", user?.uid, year, sortedSports, from, to, tz],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchMultiSportDailySummary({
        year,
        sports: sortedSports,
        from,
        to,
        tz,
        signal,
      }),
    enabled: !authLoading && !!user,
    staleTime: 5 * 60 * 1000,
  });

  const data = useMemo(() => {
    if (!user) return demoData;

    const result: MultiSportData = {};
    // Initialize all sports with empty objects to prevent undefined access
    for (const sport of sports) {
      result[sport] = query.data?.[sport] ?? {};
    }
    return result;
  }, [user, demoData, query.data, sports]);

  return {
    data,
    isLoading: authLoading || (!!user && query.isLoading),
    error: query.error || null,
    retry: () => void query.refetch(),
  };
}
