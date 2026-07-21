import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchActivitySummary,
  type ActivityAggregateFilter,
  type ActivityBucket,
} from "../api/activities";
import { useAuth } from "./useAuth";
import { getSessionDemoActivities } from "./useActivities";
import { filterDemoActivities } from "../utils/demoActivityFilter";
import { aggregateActivities } from "../utils/activityBuckets";

export interface UseActivityBucketsResult {
  /** (month × sport × geographic) buckets, sorted month → sport → geographic. */
  buckets: ActivityBucket[];
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Load the charts view's (month × sport × geographic) buckets.
 *
 * Signed in, this is one query against the SQL aggregate — an O(buckets)
 * payload instead of paging every activity to the client — with the server
 * doing the precise geographic classification (trainer/manual/Virtual flags +
 * stored route geometry, not region tagging). Demo mode has no backend, so it
 * keeps the client-side path: the session demo set, filtered then aggregated
 * with the same pure helpers whose bucket shape the server mirrors.
 *
 * Pass a stable (memoized) filter object: the demo path memoizes on its
 * identity, and the TanStack queryKey embeds it.
 */
export function useActivityBuckets(filter: ActivityAggregateFilter): UseActivityBucketsResult {
  const { user, loading: authLoading } = useAuth();
  const [demoActivities] = useState(() => getSessionDemoActivities());

  const { data, isPending, error, refetch } = useQuery({
    // uid namespaces the cache so a second user on the same browser isn't
    // served the first user's buckets within staleTime (project convention);
    // hierarchical under "activities" so the standard ["activities"]
    // invalidation reaches it too.
    queryKey: ["activities", "summary", user?.uid, filter],
    queryFn: ({ signal }) => fetchActivitySummary(filter, signal),
    enabled: !authLoading && !!user,
    staleTime: 5 * 60 * 1000,
  });

  const buckets = useMemo(() => {
    if (authLoading) return [];
    if (!user) return aggregateActivities(filterDemoActivities(demoActivities, filter));
    return data ?? [];
  }, [authLoading, user, demoActivities, data, filter]);

  return {
    buckets,
    isLoading: authLoading || (!!user && isPending),
    error,
    retry: () => {
      void refetch();
    },
  };
}
