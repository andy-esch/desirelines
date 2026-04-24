import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchActivities, type ActivitySummary, type ActivityListFilter } from "../api/activities";
import { useAuth } from "./useAuth";
import { getCurrentYear } from "./useCurrentYear";
import {
  generateDemoActivities,
  generateCoordinatedFillLevels,
  getDemoSports,
} from "../utils/demoDataGenerator";

const DEMO_ACTIVITIES_CACHE_KEY = "demo-activities";

/**
 * Get or generate demo activities, cached in sessionStorage for cross-page consistency.
 */
function getSessionDemoActivities(): ActivitySummary[] {
  const currentYear = getCurrentYear();

  try {
    const stored = sessionStorage.getItem(DEMO_ACTIVITIES_CACHE_KEY);
    if (stored) {
      const cached = JSON.parse(stored) as { year?: number; activities?: ActivitySummary[] } | null;
      if (cached?.year === currentYear && Array.isArray(cached.activities)) {
        return cached.activities;
      }
    }
  } catch {
    // Cache miss or invalid data
  }

  const sports = getDemoSports();
  const fillLevels = generateCoordinatedFillLevels();

  const allActivities = sports.flatMap((sport) =>
    generateDemoActivities(sport, currentYear, {
      count: 10,
      overrideFillLevel: fillLevels[sport],
    })
  );

  allActivities.sort(
    (a, b) => new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
  );

  try {
    sessionStorage.setItem(
      DEMO_ACTIVITIES_CACHE_KEY,
      JSON.stringify({ year: currentYear, activities: allActivities })
    );
  } catch {
    // Storage full or unavailable
  }

  return allActivities;
}

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

  // Demo activities cached in sessionStorage so the same activities appear across all pages.
  // Uses lazy useState initializer (runs once per mount, appropriate for side effects).
  const [demoActivities] = useState(() => getSessionDemoActivities());

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
    error: error,
    hasMore: !user ? false : !!hasNextPage,
    loadMore: () => {
      void fetchNextPage();
    },
    retry: () => {
      void refetch();
    },
  };
}
