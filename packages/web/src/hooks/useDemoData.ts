import { useState, useEffect, useMemo } from "react";
import type { SportMetrics, SportConfig } from "../api/activities";
import { usePublicSportConfig } from "./usePublicSportConfig";
import { generateDemoMetrics, generateDemoGoals } from "../utils/demoDataGenerator";

export interface DemoDataResult {
  metrics: SportMetrics | null;
  sportConfig: SportConfig | null;
  isLoading: boolean;
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
export function useDemoData(year: number, sport: string): DemoDataResult {
  const [isGenerating, setIsGenerating] = useState(true);
  const { sportConfig, isLoading: configLoading, error: configError } = usePublicSportConfig();

  // Get sport info from API config for generating realistic data
  const sportInfo = sportConfig?.sport_categories?.[sport];
  const allSports = sportConfig ? Object.keys(sportConfig.sport_categories) : undefined;

  // Generate metrics using the data generator
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
    });
  }, [year, sport, sportConfig, sportInfo, allSports]);

  useEffect(() => {
    // Simulate async loading for smooth UX
    setIsGenerating(true);

    // Small delay to prevent flash of loading state
    const timer = setTimeout(() => {
      setIsGenerating(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [year, sport]);

  return {
    metrics,
    sportConfig,
    isLoading: configLoading || isGenerating,
    error: configError,
  };
}

/**
 * Get list of available sports from API sport config.
 * Returns empty array if config not loaded yet.
 */
export function getDemoAvailableSportsFromConfig(sportConfig: SportConfig | null): string[] {
  if (!sportConfig) return [];
  return Object.keys(sportConfig.sport_categories);
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
