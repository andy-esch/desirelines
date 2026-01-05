import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";
import { fetchDailySummary, type DailyActivity } from "../api/activities";

export type Sport = "cycling" | "running" | "yoga";

/** Daily data for a single sport - map of date to activity */
export type DailySportData = Record<string, DailyActivity>;

/** Daily data for all sports */
export interface MultiDailySportData {
  cycling: DailySportData;
  running: DailySportData;
  yoga: DailySportData;
}

export interface DailySportDataResult {
  data: MultiDailySportData;
  isLoading: boolean;
  error: Error | null;
}

export interface UseDailySportDataOptions {
  /** Year for the query (used in URL path) */
  year: number;
  /** Start date (YYYY-MM-DD) for date-range queries */
  from: string;
  /** End date (YYYY-MM-DD) for date-range queries */
  to: string;
}

/**
 * Hook for fetching daily activity data for all sports from the /source endpoint.
 * Returns daily totals (not cumulative) for each day with activity.
 *
 * For unauthenticated users, returns empty data (demo mode not implemented for daily data).
 */
export function useDailySportData(options: UseDailySportDataOptions): DailySportDataResult {
  const { user, loading: authLoading } = useAuth();
  const { getToken } = useAuthToken();

  const [data, setData] = useState<MultiDailySportData>({
    cycling: {},
    running: {},
    yoga: {},
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Memoize options to prevent unnecessary re-fetches
  const { year, from, to } = options;

  useEffect(() => {
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
          // Authenticated: fetch from API
          const idToken = await getToken();

          const [cycling, running, yoga] = await Promise.all([
            fetchDailySummary({
              year,
              sport: "cycling",
              from,
              to,
              signal: controller.signal,
              idToken,
            }),
            fetchDailySummary({
              year,
              sport: "running",
              from,
              to,
              signal: controller.signal,
              idToken,
            }),
            fetchDailySummary({
              year,
              sport: "yoga",
              from,
              to,
              signal: controller.signal,
              idToken,
            }),
          ]);

          if (!controller.signal.aborted) {
            setData({ cycling, running, yoga });
          }
        } else {
          // Unauthenticated: return empty data
          // (Could generate demo data here if needed)
          setData({ cycling: {}, running: {}, yoga: {} });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
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
  }, [year, from, to, user, authLoading, getToken]);

  return { data, isLoading, error };
}
