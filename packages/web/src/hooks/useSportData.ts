import { useQuery } from "@tanstack/react-query";
import { fetchSportMetrics, type SportMetrics, type SportConfig } from "../api/activities";
import { useAuth } from "./useAuth";
import { useSportConfig } from "./useSportConfig";
import { useUserConfig } from "./useUserConfig";

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
  const { user, loading: authLoading } = useAuth();
  const {
    sportConfig,
    isLoading: configLoading,
    error: configError,
    retry: configRetry,
  } = useSportConfig();
  const { data: prefs } = useUserConfig("preferences");
  const tz = prefs?.timezone || undefined;

  const isValidSport = !!sportConfig && sport in sportConfig.sportCategories;

  const {
    data: metrics,
    isLoading: metricsLoading,
    error: metricsError,
    refetch,
  } = useQuery({
    // `user?.uid` scopes the cache per user — without it, a logged-out→logged-in
    // transition can serve the previous user's metrics from cache.
    queryKey: ["sportMetrics", year, sport, tz, user?.uid],
    queryFn: ({ signal }) => fetchSportMetrics({ year, sport, tz, signal }),
    // `!!user` matters because /$sport has no auth guard — only a slug-pattern
    // check — so an unauthenticated visit would otherwise fire an API call that
    // can only 401. Demo data is served by the separate /demo/* routes.
    enabled: !authLoading && !!user && isValidSport,
  });

  return {
    metrics: metrics ?? null,
    sportConfig,
    isLoading: authLoading || metricsLoading || configLoading,
    error: metricsError ?? configError,
    retry: () => {
      if (configError) {
        configRetry();
      }
      void refetch();
    },
  };
}
