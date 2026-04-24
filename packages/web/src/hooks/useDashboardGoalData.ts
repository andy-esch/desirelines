import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useCurrentYear } from "./useCurrentYear";
import { useServices } from "../contexts/ServiceContext";
import { useVisibleSports } from "./useVisibleSports";
import { useSportConfig } from "./useSportConfig";
import { useUserConfig } from "./useUserConfig";
import { fetchMultiSportMetrics, type MetricsEntry } from "../api/activities";
import {
  generateDemoMetrics,
  generateDemoGoals,
  getSessionFillLevels,
} from "../utils/demoDataGenerator";
import { filterValidSports } from "../utils/sportConfig";
import { getUserSettings, type DistanceUnit } from "../utils/units";
import { createYearContext, type YearContext } from "../utils/yearContext";
import { UserConfigService } from "../services/userConfigService";
import type { GoalsForYear } from "../types/generated/user_config";
import { transformToSportGoalData, type SportGoalData } from "../utils/dashboardUtils";

export type { SportGoalData };

/**
 * Hook that fetches YTD cumulative metrics + goals for all visible sports.
 *
 * Handles both demo and auth modes:
 * - Demo: generateDemoMetrics for YTD, generateDemoGoals for goals
 * - Auth: API calls for metrics, Firestore for goals (cache-shared with useUserConfig)
 *
 * Memoization strategy (React Compiler hybrid):
 * Most derivations are left to the React Compiler. Exception:
 *   - configService (useMemo): a new instance per render would create new
 *     queryFn closures in useQueries, causing unnecessary refetches.
 */
export function useDashboardGoalData(): {
  sportData: SportGoalData[];
  yearContext: YearContext;
  distanceUnit: DistanceUnit;
  isLoading: boolean;
  error: Error | null;
} {
  const { user, loading: authLoading } = useAuth();
  const { authService, databaseService } = useServices();
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();
  const { data: prefs } = useUserConfig("preferences");

  const currentYear = useCurrentYear();
  const yearContext = createYearContext(currentYear);
  const userSettings = getUserSettings(prefs);

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
  const tz = prefs?.timezone || undefined;
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

  // Auth: batch fetch goals
  const effectiveUserId = user?.uid ?? "default";
  // Explicit useMemo: avoids creating a new service instance (and thus new queryFn
  // closures in useQueries below) on every render.
  const configService = useMemo(() => {
    if (!user) return null;
    return new UserConfigService(undefined, "v1", { authService, databaseService });
  }, [user, authService, databaseService]);

  const goalsQueries = useQueries({
    queries: validSports.map((sport) => ({
      queryKey: ["userConfig", "goals", currentYear, sport, effectiveUserId, "v1"],
      queryFn: async (): Promise<GoalsForYear | null> => {
        if (!configService) return null;
        return configService.getConfigSection("goals", currentYear, sport);
      },
      enabled: !authLoading && !!user,
      staleTime: Infinity,
    })),
  });

  // --- 3. Transform to UI Model ---

  const totalSports = validSports.length;
  const sportData = validSports.map((sport, index) => {
    return transformToSportGoalData({
      sport,
      index,
      totalSports,
      metrics: user ? metricsQuery.data?.[sport] : demoMetrics?.[sport],
      goalsData: goalsQueries[index]?.data,
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
    (!!user && (metricsQuery.isLoading || goalsQueries.some((q) => q.isLoading)));
  const queryError = metricsQuery.error ?? goalsQueries.find((q) => q.error)?.error ?? null;

  return {
    sportData,
    yearContext,
    distanceUnit: userSettings.distanceUnit,
    isLoading,
    error: queryError,
  };
}
