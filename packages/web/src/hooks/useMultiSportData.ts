import { useState, useEffect, useMemo } from "react";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";
import { fetchSportMetrics, type SportMetrics } from "../api/activities";
import { generateDemoMetrics, generateCoordinatedFillLevels } from "../utils/demoDataGenerator";

export type Sport = "cycling" | "running" | "yoga";

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
 * Automatically uses generated demo data for unauthenticated users and API for authenticated users.
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

  // Generate demo data using useMemo for stability
  // Uses coordinated fill levels to ensure at most one sport is empty
  const demoData = useMemo(() => {
    const fillLevels = generateCoordinatedFillLevels();
    return {
      cycling: generateDemoMetrics("cycling", year, fillLevels.cycling),
      running: generateDemoMetrics("running", year, fillLevels.running),
      yoga: generateDemoMetrics("yoga", year, fillLevels.yoga),
    };
  }, [year]);

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
          // Unauthenticated: use generated demo data
          setData(demoData);
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
  }, [year, user, authLoading, getToken, demoData]);

  return { data, isLoading, error };
}
