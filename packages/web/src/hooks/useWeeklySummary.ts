import { useMemo } from "react";
import { useAuth } from "./useAuth";
import { useCurrentYear } from "./useCurrentYear";
import { useServices } from "../contexts/ServiceContext";
import { useVisibleSports } from "./useVisibleSports";
import { useSportConfig } from "./useSportConfig";
import { useUserConfig } from "./useUserConfig";
import { useDailySportData } from "./useDailySportData";
import { SPORT_COLORS, DEFAULT_SPORT_COLOR } from "../utils/sportConfig";
import { generateDemoGoals } from "../utils/demoDataGenerator";
import { filterValidSports, getSportDisplayName, getPrimaryMetric } from "../utils/sportConfig";
import { getMetricConfig, getMetricConfigByMetricId } from "../config/metricConfig";
import { getTargetGoalValue } from "../utils/goalCalculations";
import { createYearContext } from "../utils/yearContext";
import {
  convertDistance,
  goalMetersToDisplay,
  getUserSettings,
  minutesToHours,
  type MetricType,
} from "../utils/units";
import { formatDisplayDate, toLocalDateString } from "../utils/dateUtils";
import { useQueries } from "@tanstack/react-query";
import { UserConfigService } from "../services/userConfigService";
import type { GoalsForYear } from "../types/generated/user_config";

export interface WeeklySportTotal {
  sport: string;
  displayName: string;
  color: string;
  weeklyTotal: number;
  weeklyGoal: number;
  achievementPct: number;
  metricUnit: string;
  metricType: MetricType;
}

/**
 * Compute the Monday of the current week (ISO standard: Monday = start of week).
 */
function getMondayOfCurrentWeek(): Date {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Hook for fetching this-week daily totals per sport with prorated weekly goals.
 *
 * Uses Monday as week start (ISO standard).
 * Prorated weekly goal: yearlyGoal * 7 / daysInYear
 */
export function useWeeklySummary(): {
  sportTotals: WeeklySportTotal[];
  weekLabel: string;
  isLoading: boolean;
  error: Error | null;
} {
  const { user, loading: authLoading } = useAuth();
  const { authService, databaseService } = useServices();
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();
  const { data: prefs } = useUserConfig("preferences");

  const currentYear = useCurrentYear();
  const userSettings = useMemo(() => getUserSettings(prefs), [prefs]);

  const validSports = useMemo(
    () => filterValidSports(visibleSports, sportConfig),
    [visibleSports, sportConfig]
  );

  // Compute this-week range
  const { mondayStr, todayStr, weekLabel } = useMemo(() => {
    const mon = getMondayOfCurrentWeek();
    const tod = new Date();
    return {
      mondayStr: toLocalDateString(mon),
      todayStr: toLocalDateString(tod),
      weekLabel: `${formatDisplayDate(mon)} – ${formatDisplayDate(tod)}`,
    };
  }, []);

  // Fetch daily data for this week
  const {
    data: dailyData,
    isLoading: dataLoading,
    error: dataError,
  } = useDailySportData({
    year: currentYear,
    from: mondayStr,
    to: todayStr,
    sports: validSports,
  });

  // --- Goals (same pattern as useDashboardGoalData) ---

  const demoGoals = useMemo(() => {
    if (user) return null;
    return Object.fromEntries(validSports.map((sport) => [sport, generateDemoGoals(sport)]));
  }, [user, validSports]);

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

  // Year context for prorating (daysInYear = elapsed + remaining)
  const yearContext = useMemo(() => createYearContext(currentYear), [currentYear]);
  const daysInYear = yearContext.daysElapsed + yearContext.daysRemaining;

  // Combine into WeeklySportTotal array
  const sportTotals = useMemo(() => {
    // `index` is still needed to line each sport up with its goals query — it is no
    // longer used for color, which is now fixed per sport.
    return validSports.map((sport, index) => {
      const metricConfig = getMetricConfig(sport, sportConfig);
      const primaryMetric = getPrimaryMetric(sport, sportConfig);
      const metricCfg = getMetricConfigByMetricId(primaryMetric, userSettings);
      const isDistance = primaryMetric === "distance_meters";
      const isTime = primaryMetric === "time_minutes";
      const sportData = dailyData[sport] ?? {};

      // Sum daily values for this week based on primary metric
      let weeklyTotalRaw = 0;
      for (const day of Object.values(sportData)) {
        if (isDistance) {
          weeklyTotalRaw += day.distanceMeters ?? 0;
        } else if (isTime) {
          weeklyTotalRaw += day.timeMinutes ?? 0;
        } else {
          weeklyTotalRaw += day.activities ?? 0;
        }
      }

      // Convert to display units
      let weeklyTotal: number;
      if (isDistance) {
        weeklyTotal = convertDistance(weeklyTotalRaw, userSettings.distanceUnit);
      } else if (isTime) {
        weeklyTotal = minutesToHours(weeklyTotalRaw);
      } else {
        weeklyTotal = weeklyTotalRaw;
      }

      // Get yearly goal to prorate
      let yearlyGoal = metricConfig.defaultGoalValue;
      if (user) {
        const goalsData = goalsQueries[index]?.data;
        if (goalsData?.goals?.length) {
          const goalValue = getTargetGoalValue(goalsData.goals);
          if (goalValue !== null) {
            if (isDistance) {
              yearlyGoal = goalMetersToDisplay(goalValue, userSettings.distanceUnit);
            } else if (isTime) {
              yearlyGoal = minutesToHours(goalValue);
            } else {
              yearlyGoal = goalValue;
            }
          }
        }
      } else if (demoGoals?.[sport]) {
        yearlyGoal = demoGoals[sport].target;
      }

      // Prorated weekly goal
      const weeklyGoal = (yearlyGoal * 7) / daysInYear;
      const achievementPct = weeklyGoal > 0 ? (weeklyTotal / weeklyGoal) * 100 : 0;

      const metricType: MetricType = isDistance ? "distance" : isTime ? "time" : "sessions";
      return {
        sport,
        displayName: getSportDisplayName(sport, sportConfig),
        color: SPORT_COLORS[sport] ?? DEFAULT_SPORT_COLOR,
        weeklyTotal,
        weeklyGoal,
        achievementPct,
        metricUnit: metricCfg.chartLabel,
        metricType,
      };
    });
  }, [
    validSports,
    sportConfig,
    dailyData,
    user,
    demoGoals,
    goalsQueries,
    userSettings,
    daysInYear,
  ]);

  const isLoading =
    prefsLoading ||
    configLoading ||
    authLoading ||
    dataLoading ||
    (!!user && goalsQueries.some((q) => q.isLoading));
  const error = dataError ?? (goalsQueries.find((q) => q.error)?.error as Error | null) ?? null;

  return {
    sportTotals,
    weekLabel,
    isLoading,
    error,
  };
}
