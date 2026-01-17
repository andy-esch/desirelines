import { useState, useEffect, useCallback } from "react";
import { fetchSportConfig, type SportConfig } from "../api/activities";
import { isCancellationError } from "../api/errors";
import { useAuth } from "./useAuth";

export interface UseSportConfigResult {
  sportConfig: SportConfig | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Hook for fetching sport configuration data.
 *
 * Provides the full sport_types.json configuration with display names,
 * Strava type mappings, and metric definitions for all sports.
 *
 * @example
 * ```tsx
 * const { sportConfig, isLoading } = useSportConfig();
 *
 * if (sportConfig) {
 *   Object.entries(sportConfig.sport_categories).map(([key, config]) => (
 *     <div>{config.display_name}</div>
 *   ));
 * }
 * ```
 */
export function useSportConfig(): UseSportConfigResult {
  const { loading: authLoading } = useAuth();

  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        const config = await fetchSportConfig(controller.signal);
        setSportConfig(config);
      } catch (err) {
        if (!isCancellationError(err)) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadData();

    return () => {
      controller.abort();
    };
  }, [authLoading, retryCount]);

  return {
    sportConfig,
    isLoading,
    error,
    retry,
  };
}
