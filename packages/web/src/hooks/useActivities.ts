import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchActivities, type ActivitySummary, type ActivityListFilter } from "../api/activities";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";
import {
  generateDemoActivities,
  generateCoordinatedFillLevels,
  type DemoSport,
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
  const { getToken } = useAuthToken();

  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Generate demo activities for unauthenticated users
  const demoActivities = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const fillLevels = generateCoordinatedFillLevels();
    const sports: DemoSport[] = ["cycling", "running", "yoga"];

    // Generate activities for all sports and combine
    const allActivities = sports.flatMap((sport) =>
      generateDemoActivities(sport, currentYear, 10, fillLevels[sport])
    );

    // Sort by date descending (most recent first)
    return allActivities.sort(
      (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
    );
  }, []);

  // Reset when filter changes
  useEffect(() => {
    setActivities([]);
    setCursor(undefined);
    setHasMore(false);
  }, [filter.from, filter.to, filter.sport, filter.limit]);

  // Fetch activities
  useEffect(() => {
    if (authLoading) {
      return;
    }

    // For unauthenticated users, use demo data
    if (!user) {
      setActivities(demoActivities);
      setHasMore(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        const idToken = await getToken();

        const response = await fetchActivities({ ...filter, cursor }, controller.signal, idToken);

        setActivities((prev) => (cursor ? [...prev, ...response.activities] : response.activities));
        setHasMore(response.has_more);
        if (response.next_cursor) {
          setCursor(response.next_cursor);
        }
      } catch (err) {
        if (err instanceof Error && err.message !== "Request cancelled") {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadData();

    return () => {
      controller.abort();
    };
    // Note: cursor is intentionally excluded to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filter.from,
    filter.to,
    filter.sport,
    filter.limit,
    authLoading,
    retryCount,
    getToken,
    user,
    demoActivities,
  ]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore && cursor) {
      setRetryCount((prev) => prev + 1);
    }
  }, [isLoading, hasMore, cursor]);

  const retry = useCallback(() => {
    setError(null);
    setActivities([]);
    setCursor(undefined);
    setRetryCount((prev) => prev + 1);
  }, []);

  return {
    activities,
    isLoading,
    error,
    hasMore,
    loadMore,
    retry,
  };
}
