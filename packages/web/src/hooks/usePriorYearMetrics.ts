import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchSportMetrics, type SportMetrics } from "../api/activities";
import { useAuth } from "./useAuth";

interface UsePriorYearMetricsProps {
  currentYear: number;
  sport: string;
  enabled: boolean;
  maxYears?: number;
}

export interface PriorYearMetricsResult {
  priorMetrics: Record<number, SportMetrics>;
  isLoading: boolean;
  error: Error | null;
}

const MIN_YEAR = 2020;

export function usePriorYearMetrics({
  currentYear,
  sport,
  enabled,
  maxYears = 5,
}: UsePriorYearMetricsProps): PriorYearMetricsResult {
  const { loading: authLoading } = useAuth();

  const years = useMemo(() => {
    const result: number[] = [];
    for (let i = 1; i <= maxYears; i++) {
      const y = currentYear - i;
      if (y >= MIN_YEAR) result.push(y);
    }
    return result;
  }, [currentYear, maxYears]);

  const queries = useQueries({
    queries: years.map((year) => ({
      queryKey: ["sportMetrics", year, sport],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchSportMetrics({ year, sport, signal }),
      enabled: enabled && !authLoading,
    })),
  });

  // Create a stable key based on when data was last updated.
  const dataKey = queries.map((q) => q.dataUpdatedAt).join(",");
  const priorMetrics = useMemo(() => {
    return years.reduce(
      (acc, year, index) => {
        const data = queries[index]?.data;
        if (data?.length) {
          acc[year] = data;
        }
        return acc;
      },
      {} as Record<number, SportMetrics>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataKey captures query staleness without unstable array ref
  }, [years, dataKey]);

  const isLoading = enabled && queries.some((q) => q.isLoading);
  const error = (queries.find((q) => q.error)?.error as Error | null) ?? null;

  return { priorMetrics, isLoading, error };
}
