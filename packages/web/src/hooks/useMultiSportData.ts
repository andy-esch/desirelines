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

/** Options for fetching multi-sport data */
export interface UseMultiSportDataOptions {
  /** Year for year-based queries (used by Goal pages) */
  year?: number;
  /** Start date (YYYY-MM-DD) for date-range queries (used by Dashboard) */
  from?: string;
  /** End date (YYYY-MM-DD) for date-range queries (used by Dashboard) */
  to?: string;
}

/**
 * Hook for fetching metrics for all sports (cycling, running, yoga).
 * Automatically uses generated demo data for unauthenticated users and API for authenticated users.
 *
 * Supports two query modes:
 * - Year-based: Pass a year number (for Goal pages)
 * - Date-range: Pass { from, to } (for Dashboard, can span years)
 *
 * @param yearOrOptions - Year number for backwards compatibility, or options object
 * @returns Object containing data for all sports, loading state, and errors
 */
export function useMultiSportData(
  yearOrOptions: number | UseMultiSportDataOptions
): MultiSportDataResult {
  // Normalize to options object
  const options: UseMultiSportDataOptions =
    typeof yearOrOptions === "number" ? { year: yearOrOptions } : yearOrOptions;

  // Determine query mode and effective year (for demo data generation)
  const isDateRangeMode = !!(options.from && options.to);
  const effectiveYear = options.year ?? new Date().getFullYear();
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
  // When in date-range mode that spans years, generate data for both years
  const demoData = useMemo(() => {
    const fillLevels = generateCoordinatedFillLevels();
    const previousYear = effectiveYear - 1;

    // Check if date range spans into previous year
    const needsPreviousYear =
      isDateRangeMode && options.from && options.from.startsWith(String(previousYear));

    if (needsPreviousYear) {
      // Generate for both years and concatenate
      return {
        cycling: [
          ...generateDemoMetrics("cycling", previousYear, fillLevels.cycling),
          ...generateDemoMetrics("cycling", effectiveYear, fillLevels.cycling),
        ],
        running: [
          ...generateDemoMetrics("running", previousYear, fillLevels.running),
          ...generateDemoMetrics("running", effectiveYear, fillLevels.running),
        ],
        yoga: [
          ...generateDemoMetrics("yoga", previousYear, fillLevels.yoga),
          ...generateDemoMetrics("yoga", effectiveYear, fillLevels.yoga),
        ],
      };
    }

    return {
      cycling: generateDemoMetrics("cycling", effectiveYear, fillLevels.cycling),
      running: generateDemoMetrics("running", effectiveYear, fillLevels.running),
      yoga: generateDemoMetrics("yoga", effectiveYear, fillLevels.yoga),
    };
  }, [effectiveYear, isDateRangeMode, options.from]);

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

          // Build fetch options based on query mode
          const baseOptions = {
            year: effectiveYear,
            signal: controller.signal,
            idToken,
            ...(isDateRangeMode ? { from: options.from, to: options.to } : {}),
          };

          const [cycling, running, yoga] = await Promise.all([
            fetchSportMetrics({ ...baseOptions, sport: "cycling" }),
            fetchSportMetrics({ ...baseOptions, sport: "running" }),
            fetchSportMetrics({ ...baseOptions, sport: "yoga" }),
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
  }, [
    effectiveYear,
    options.from,
    options.to,
    isDateRangeMode,
    user,
    authLoading,
    getToken,
    demoData,
  ]);

  return { data, isLoading, error };
}
