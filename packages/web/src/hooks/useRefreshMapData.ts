import { useCallback } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { mapDatasetKey } from "./useMapDataset";
import { routeRegionsKey } from "./useRouteRegions";

export interface UseRefreshMapDataResult {
  /** Invalidate the map dataset + regions so the map reflects newly-synced activities. */
  refresh: () => void;
  /** True while either query is (re)fetching — drives the refresh control's spinner. */
  isRefreshing: boolean;
}

/**
 * Manual refresh for the routes-map data. Strava sync is backend (webhook) driven, so
 * the frontend has no push signal that new activities landed; this lets the user pull
 * the latest on demand.
 *
 * Both dataset + regions queries are `staleTime: Infinity` with no auto-refetch (see
 * useMapDataset / useRouteRegions), so `invalidateQueries` is the only way to refresh
 * them. React Query refetches in the background and keeps the current data until the
 * new set resolves, so an active cross-filter view isn't yanked away mid-interaction.
 */
export function useRefreshMapData(): UseRefreshMapDataResult {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const uid = user?.uid;

  // Call both hooks unconditionally (Rules of Hooks — can't short-circuit a hook call),
  // then combine the counts.
  const datasetFetching = useIsFetching({ queryKey: mapDatasetKey(uid) });
  const regionsFetching = useIsFetching({ queryKey: routeRegionsKey(uid) });
  const isRefreshing = datasetFetching > 0 || regionsFetching > 0;

  const refresh = useCallback(() => {
    // No signed-in user → no user-scoped queries to refresh; skip (also avoids a
    // stray invalidation during sign-out / before auth settles).
    if (!uid) return;
    void queryClient.invalidateQueries({ queryKey: mapDatasetKey(uid) });
    void queryClient.invalidateQueries({ queryKey: routeRegionsKey(uid) });
  }, [queryClient, uid]);

  return { refresh, isRefreshing };
}
