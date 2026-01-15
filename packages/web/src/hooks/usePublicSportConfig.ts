import { useState, useEffect, useCallback } from "react";
import { fetchSportConfig, type SportConfig } from "../api/activities";
import { isCancellationError } from "../api/errors";

export interface UsePublicSportConfigResult {
  sportConfig: SportConfig | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Hook for fetching sport configuration without authentication.
 *
 * The /sports/config endpoint is public, so this can be used in demo mode
 * to get the full list of available sports from the API.
 *
 * @example
 * ```tsx
 * const { sportConfig, isLoading } = usePublicSportConfig();
 *
 * if (sportConfig) {
 *   const sports = Object.keys(sportConfig.sport_categories);
 * }
 * ```
 */
export function usePublicSportConfig(): UsePublicSportConfigResult {
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        // No auth token needed - endpoint is public
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
  }, [retryCount]);

  return {
    sportConfig,
    isLoading,
    error,
    retry,
  };
}
