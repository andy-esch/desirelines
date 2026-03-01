import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYearMetadata } from "../api/activities";
import { useAuth } from "./useAuth";
import { useVisibleSports } from "./useVisibleSports";
import { useSportConfig } from "./useSportConfig";
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
  const { visibleSports, isLoading: visibleLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading, error: configError } = useSportConfig();

  const {
    data: metadata,
    isLoading: metadataLoading,
    error: metadataError,
  } = useQuery({
    queryKey: ["yearMetadata", currentYear],
    queryFn: ({ signal }) => fetchYearMetadata(currentYear, signal),
    enabled: !authLoading,
  });

  // Aggregate counts by sport category from year metadata.
  // The API returns totals keyed by sport category (e.g. "cycling", "running"),
  // so look up each category directly.
  const sportCounts = useMemo(() => {
    if (!metadata || !sportConfig) return {};
    return Object.fromEntries(
      Object.entries(sportConfig.sportCategories).map(([category]) => [
        category,
        metadata.totals[category]?.activities ?? 0,
      ])
    );
  }, [metadata, sportConfig]);

  // Sort visible sports by activity count (descending)
  const availableSports = useMemo(
    () => [...visibleSports].sort((a, b) => (sportCounts[b] ?? 0) - (sportCounts[a] ?? 0)),
    [visibleSports, sportCounts]
  );

  return {
    availableSports,
    sportCounts,
    isLoading: authLoading || visibleLoading || configLoading || metadataLoading,
    error: (configError || metadataError) as Error | null,
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
    const map: Record<string, { hasDistance?: boolean; hasElevation?: boolean }> = {};
    for (const sport of visibleSports) {
      const info = sportConfig.sportCategories[sport];
      if (info) {
        map[sport] = { hasDistance: info.hasDistance, hasElevation: info.hasElevation };
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
