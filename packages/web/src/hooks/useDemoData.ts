import { useState, useEffect } from "react";
import type { SportMetrics, SportConfig } from "../api/activities";
import { FIXTURE_SPORT_METRICS, FIXTURE_SPORT_CONFIG } from "../data/fixtures";

export interface DemoDataResult {
  metrics: SportMetrics | null;
  sportConfig: SportConfig | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for loading demo/fixture data for unauthenticated users.
 * Uses static fixture files instead of API calls.
 *
 * @param year - The year to load data for
 * @param sport - The sport type (cycling, running, yoga)
 * @returns Object containing metrics, config, and loading state
 */
export function useDemoData(year: number, sport: string): DemoDataResult {
  const [metrics, setMetrics] = useState<SportMetrics | null>(null);
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate async loading for smooth UX
    setIsLoading(true);

    // Small delay to prevent flash of loading state
    const timer = setTimeout(() => {
      const metricsData = FIXTURE_SPORT_METRICS[sport]?.[year] || [];
      setMetrics(metricsData);
      setSportConfig(FIXTURE_SPORT_CONFIG);
      setIsLoading(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [year, sport]);

  return {
    metrics,
    sportConfig,
    isLoading,
    error: null, // Fixtures don't fail
  };
}

/**
 * Get list of available sports in demo mode
 */
export function getDemoAvailableSports(): string[] {
  return Object.keys(FIXTURE_SPORT_CONFIG.sport_categories);
}
