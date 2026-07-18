import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchActivities, type ActivitySummary, type ActivityListFilter } from "../api/activities";
import { useAuth } from "./useAuth";
import { getSessionDemoActivities } from "./useActivities";

/** Page size for the charts' page-to-completion loop. The API caps at 100
 *  (MaxListLimit); larger pages mean fewer round-trips to load the full set. */
const CHARTS_PAGE_LIMIT = 100;

export interface UseAllActivitiesResult {
  /** Every activity matching the filter, across all pages. Empty until complete. */
  activities: ActivitySummary[];
  /** True while any page (including follow-up pages) is still loading. */
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Load the ENTIRE filtered activity set, paging to completion.
 *
 * The Charts view aggregates client-side (data source "A"), so it needs the whole
 * set, not one page — unlike `useActivities`, which exposes a manual load-more for
 * the table. This hook drives the same cursor-paginated endpoint but auto-fetches
 * every page (limit 100) and reports `isLoading` until the last one lands, so the
 * chart renders complete totals rather than a partial, growing set.
 *
 * At single-user scale the full set is a handful of pages, cached 5 min by
 * TanStack Query and shared with the list view's cache where filters match.
 * Demo mode (no signed-in user) returns the generated activities in one shot,
 * mirroring `useActivities`.
 */
export function useAllActivities(
  filter: Omit<ActivityListFilter, "cursor" | "limit">
): UseAllActivitiesResult {
  const { user, loading: authLoading } = useAuth();
  const [demoActivities] = useState(() => getSessionDemoActivities());

  const pagedFilter = useMemo(() => ({ ...filter, limit: CHARTS_PAGE_LIMIT }), [filter]);

  const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, error, refetch } =
    useInfiniteQuery({
      // user.uid namespaces the cache so a second user on the same browser can't be
      // served the first user's activities within staleTime; hierarchical under
      // "activities" so the standard ["activities"] invalidation reaches it too.
      queryKey: ["activities", "all", user?.uid, pagedFilter],
      queryFn: async ({ pageParam, signal }) =>
        fetchActivities({ ...pagedFilter, cursor: pageParam }, signal),
      // `|| undefined` guards the auto-page loop: nextCursor is an optional string,
      // so a present-but-empty "" would read as a live cursor and drive fetchNextPage
      // forever. Any falsy cursor → undefined ends paging cleanly.
      getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
      initialPageParam: undefined as string | undefined,
      enabled: !authLoading && !!user,
      staleTime: 5 * 60 * 1000,
    });

  // Page to completion: fetch the next page whenever one exists and none is in
  // flight. The `!error` guard is essential — without it, a failed page (an
  // earlier page's getNextPageParam already set hasNextPage=true) would re-trigger
  // fetchNextPage every render in a tight loop.
  useEffect(() => {
    if (user && hasNextPage && !isFetchingNextPage && !error) {
      void fetchNextPage();
    }
  }, [user, hasNextPage, isFetchingNextPage, error, fetchNextPage]);

  const activities = useMemo(() => {
    if (authLoading) return [];
    if (!user) return demoActivities;
    return data?.pages.flatMap((page) => page.activities) ?? [];
  }, [user, data, demoActivities, authLoading]);

  return {
    activities,
    // Loading until the whole set is in (any fetch in flight OR more pages remain).
    // Crucially false once an error is present, so ChartContainer can surface the
    // error + Retry instead of a spinner that never resolves.
    isLoading: authLoading || (!!user && !error && (isFetching || hasNextPage)),
    error,
    retry: () => {
      void refetch();
    },
  };
}
