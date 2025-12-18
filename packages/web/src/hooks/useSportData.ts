import { useState, useEffect } from "react";
import {
  fetchSportMetrics,
  fetchSportConfig,
  type SportMetrics,
  type SportConfig,
} from "../api/activities";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";

export interface SportDataResult {
  metrics: SportMetrics | null;
  sportConfig: SportConfig | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Hook for fetching sport metrics and configuration data
 *
 * Handles loading metrics and config for a specific year and sport,
 * with automatic authentication. Provides retry functionality for error recovery.
 *
 * @param year - The year to fetch data for
 * @param sport - The sport type (cycling, running, yoga)
 * @returns Object containing metrics, config, loading state, errors, and retry function
 *
 * @example
 * ```tsx
 * const { metrics, sportConfig, isLoading, error, retry } = useSportData(2025, "cycling");
 *
 * if (isLoading) return <LoadingSpinner />;
 * if (error) return <ErrorMessage error={error} onRetry={retry} />;
 * ```
 */
export function useSportData(year: number, sport: string): SportDataResult {
  const { loading: authLoading } = useAuth();
  const { getToken } = useAuthToken();

  const [metrics, setMetrics] = useState<SportMetrics | null>(null);
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Retry handler for error recovery
  const retry = () => {
    setError(null);
    setRetryCount((prev) => prev + 1);
  };

  useEffect(() => {
    // Don't make API calls while auth is still loading
    if (authLoading) {
      return;
    }

    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        const idToken = await getToken();

        const [metricsData, configData] = await Promise.all([
          fetchSportMetrics(year, sport, controller.signal, idToken),
          fetchSportConfig(controller.signal, idToken),
        ]);

        setMetrics(metricsData);
        setSportConfig(configData);
      } catch (err) {
        if (err instanceof Error && err.message !== "Request cancelled") {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadData();

    return () => {
      controller.abort();
    };
  }, [year, sport, authLoading, retryCount, getToken]);

  return {
    metrics,
    sportConfig,
    isLoading,
    error,
    retry,
  };
}
