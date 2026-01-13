import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";
import { fetchDailySummary, type DailyActivity } from "../api/activities";
import {
  generateDemoDailyData,
  generateCoordinatedFillLevels,
  type DemoSport,
} from "../utils/demoDataGenerator";

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

/** Sports that have demo data configured */
const DEMO_SPORTS = new Set(["cycling", "running", "yoga"]);

/**
 * Hook for fetching daily activity data for multiple sports from the /source endpoint.
 * Returns daily totals (not cumulative) for each day with activity.
 *
 * For unauthenticated users, generates demo data for cycling/running/yoga.
 * Other sports return empty data in demo mode.
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
  const { getToken } = useAuthToken();

  const { year, from, to } = options;

  /**
   * Memoize sports array to maintain referential stability.
   *
   * WHY: Callers often pass inline arrays like `sports={["cycling", "running"]}`.
   * These create new array references on every render, causing unnecessary
   * re-fetches and re-renders.
   *
   * HOW: Using `join(",")` as the dependency creates a stable string key.
   * The sports array only updates when the actual sport names change,
   * not when the array reference changes.
   *
   * IMPORTANT: Do not "fix" this by removing the join() - it will break
   * the hook for callers using inline arrays.
   */
  const sports = useMemo(
    () => options.sports ?? DEFAULT_SPORTS,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: use string key for value-based comparison
    [options.sports?.join(",")]
  );

  // Track which sports we're currently managing to avoid stale data
  const sportsKey = sports.slice().sort().join(",");

  const [data, setData] = useState<MultiSportData>(() => {
    // Initialize with empty data for all requested sports
    const initial: MultiSportData = {};
    for (const sport of sports) {
      initial[sport] = {};
    }
    return initial;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track previous sports to detect changes
  const prevSportsKeyRef = useRef(sportsKey);

  // Generate demo data using useMemo for stability
  // Uses coordinated fill levels to ensure at most one sport is empty
  const demoData = useMemo(() => {
    const fillLevels = generateCoordinatedFillLevels();
    const result: MultiSportData = {};

    for (const sport of sports) {
      if (DEMO_SPORTS.has(sport)) {
        // Generate demo data for known demo sports
        const demoSport = sport as DemoSport;
        const fillLevel = fillLevels[demoSport] ?? "empty";
        result[sport] = generateDemoDailyData(demoSport, from, to, fillLevel);
      } else {
        // Other sports get empty data in demo mode
        result[sport] = {};
      }
    }

    return result;
  }, [sports, from, to]);

  useEffect(() => {
    // Reset data if sports changed
    if (prevSportsKeyRef.current !== sportsKey) {
      const initial: MultiSportData = {};
      for (const sport of sports) {
        initial[sport] = {};
      }
      setData(initial);
      prevSportsKeyRef.current = sportsKey;
    }

    // Wait for auth to settle
    if (authLoading) {
      return;
    }

    const controller = new AbortController();

    async function loadData() {
      setIsLoading(true);
      setError(null);

      try {
        if (user) {
          // Authenticated: fetch from API for all requested sports
          const idToken = await getToken();

          const fetchPromises = sports.map((sport) =>
            fetchDailySummary({
              year,
              sport,
              from,
              to,
              signal: controller.signal,
              idToken,
            }).then((sportData) => ({ sport, data: sportData }))
          );

          const results = await Promise.all(fetchPromises);

          if (!controller.signal.aborted) {
            const newData: MultiSportData = {};
            for (const { sport, data: sportData } of results) {
              newData[sport] = sportData;
            }
            setData(newData);
          }
        } else {
          // Unauthenticated: use generated demo data
          setData(demoData);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[useDailySportData] Error fetching data:", err);
          setError(err instanceof Error ? err : new Error("Failed to load data"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => controller.abort();
  }, [year, from, to, sportsKey, user, authLoading, getToken, demoData, sports]);

  return { data, isLoading, error };
}
