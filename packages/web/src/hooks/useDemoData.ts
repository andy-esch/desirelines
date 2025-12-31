import { useState, useEffect, useMemo } from "react";
import type { SportMetrics, SportConfig } from "../api/activities";
import { FIXTURE_SPORT_CONFIG } from "../data/fixtures";
import {
  generateDemoMetrics,
  generateDemoGoals,
  getDemoSports,
  type DemoSport,
} from "../utils/demoDataGenerator";

export interface DemoDataResult {
  metrics: SportMetrics | null;
  sportConfig: SportConfig | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for loading demo data for unauthenticated users.
 * Uses the data generator to create fresh, realistic-looking data.
 *
 * @param year - The year to load data for
 * @param sport - The sport type (cycling, running, yoga)
 * @returns Object containing metrics, config, and loading state
 */
export function useDemoData(year: number, sport: string): DemoDataResult {
  const [isLoading, setIsLoading] = useState(true);

  // Generate metrics using the data generator
  const metrics = useMemo(() => {
    const validSports = getDemoSports();
    if (!validSports.includes(sport as DemoSport)) {
      return [];
    }
    return generateDemoMetrics(sport as DemoSport, year);
  }, [year, sport]);

  useEffect(() => {
    // Simulate async loading for smooth UX
    setIsLoading(true);

    // Small delay to prevent flash of loading state
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [year, sport]);

  return {
    metrics,
    sportConfig: FIXTURE_SPORT_CONFIG,
    isLoading,
    error: null,
  };
}

/**
 * Get list of available sports in demo mode
 */
export function getDemoAvailableSports(): string[] {
  return getDemoSports();
}

/**
 * Get demo goals for a sport (in display units)
 */
export function getDemoGoalsForSport(sport: string): {
  conservative: number;
  target: number;
  stretch: number;
} | null {
  const validSports = getDemoSports();
  if (!validSports.includes(sport as DemoSport)) {
    return null;
  }
  return generateDemoGoals(sport as DemoSport);
}
