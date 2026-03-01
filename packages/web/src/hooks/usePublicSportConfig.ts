import { useQuery } from "@tanstack/react-query";
import { fetchSportConfig, type SportConfig } from "../api/activities";

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
 * Uses the same React Query cache key as useSportConfig, so authenticated
 * and demo modes share cached data automatically.
 *
 * @example
 * ```tsx
 * const { sportConfig, isLoading } = usePublicSportConfig();
 *
 * if (sportConfig) {
 *   const sports = Object.keys(sportConfig.sportCategories);
 * }
 * ```
 */
export function usePublicSportConfig(): UsePublicSportConfigResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sportConfig"],
    queryFn: ({ signal }) => fetchSportConfig(signal),
    staleTime: Infinity, // Config rarely changes during a session
  });

  return {
    sportConfig: data ?? null,
    isLoading,
    error: error as Error | null,
    retry: refetch,
  };
}
