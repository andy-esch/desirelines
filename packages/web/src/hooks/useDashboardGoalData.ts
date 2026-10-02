import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useCurrentYear } from "./useCurrentYear";
import { useVisibleSports } from "./useVisibleSports";
import { useSportConfig } from "./useSportConfig";
import { useTimezone, useUnitSettings } from "./usePreferences";
import { useConfigDocument } from "./useConfigDocument";
import { fetchMultiSportMetrics, type MetricsEntry } from "../api/activities";
import {
  generateDemoMetrics,
  generateDemoGoals,
  getSessionFillLevels,
} from "../utils/demoDataGenerator";
import { filterValidSports } from "../utils/sportConfig";
import type { DistanceUnit } from "../utils/units";
import { createYearContext, type YearContext } from "../utils/yearContext";
import { selectSection } from "../services/config/sections";
import { transformToSportGoalData, type SportGoalData } from "../utils/dashboardUtils";

export type { SportGoalData };

/**
 * Hook that fetches YTD cumulative metrics + goals for all visible sports.
 *
 * Handles both demo and auth modes:
 * - Demo: generateDemoMetrics for YTD, generateDemoGoals for goals
 * - Auth: API calls for metrics; goals from the config store (`useConfigDocument`), so a
 *   goal saved anywhere shows here at once, with no read of its own
 *
 * Derivations are left to the React Compiler.
 */
export function useDashboardGoalData(): {
  sportData: SportGoalData[];
  yearContext: YearContext;
  distanceUnit: DistanceUnit;
  isLoading: boolean;
  error: Error | null;
  /**
   * Fetches this year's totals again after they failed. Undefined when the goals are what
   * failed: their listener stops on an error, and only a reload starts it again.
   */
  retry: (() => void) | undefined;
} {
  const { user, loading: authLoading } = useAuth();
  const { doc: userConfig, loading: goalsLoading, error: goalsError } = useConfigDocument();
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();

  const currentYear = useCurrentYear();
  const yearContext = createYearContext(currentYear);
  const userSettings = useUnitSettings();

  const validSports = filterValidSports(visibleSports, sportConfig);

  // --- 1. YTD Cumulative Metrics ---

  // Demo: generate cumulative metrics synchronously
  let demoMetrics: Record<string, MetricsEntry[]> | null = null;
  if (!user) {
    const fillLevels = getSessionFillLevels(validSports);
    demoMetrics = {};
    for (const sport of validSports) {
      demoMetrics[sport] = generateDemoMetrics(sport, currentYear, {
        overrideFillLevel: fillLevels[sport],
        allSports: validSports,
      });
    }
  }

  // Auth: single multi-sport metrics fetch
  const sortedSports = [...validSports].sort();
  const tz = useTimezone();
  const metricsQuery = useQuery({
    queryKey: ["sportMetrics", user?.uid, currentYear, sortedSports, tz],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchMultiSportMetrics({ year: currentYear, sports: sortedSports, tz, signal }),
    enabled: !authLoading && !!user && validSports.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // --- 2. Goals ---

  // Demo: generate goals synchronously
  let demoGoals: Record<string, { conservative: number; target: number; stretch: number }> | null =
    null;
  if (!user) {
    demoGoals = {};
    for (const sport of validSports) {
      demoGoals[sport] = generateDemoGoals(sport);
    }
  }

  // Auth: each sport's goals come from the store's copy of the config, below.

  // --- 3. Transform to UI Model ---

  const sportData = validSports.map((sport) => {
    return transformToSportGoalData({
      sport,
      metrics: user ? metricsQuery.data?.[sport] : demoMetrics?.[sport],
      goalsData: user
        ? selectSection(userConfig, { section: "goals", year: currentYear, sport })
        : undefined,
      demoGoals: demoGoals?.[sport],
      sportConfig,
      userSettings,
      isAuthMode: !!user,
    });
  });

  const isLoading =
    prefsLoading ||
    configLoading ||
    authLoading ||
    (!!user && (metricsQuery.isLoading || goalsLoading));
  // An account's goals that couldn't be loaded are an error, not "no goal": the store's
  // last good copy stands after a listener error, but with none there's nothing to show.
  const queryError =
    metricsQuery.error ?? (user && userConfig === undefined ? goalsError : null) ?? null;
  const retry = metricsQuery.error ? () => void metricsQuery.refetch() : undefined;

  return {
    sportData,
    yearContext,
    distanceUnit: userSettings.distanceUnit,
    isLoading,
    error: queryError,
    retry,
  };
}
