import { useState, useEffect } from "react";
import { fetchDistanceData } from "../api/activities";
import type { DistanceEntry } from "../types/activity";

/**
 * Custom hook to fetch and manage distance data for a given year
 * Consolidates data fetching logic that was duplicated across multiple components
 *
 * @param year - The year to fetch distance data for
 * @returns Object containing distanceData, loading state, and error state
 */
export function useDistanceData(year: number) {
  const [distanceData, setDistanceData] = useState<DistanceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const rideData = await fetchDistanceData(year, abortController.signal);

        if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
          setDistanceData(rideData.distance_traveled);
        } else {
          // No data for this year
          setDistanceData([]);
        }
      } catch (err: unknown) {
        // Only set error if request wasn't aborted
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err);
        } else if (!(err instanceof Error)) {
          setError(new Error(String(err)));
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Cleanup: abort fetch on unmount or year change
    return () => {
      abortController.abort();
    };
  }, [year]);

  return {
    distanceData,
    isLoading,
    error,
  };
}
