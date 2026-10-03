import { useQuery } from "@tanstack/react-query";
import { fetchSportConfig, type SportConfig } from "../api/activities";

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
 * The /sports/config endpoint is public, so this serves signed-in and demo pages alike.
 * It doesn't wait for auth itself: the API client holds every request until the first
 * auth state is known, then attaches a token when there is one (`configureClientAuth`).
 *
 * @example
 * ```tsx
 * const { sportConfig, isLoading } = useSportConfig();
 *
 * if (sportConfig) {
 *   Object.entries(sportConfig.sportCategories).map(([key, config]) => (
 *     <div>{config.displayName}</div>
 *   ));
 * }
 * ```
 */
export function useSportConfig(): UseSportConfigResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sportConfig"],
    queryFn: ({ signal }) => fetchSportConfig(signal),
    staleTime: Infinity, // Config rarely changes during a session
  });

  return {
    sportConfig: data ?? null,
    isLoading,
    error: error,
    retry: () => {
      void refetch();
    },
  };
}
