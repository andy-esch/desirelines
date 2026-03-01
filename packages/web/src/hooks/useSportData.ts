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
  const { loading: authLoading } = useAuth();
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
    queryKey: ["sportMetrics", year, sport, tz],
    queryFn: ({ signal }) => fetchSportMetrics({ year, sport, tz, signal }),
    enabled: !authLoading && isValidSport,
  });

  return {
    metrics: metrics ?? null,
    sportConfig,
    isLoading: authLoading || metricsLoading || configLoading,
    error: (metricsError as Error | null) ?? configError,
    retry: () => {
      if (configError) {
        configRetry();
      }
      refetch();
    },
  };
}
