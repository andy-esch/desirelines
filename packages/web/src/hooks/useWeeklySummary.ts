import { useMemo } from "react";
import { useAuth } from "./useAuth";
import { useVisibleSports } from "./useVisibleSports";
import { useSportConfig } from "./useSportConfig";
import { useUserConfig } from "./useUserConfig";
import { useDailySportData } from "./useDailySportData";
import { getSpectrumColor } from "./useMultiSportChartData";
import { generateDemoGoals } from "../utils/demoDataGenerator";
import { filterValidSports, getSportDisplayName } from "../utils/sportConfig";
import { isDistanceMetricSport, getMetricConfig } from "../config/metricConfig";
import { getTargetGoalValue } from "../utils/goalCalculations";
import { createYearContext } from "../utils/yearContext";
import {
  convertDistance,
  getDistanceLabel,
  goalMetersToDisplay,
  getUserSettings,
} from "../utils/units";
import { toLocalDateString } from "../utils/dateUtils";
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
  isDistanceSport: boolean;
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
 * Format a short date label like "Feb 3".
 */
function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();
  const { data: prefs } = useUserConfig("preferences");

  const currentYear = new Date().getFullYear();
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
      weekLabel: `${formatShortDate(mon)} – ${formatShortDate(tod)}`,
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
    const result: Record<string, { conservative: number; target: number; stretch: number }> = {};
    for (const sport of validSports) {
      result[sport] = generateDemoGoals(sport);
    }
    return result;
  }, [user, validSports]);

  const effectiveUserId = user?.uid ?? "default";
  const configService = useMemo(() => {
    if (!user) return null;
    return new UserConfigService(undefined, "v1");
  }, [user]);

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
    const total = validSports.length;
    return validSports.map((sport, index) => {
      const isDistance = isDistanceMetricSport(sport);
      const metricConfig = getMetricConfig(sport);
      const sportData = dailyData[sport] ?? {};

      // Sum daily values for this week
      let weeklyTotalRaw = 0;
      for (const day of Object.values(sportData)) {
        if (isDistance) {
          weeklyTotalRaw += day.distanceMeters ?? 0;
        } else {
          weeklyTotalRaw += day.activities ?? 0;
        }
      }

      // Convert distance to display units
      const weeklyTotal = isDistance
        ? convertDistance(weeklyTotalRaw, userSettings.distanceUnit)
        : weeklyTotalRaw;

      // Get yearly goal to prorate
      let yearlyGoal = metricConfig.defaultGoalValue;
      if (user) {
        const goalsData = goalsQueries[index]?.data;
        if (goalsData?.goals?.length) {
          const goalValue = getTargetGoalValue(goalsData.goals);
          if (goalValue !== null) {
            yearlyGoal = isDistance
              ? goalMetersToDisplay(goalValue, userSettings.distanceUnit)
              : goalValue;
          }
        }
      } else if (demoGoals?.[sport]) {
        yearlyGoal = demoGoals[sport].target;
      }

      // Prorated weekly goal
      const weeklyGoal = (yearlyGoal * 7) / daysInYear;
      const achievementPct = weeklyGoal > 0 ? (weeklyTotal / weeklyGoal) * 100 : 0;

      return {
        sport,
        displayName: getSportDisplayName(sport, sportConfig),
        color: getSpectrumColor(index, total),
        weeklyTotal,
        weeklyGoal,
        achievementPct,
        metricUnit: isDistance ? getDistanceLabel(userSettings.distanceUnit) : "sessions",
        isDistanceSport: isDistance,
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
    yearContext,
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
