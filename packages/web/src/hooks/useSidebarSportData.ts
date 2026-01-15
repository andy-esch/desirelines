import { useState, useEffect, useMemo } from "react";
import { fetchYearMetadata, fetchSportConfig } from "../api/activities";
import { isCancellationError } from "../api/errors";
import { useAuth } from "./useAuth";
import { useAuthToken } from "./useAuthToken";
import { useVisibleSports } from "./useVisibleSports";
import { usePublicSportConfig } from "./usePublicSportConfig";
import { getDemoActivityCounts } from "../utils/demoDataGenerator";

export interface SidebarSportData {
  /** Sports available in dropdown, sorted by count descending */
  availableSports: string[];
  /** Activity counts per sport */
  sportCounts: Record<string, number>;
  /** Whether data is still loading */
  isLoading: boolean;
  /** Error that occurred during data fetch, if any */
  error: Error | null;
}

/**
 * Hook for fetching sidebar sport data in authenticated mode.
 * Fetches visible sports and activity counts from API.
 */
export function useSidebarSportData(currentYear: number): SidebarSportData {
  const { loading: authLoading } = useAuth();
  const { getToken } = useAuthToken();
  const { visibleSports, isLoading: visibleLoading } = useVisibleSports();
  const [sportCounts, setSportCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch activity counts per sport category
  useEffect(() => {
    if (authLoading) return;

    const controller = new AbortController();
    setCountsLoading(true);
    setError(null);

    async function loadCounts() {
      try {
        const idToken = await getToken();
        const [metadata, sportConfig] = await Promise.all([
          fetchYearMetadata(currentYear, controller.signal, idToken),
          fetchSportConfig(controller.signal, idToken),
        ]);

        // Aggregate activity counts by sport category
        const categoryCounts: Record<string, number> = {};

        for (const [category, config] of Object.entries(sportConfig.sport_categories)) {
          let totalActivities = 0;
          for (const stravaType of config.strava_types) {
            const totals = metadata.totals[stravaType];
            if (totals?.activities) {
              totalActivities += totals.activities;
            }
          }
          categoryCounts[category] = totalActivities;
        }

        setSportCounts(categoryCounts);
      } catch (err) {
        if (!isCancellationError(err)) {
          console.warn("Failed to fetch sport counts:", err);
          setError(err instanceof Error ? err : new Error("Failed to fetch sport counts"));
        }
      } finally {
        setCountsLoading(false);
      }
    }

    loadCounts();
    return () => controller.abort();
  }, [currentYear, authLoading, getToken]);

  // Sort visible sports by activity count (descending)
  const availableSports = useMemo(() => {
    return [...visibleSports].sort((a, b) => (sportCounts[b] ?? 0) - (sportCounts[a] ?? 0));
  }, [visibleSports, sportCounts]);

  return {
    availableSports,
    sportCounts,
    isLoading: authLoading || visibleLoading || countsLoading,
    error,
  };
}

/**
 * Hook for getting sidebar sport data in demo mode.
 * Fetches sport config from API (public endpoint) to get full sport list.
 * Uses cached activity counts to avoid expensive regeneration.
 */
export function useDemoSidebarSportData(currentYear: number): SidebarSportData {
  const { sportConfig, isLoading: configLoading, error: configError } = usePublicSportConfig();
  const { visibleSports } = useVisibleSports();

  // Build sport info map for the generator (memoized)
  const sportInfoMap = useMemo(() => {
    if (!sportConfig) return undefined;
    const map: Record<string, { has_distance?: boolean; has_elevation?: boolean }> = {};
    for (const sport of visibleSports) {
      const info = sportConfig.sport_categories[sport];
      if (info) {
        map[sport] = { has_distance: info.has_distance, has_elevation: info.has_elevation };
      }
    }
    return map;
  }, [sportConfig, visibleSports]);

  // Get cached activity counts (avoids regenerating full metrics arrays)
  const { sportCounts, sortedSports } = useMemo(() => {
    if (!sportConfig) {
      return { sportCounts: {}, sortedSports: visibleSports };
    }

    // Use cached counts function - generates once, caches in sessionStorage
    const counts = getDemoActivityCounts(currentYear, {
      sports: visibleSports,
      sportInfoMap,
    });

    // Sort by count descending
    const sorted = [...visibleSports].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
    return { sportCounts: counts, sortedSports: sorted };
  }, [sportConfig, visibleSports, currentYear, sportInfoMap]);

  return {
    availableSports: sortedSports,
    sportCounts,
    isLoading: configLoading,
    error: configError, // Propagate error from sport config fetch
  };
}
