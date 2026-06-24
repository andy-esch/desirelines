import { useQuery } from "@tanstack/react-query";
import { fetchRouteRegions, type RegionSummary } from "../api/map";
import { useAuth } from "./useAuth";

export interface UseRouteRegionsResult {
  regions: RegionSummary[];
  /** Region to fit on load, or null when the user has no geo-bearing activities. */
  defaultViewport: RegionSummary | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch the routes-map region summary + default viewport.
 *
 * Used to fit the map to the user's densest region on load. Query key includes
 * `user?.uid` per the data-fetching convention; gated on an authenticated user.
 */
export function useRouteRegions(): UseRouteRegionsResult {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["routeRegions", user?.uid],
    queryFn: ({ signal }) => fetchRouteRegions(signal),
    enabled: !authLoading && !!user,
    // Stable for the session, alongside the dataset (useMapDataset): it only changes
    // on a backfill/sync, and it drives the initial viewport — a background refetch
    // here would re-fit the map. Refresh is explicit, not time- or focus-driven.
    staleTime: Infinity,
  });

  return {
    regions: data?.regions ?? [],
    defaultViewport: data?.defaultViewport ?? null,
    isLoading: authLoading || isLoading,
    error: error,
  };
}
