import { useMemo } from "react";
import type { MetricsEntry, SportConfig } from "../api/activities";
import { usePublicSportConfig } from "./usePublicSportConfig";
import {
  generateDemoMetrics,
  generateDemoGoals,
  type TuningParams,
} from "../utils/demoDataGenerator";

export interface DemoDataResult {
  /** Generated metrics array for the sport/year */
  metrics: MetricsEntry[];
  /** Sport configuration from API */
  sportConfig: SportConfig | null;
  /** True while fetching sport config */
  isLoading: boolean;
  /** Error from sport config fetch, if any */
  error: Error | null;
}

/**
 * Hook for loading demo data for unauthenticated users.
 * Uses the data generator to create fresh, realistic-looking data.
 * Fetches sport config from the API (public endpoint) for full sport support.
 *
 * @param year - The year to load data for
 * @param sport - The sport type (any sport from API config)
 * @returns Object containing metrics, config, and loading state
 */
export function useDemoData(
  year: number,
  sport: string,
  tuningParams?: TuningParams
): DemoDataResult {
  const { sportConfig, isLoading: configLoading, error: configError } = usePublicSportConfig();

  // Memoize allSports to avoid creating new array reference on every render
  const allSports = useMemo(
    () => (sportConfig ? Object.keys(sportConfig.sport_categories) : undefined),
    [sportConfig]
  );

  // Get sport info from API config for generating realistic data
  const sportInfo = sportConfig?.sport_categories?.[sport];

  // Generate metrics using the data generator
  // Data generation is synchronous - no artificial delay needed
  const metrics = useMemo(() => {
    if (!sportConfig) {
      return []; // Wait for config
    }
    // Generate data with sport info from API
    return generateDemoMetrics(sport, year, {
      sportInfo: sportInfo
        ? { has_distance: sportInfo.has_distance, has_elevation: sportInfo.has_elevation }
        : undefined,
      allSports,
      tuningParams,
    });
  }, [year, sport, sportConfig, sportInfo, allSports, tuningParams]);

  return {
    metrics,
    sportConfig,
    isLoading: configLoading,
    error: configError,
  };
}

/**
 * Get demo goals for a sport (in display units).
 * Uses sport info from API config to determine appropriate defaults.
 */
export function getDemoGoalsForSport(
  sport: string,
  sportInfo?: { has_distance?: boolean; has_elevation?: boolean }
): {
  conservative: number;
  target: number;
  stretch: number;
} {
  return generateDemoGoals(sport, sportInfo);
}
