import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";
import { fetchSportMetrics, type SportMetrics, type MetricsEntry } from "../api/activities";
import { FIXTURE_SPORT_METRICS } from "../data/fixtures";

export type Sport = "cycling" | "running" | "yoga";

/**
 * Filter fixture data to only include entries up to today's date.
 * This makes fixtures appear "live" - they grow as time passes.
 */
function filterToCurrentDate(data: MetricsEntry[]): MetricsEntry[] {
  const today = new Date().toISOString().split("T")[0];
  return data.filter((entry) => entry.date <= today);
}

export interface MultiSportData {
  cycling: SportMetrics | null;
  running: SportMetrics | null;
  yoga: SportMetrics | null;
}

export interface MultiSportDataResult {
  data: MultiSportData;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for fetching metrics for all sports (cycling, running, yoga).
 * Automatically uses fixtures for unauthenticated users and API for authenticated users.
 *
 * @param year - The year to fetch data for
 * @returns Object containing data for all sports, loading state, and errors
 */
export function useMultiSportData(year: number): MultiSportDataResult {
  const { user, loading: authLoading } = useAuth();
  const { getToken } = useAuthToken();

  const [data, setData] = useState<MultiSportData>({
    cycling: null,
    running: null,
    yoga: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
            fetchSportMetrics(year, "cycling", controller.signal, idToken),
            fetchSportMetrics(year, "running", controller.signal, idToken),
            fetchSportMetrics(year, "yoga", controller.signal, idToken),
          ]);

          if (!controller.signal.aborted) {
            setData({ cycling, running, yoga });
          }
        } else {
          // Unauthenticated: use fixtures, filtered to current date
          const cycling = filterToCurrentDate(FIXTURE_SPORT_METRICS.cycling?.[year] || []);
          const running = filterToCurrentDate(FIXTURE_SPORT_METRICS.running?.[year] || []);
          const yoga = filterToCurrentDate(FIXTURE_SPORT_METRICS.yoga?.[year] || []);

          setData({ cycling, running, yoga });
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
  }, [year, user, authLoading, getToken]);

  return { data, isLoading, error };
}
