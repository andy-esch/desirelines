import { useState, useEffect, useCallback } from "react";
import { fetchSportConfig, type SportConfig } from "../api/activities";
import { isCancellationError } from "../api/errors";

export interface UsePublicSportConfigResult {
  sportConfig: SportConfig | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

// =============================================================================
// Module-level cache for sport config
// Prevents redundant API calls when multiple components use this hook
// =============================================================================

interface CacheEntry {
  config: SportConfig | null;
  error: Error | null;
  promise: Promise<SportConfig> | null;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: CacheEntry = {
  config: null,
  error: null,
  promise: null,
  timestamp: 0,
};

function isCacheValid(): boolean {
  return cache.config !== null && Date.now() - cache.timestamp < CACHE_TTL_MS;
}

function clearCache(): void {
  cache = { config: null, error: null, promise: null, timestamp: 0 };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for fetching sport configuration without authentication.
 *
 * The /sports/config endpoint is public, so this can be used in demo mode
 * to get the full list of available sports from the API.
 *
 * Features:
 * - Module-level caching (5 min TTL) prevents redundant API calls
 * - Multiple hook instances share the same fetch
 * - Retry clears cache and refetches
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
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(cache.config);
  const [isLoading, setIsLoading] = useState(!isCacheValid());
  const [error, setError] = useState<Error | null>(cache.error);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => {
    clearCache();
    setError(null);
    setRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    // If cache is valid, use it immediately
    if (isCacheValid()) {
      setSportConfig(cache.config);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        // Check if another instance is already fetching
        if (cache.promise) {
          const config = await cache.promise;
          if (!cancelled) {
            setSportConfig(config);
            setError(null);
          }
          return;
        }

        // Start fetch and store promise for other instances to share
        const fetchPromise = fetchSportConfig(controller.signal);
        cache.promise = fetchPromise;

        const config = await fetchPromise;

        // Update cache
        cache.config = config;
        cache.error = null;
        cache.timestamp = Date.now();
        cache.promise = null;

        if (!cancelled) {
          setSportConfig(config);
        }
      } catch (err) {
        cache.promise = null;

        if (!isCancellationError(err)) {
          const error = err instanceof Error ? err : new Error(String(err));
          cache.error = error;
          if (!cancelled) {
            setError(error);
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
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
