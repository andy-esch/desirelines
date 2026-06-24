import { useQuery } from "@tanstack/react-query";
import { fetchMapDataset, type MapActivity } from "../api/map";
import { useAuth } from "./useAuth";

export interface UseMapDatasetResult {
  activities: MapActivity[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch the routes-map cross-filter dataset (all geo-bearing activities' scalars
 * + region tags, keyed by activity id). Fetched once; the routes map filters this
 * set client-side to drive the map, charts/KPIs, and the activity list — no
 * refetch on filter change.
 *
 * Query key includes `user?.uid` per the data-fetching convention; gated on an
 * authenticated user.
 */
export function useMapDataset(): UseMapDatasetResult {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["mapDataset", user?.uid],
    queryFn: ({ signal }) => fetchMapDataset(signal),
    enabled: !authLoading && !!user,
    // Hold the dataset stable for the session. It only changes when a Strava
    // backfill/sync adds activities (infrequent, user-initiated), and a background
    // refetch would swap the array out from under active cross-filters — shifting
    // the distance/time slider domains mid-interaction. Refresh is explicit (a
    // queryClient.invalidateQueries after a sync), not time- or focus-driven.
    staleTime: Infinity,
  });

  return {
    activities: data ?? [],
    isLoading: authLoading || isLoading,
    error: error,
  };
}
