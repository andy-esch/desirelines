import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchActivities, type ActivitySummary, type ActivityListFilter } from "../api/activities";
import { useAuth } from "./useAuth";
import {
  generateDemoActivities,
  generateCoordinatedFillLevels,
  getDemoSports,
} from "../utils/demoDataGenerator";

export interface UseActivitiesResult {
  activities: ActivitySummary[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Hook for fetching paginated activity list
 *
 * Handles loading activities with cursor-based pagination,
 * automatic authentication, and retry functionality.
 *
 * @param filter - Filter options (from, to, sport, limit)
 * @returns Object containing activities, loading state, errors, and pagination controls
 *
 * @example
 * ```tsx
 * const { activities, isLoading, hasMore, loadMore } = useActivities({
 *   from: "2025-01-01",
 *   to: "2025-12-31",
 *   sport: "cycling",
 *   limit: 20,
 * });
 * ```
 */
export function useActivities(filter: Omit<ActivityListFilter, "cursor">): UseActivitiesResult {
  const { user, loading: authLoading } = useAuth();

  // Generate demo activities for unauthenticated users.
  // Cached in sessionStorage so the same activities appear across all pages.
  const demoActivities = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const cacheKey = "demo-activities";

    // Try to read from session cache
    try {
      const stored = sessionStorage.getItem(cacheKey);
      if (stored) {
        const cached = JSON.parse(stored) as { year: number; activities: ActivitySummary[] };
        if (cached.year === currentYear) {
          return cached.activities;
        }
      }
    } catch {
      // Cache miss or invalid data
    }

    // Generate fresh demo activities
    const sports = getDemoSports();
    const fillLevels = generateCoordinatedFillLevels();

    const allActivities = sports.flatMap((sport) =>
      generateDemoActivities(sport, currentYear, {
        count: 10,
        overrideFillLevel: fillLevels[sport],
      })
    );

    // Sort by date descending (most recent first)
    allActivities.sort(
      (a, b) => new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
    );

    // Cache for other pages
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ year: currentYear, activities: allActivities }));
    } catch {
      // Storage full or unavailable
    }

    return allActivities;
  }, []);

  const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, error, refetch } =
    useInfiniteQuery({
      queryKey: ["activities", filter],
      queryFn: async ({ pageParam, signal }) => {
        return fetchActivities({ ...filter, cursor: pageParam }, signal);
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: undefined as string | undefined,
      enabled: !authLoading && !!user, // Only fetch if user exists
      staleTime: 5 * 60 * 1000, // 5 minutes
    });

  // Combine data from all pages
  const activities = useMemo(() => {
    if (authLoading) return [];
    if (!user) return demoActivities;
    return data?.pages.flatMap((page) => page.activities) ?? [];
  }, [user, data, demoActivities, authLoading]);

  return {
    activities,
    isLoading: authLoading || (!!user && isFetching && !isFetchingNextPage && !data),
    error: error as Error | null,
    hasMore: !user ? false : !!hasNextPage,
    loadMore: fetchNextPage,
    retry: refetch,
  };
}
