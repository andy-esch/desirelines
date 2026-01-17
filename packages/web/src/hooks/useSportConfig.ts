import { useQuery } from "@tanstack/react-query";
import { fetchSportConfig, type SportConfig } from "../api/activities";
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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sportConfig"],
    queryFn: ({ signal }) => fetchSportConfig(signal),
    enabled: !authLoading,
    staleTime: Infinity, // Config rarely changes during a session
  });

  return {
    sportConfig: data ?? null,
    isLoading: isLoading || authLoading, // Consider auth loading as part of total loading
    error: error as Error | null,
    retry: refetch,
  };
}
