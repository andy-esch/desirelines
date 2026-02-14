import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useCurrentYear } from "./useCurrentYear";
import { useServices } from "../contexts/ServiceContext";
import { useVisibleSports } from "./useVisibleSports";
import { useSportConfig } from "./useSportConfig";
import { useUserConfig } from "./useUserConfig";
import { getSpectrumColor } from "./useMultiSportChartData";
import { fetchSportMetrics, type MetricsEntry } from "../api/activities";
import {
  generateDemoMetrics,
  generateDemoGoals,
  getSessionFillLevels,
} from "../utils/demoDataGenerator";
import { filterValidSports, getSportDisplayName, getPrimaryMetric } from "../utils/sportConfig";
import {
  getMetricConfig,
  getMetricConfigByMetricId,
  getMetricFieldName,
} from "../config/metricConfig";
import { getTargetGoalValue } from "../utils/goalCalculations";
import {
  convertDistance,
  goalMetersToDisplay,
  getUserSettings,
  minutesToHours,
} from "../utils/units";
import { createYearContext, type YearContext } from "../utils/yearContext";
import { UserConfigService } from "../services/userConfigService";
import type { GoalsForYear } from "../types/generated/user_config";

export interface SportGoalData {
  sport: string;
  displayName: string;
  color: string;
  currentValue: number;
  targetGoal: number;
  metricUnit: string;
  isDistanceSport: boolean;
  /** Smallest (least conservative) goal value in display units, for impact calculations */
  impactGoal: number;
  /** Label of the smallest goal (e.g. "Conservative") */
  impactGoalLabel: string;
}

/**
 * Hook that fetches YTD cumulative metrics + goals for all visible sports.
 *
 * Handles both demo and auth modes:
 * - Demo: generateDemoMetrics for YTD, generateDemoGoals for goals
 * - Auth: API calls for metrics, Firestore for goals (cache-shared with useUserConfig)
 */
export function useDashboardGoalData(): {
  sportData: SportGoalData[];
  yearContext: YearContext;
  distanceUnit: import("../utils/units").DistanceUnit;
  isLoading: boolean;
  error: Error | null;
} {
  const { user, loading: authLoading } = useAuth();
  const { authService, databaseService } = useServices();
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();
  const { data: prefs } = useUserConfig("preferences");

  const currentYear = useCurrentYear();
  const yearContext = useMemo(() => createYearContext(currentYear), [currentYear]);
  const userSettings = useMemo(() => getUserSettings(prefs), [prefs]);

  const validSports = useMemo(
    () => filterValidSports(visibleSports, sportConfig),
    [visibleSports, sportConfig]
  );

  // --- YTD Cumulative Metrics ---

  // Demo: generate cumulative metrics synchronously
  const demoMetrics = useMemo(() => {
    if (user) return null;
    const fillLevels = getSessionFillLevels(validSports);
    const result: Record<string, MetricsEntry[]> = {};
    for (const sport of validSports) {
      result[sport] = generateDemoMetrics(sport, currentYear, {
        overrideFillLevel: fillLevels[sport],
        allSports: validSports,
      });
    }
    return result;
  }, [user, validSports, currentYear]);

  // Auth: batch fetch cumulative metrics
  const metricsQueries = useQueries({
    queries: validSports.map((sport) => ({
      queryKey: ["sportMetrics", currentYear, sport],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchSportMetrics({ year: currentYear, sport, signal }),
      enabled: !authLoading && !!user,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // --- Goals ---

  // Demo: generate goals synchronously
  const demoGoals = useMemo(() => {
    if (user) return null;
    const result: Record<string, { conservative: number; target: number; stretch: number }> = {};
    for (const sport of validSports) {
      result[sport] = generateDemoGoals(sport);
    }
    return result;
  }, [user, validSports]);

  // Auth: batch fetch goals (query keys match useUserConfig for cache sharing)
  const effectiveUserId = user?.uid ?? "default";
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

  // --- Combine into SportGoalData ---

  const sportData = useMemo(() => {
    const total = validSports.length;
    return validSports.map((sport, index) => {
      const metricConfig = getMetricConfig(sport);
      const primaryMetric = getPrimaryMetric(sport, sportConfig);
      const metricCfg = getMetricConfigByMetricId(primaryMetric, userSettings);
      const fieldName = getMetricFieldName(primaryMetric);
      const isDistance = primaryMetric === "distance_meters";
      const isTime = primaryMetric === "time_minutes";

      // Get YTD value (in display units)
      let currentValue = 0;
      const metrics = user ? metricsQueries[index]?.data : demoMetrics?.[sport];

      if (metrics && metrics.length > 0) {
        const lastEntry = metrics[metrics.length - 1];
        const rawValue = lastEntry[fieldName] ?? 0;
        if (isDistance) {
          currentValue = convertDistance(rawValue, userSettings.distanceUnit);
        } else if (isTime) {
          currentValue = minutesToHours(rawValue);
        } else {
          currentValue = rawValue;
        }
      }

      // Get target goal (in display units)
      let targetGoal = metricConfig.defaultGoalValue;
      let impactGoal = targetGoal;
      let impactGoalLabel = "";
      if (user) {
        const goalsData = goalsQueries[index]?.data;
        if (goalsData?.goals?.length) {
          const goalValue = getTargetGoalValue(goalsData.goals);
          if (goalValue !== null) {
            if (isDistance) {
              targetGoal = goalMetersToDisplay(goalValue, userSettings.distanceUnit);
            } else if (isTime) {
              targetGoal = minutesToHours(goalValue);
            } else {
              targetGoal = goalValue;
            }
          }
          // Find the smallest goal for impact calculations
          const minGoal = goalsData.goals.reduce((min, g) => (g.value < min.value ? g : min));
          if (isDistance) {
            impactGoal = goalMetersToDisplay(minGoal.value, userSettings.distanceUnit);
          } else if (isTime) {
            impactGoal = minutesToHours(minGoal.value);
          } else {
            impactGoal = minGoal.value;
          }
          impactGoalLabel = minGoal.label ?? "";
        }
      } else if (demoGoals?.[sport]) {
        targetGoal = demoGoals[sport].target;
        impactGoal = demoGoals[sport].conservative;
        impactGoalLabel = "Conservative";
      }

      return {
        sport,
        displayName: getSportDisplayName(sport, sportConfig),
        color: getSpectrumColor(index, total),
        currentValue,
        targetGoal,
        metricUnit: metricCfg.chartLabel,
        isDistanceSport: isDistance,
        impactGoal,
        impactGoalLabel,
      };
    });
  }, [
    validSports,
    sportConfig,
    user,
    demoMetrics,
    metricsQueries,
    demoGoals,
    goalsQueries,
    userSettings,
  ]);

  const isLoading =
    prefsLoading ||
    configLoading ||
    authLoading ||
    (!!user && (metricsQueries.some((q) => q.isLoading) || goalsQueries.some((q) => q.isLoading)));
  const queryError =
    metricsQueries.find((q) => q.error)?.error ?? goalsQueries.find((q) => q.error)?.error ?? null;

  return {
    sportData,
    yearContext,
    distanceUnit: userSettings.distanceUnit,
    isLoading,
    error: queryError as Error | null,
  };
}
