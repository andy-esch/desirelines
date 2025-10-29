import { useState, useEffect } from "react";
import { fetchDistanceData } from "../api/activities";
import type { DistanceEntry } from "../types/activity";
import { USE_FIXTURE_DATA } from "../config";
import { FIXTURE_ACTIVITIES } from "../data/fixtures";
import { useAuth } from "./useAuth";

/**
 * Extends distance data from the last activity date through today
 * by carrying forward the last distance value.
 *
 * This fixes the issue where charts stop at the last activity date instead
 * of extending through "today", which causes:
 * - Incomplete chart visualization
 * - Incorrect training momentum calculations (needs recent data)
 * - Confusing UX (user views dashboard today but sees old data)
 *
 * @param distanceData - Array of distance entries from backend
 * @param year - The year being viewed (to prevent extending past Dec 31 for past years)
 * @returns Extended distance data array
 */
function extendDistanceDataToToday(distanceData: DistanceEntry[], year: number): DistanceEntry[] {
  if (distanceData.length === 0) return distanceData;

  const lastEntry = distanceData[distanceData.length - 1];
  const lastDate = new Date(lastEntry.x);
  const today = new Date();

  // Reset to start of day for comparison (ignore time component)
  const lastDateOnly = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Don't extend past end of requested year (e.g., viewing 2024 shouldn't extend past Dec 31, 2024)
  const endOfYear = new Date(year, 11, 31);
  const maxExtendDate = todayOnly < endOfYear ? todayOnly : endOfYear;

  // If data is current (last entry is today or future), no extension needed
  if (lastDateOnly.getTime() >= maxExtendDate.getTime()) {
    return distanceData;
  }

  // Data is stale - fill forward with last distance value
  const extendedData = [...distanceData];
  const lastDistance = lastEntry.y;

  const currentDate = new Date(lastDateOnly);
  currentDate.setDate(currentDate.getDate() + 1); // Start from day after last entry

  while (currentDate <= maxExtendDate) {
    // Use date-only format (YYYY-MM-DD) to match goal line format
    // This ensures proper merging in charts
    const dateStr = new Date(currentDate).toISOString().split("T")[0];
    extendedData.push({
      x: dateStr,
      y: lastDistance, // Carry forward last distance (no new activities)
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return extendedData;
}

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
  const { user } = useAuth();

  useEffect(() => {
    // Smart mode: Use fixtures if:
    // 1. Environment is configured for fixture-only mode (USE_FIXTURE_DATA=true), OR
    // 2. User is not authenticated (anonymous users see demo)
    // Note: USE_FIXTURE_DATA takes precedence (important for testing)
    const shouldUseFixtures = USE_FIXTURE_DATA || !user;

    if (shouldUseFixtures) {
      const fixtureData = FIXTURE_ACTIVITIES[year];
      if (fixtureData?.distance_traveled) {
        const extended = extendDistanceDataToToday(fixtureData.distance_traveled, year);
        setDistanceData(extended);
      } else {
        setDistanceData([]);
      }
      setIsLoading(false);
      setError(null);
      return;
    }

    // Otherwise, fetch from API
    const abortController = new AbortController();

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const rideData = await fetchDistanceData(year, abortController.signal);

        if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
          // IMPORTANT: Extend data to today before setting state
          // This ensures charts always show through current date, even if no recent activities
          const extendedData = extendDistanceDataToToday(rideData.distance_traveled, year);
          setDistanceData(extendedData);
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

    // Cleanup: abort fetch on unmount or year/user change
    return () => {
      abortController.abort();
    };
  }, [year, user]);

  return {
    distanceData,
    isLoading,
    error,
  };
}
