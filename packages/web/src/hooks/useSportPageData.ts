/**
 * useSportPageData - Encapsulates all data logic for the authenticated sport page.
 *
 * Handles: data fetching, unit conversion, metric selection, goal management,
 * goal migration, momentum tracking, sidebar data, and year context.
 *
 * Extracted from SportPage.tsx to keep the page component thin (~20 lines).
 */
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  convertDistance,
  convertElevation,
  getUserSettings,
  goalMetersToDisplay,
  goalDisplayToMeters,
  minutesToHours,
  hoursToMinutes,
  type MetricUnit,
  type DistanceUnit,
  type ElevationUnit,
} from "../utils/units";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useAuth } from "./useAuth";
import { useUserConfig } from "./useUserConfig";
import { useGoalMigration } from "./useGoalMigration";
import { useTrainingMomentum } from "./useTrainingMomentum";
import { useGoalStats } from "./useGoalStats";
import { useSportData } from "./useSportData";
import { useSidebarSportData } from "./useSidebarSportData";
import { usePriorYearMetrics } from "./usePriorYearMetrics";
import { getMetricConfig, getMetricFieldName } from "../config/metricConfig";
import { getSportMetrics, getPrimaryMetric, isTimeSport } from "../utils/sportConfig";
import type { GoalsForYear } from "../services/userConfigService";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import type { SportMetrics } from "../api/activities";
import { createYearContext, type YearContext } from "../utils/yearContext";

export interface SportPageData {
  // Core
  currentYear: number;
  yearContext: YearContext;

  // Data
  chartData: DistanceEntry[];
  currentValue: number;
  estimatedYearEnd: number;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;

  // Units
  unit: MetricUnit;

  // Goals
  goals: Goals;
  chartGoals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  isGoalsSaving: boolean;
  goalsSaveError: Error | null;
  clearGoalsSaveError?: () => void;

  // Goal stats
  nextGoal: ReturnType<typeof useGoalStats>["nextGoal"];
  nextGoalProgress: number;
  nextGoalGap: number;
  paceNeededForNextGoal: number;

  // Pace & momentum
  averagePace: number;
  momentumLevel: ReturnType<typeof useTrainingMomentum>["momentumLevel"];
  trainingMomentum: ReturnType<typeof useTrainingMomentum>["trainingMomentum"];

  // Sidebar
  availableSports: string[];
  sportCounts: Record<string, number>;

  // Metric selector
  availableMetrics: string[];
  activeMetric: string;
  onMetricChange: (metric: string) => void;

  // Prior years
  priorYearData: Record<number, DistanceEntry[]>;
  showPriorYears: boolean;
  onPriorYearsChange: (show: boolean) => void;
}

/** Convert raw sport metrics to chart-ready DistanceEntry[] based on the active metric and user settings. */
export function convertMetricsToChartData(
  metrics: SportMetrics,
  activeMetric: string,
  userSettings: { distanceUnit: DistanceUnit; elevationUnit: ElevationUnit }
): DistanceEntry[] {
  const fieldName = getMetricFieldName(activeMetric);

  return metrics
    .filter((entry) => entry[fieldName] !== undefined)
    .map((entry) => {
      const rawValue = entry[fieldName]!;

      let convertedValue: number;
      switch (activeMetric) {
        case "distance_meters":
          convertedValue = convertDistance(rawValue, userSettings.distanceUnit);
          break;
        case "elevation_meters":
          convertedValue = convertElevation(rawValue, userSettings.elevationUnit);
          break;
        case "time_minutes":
          convertedValue = minutesToHours(rawValue);
          break;
        case "activities":
        default:
          convertedValue = rawValue;
          break;
      }

      return { x: entry.date, y: convertedValue };
    });
}

export function useSportPageData(sport: string, year: number): SportPageData {
  const { user } = useAuth();
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [showPriorYears, setShowPriorYears] = useState(false);

  // Fetch sport metrics and config
  const { metrics, sportConfig, isLoading, error, retry } = useSportData(year, sport);

  // Fetch sidebar sport data (available sports and counts)
  const { availableSports, sportCounts } = useSidebarSportData(year);

  // Load user preferences for unit settings (BEFORE using them in calculations)
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  // Determine sport type and primary metric
  const sportInfo = sportConfig?.sport_categories[sport] ?? null;
  const primaryMetric = getPrimaryMetric(sport, sportConfig);
  const availableMetrics = getSportMetrics(sport, sportConfig);

  // Initialize selectedMetric to primary when sport or config changes
  useEffect(() => {
    if (sportConfig) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived metric selection when sport config changes
      setSelectedMetric(primaryMetric);
    }
  }, [sport, sportConfig, primaryMetric]);

  // Use selectedMetric or fall back to primary
  const activeMetric = selectedMetric ?? primaryMetric;

  // Determine the unit label based on selected metric
  const metricUnit: MetricUnit = (() => {
    switch (activeMetric) {
      case "distance_meters":
        return userSettings.distanceUnit;
      case "elevation_meters":
        return userSettings.elevationUnit;
      case "time_minutes":
        return "hours" as const;
      case "activities":
        return "sessions" as const;
      default:
        return sportInfo?.has_distance ? userSettings.distanceUnit : "sessions";
    }
  })();

  // Convert metrics to chart data format based on selected metric
  const chartData: DistanceEntry[] = useMemo(() => {
    if (!metrics || !sportInfo) return [];
    return convertMetricsToChartData(metrics, activeMetric, userSettings);
  }, [metrics, sportInfo, activeMetric, userSettings]);

  // Fetch prior year metrics (only when toggle is on)
  const { priorMetrics } = usePriorYearMetrics({
    currentYear: year,
    sport,
    enabled: showPriorYears,
  });

  // Convert each prior year's metrics to chart data
  const priorYearData: Record<number, DistanceEntry[]> = useMemo(() => {
    if (!showPriorYears) return {};
    const result: Record<number, DistanceEntry[]> = {};
    for (const [yearStr, metrics] of Object.entries(priorMetrics)) {
      const converted = convertMetricsToChartData(metrics, activeMetric, userSettings);
      if (converted.length > 0) {
        result[Number(yearStr)] = converted;
      }
    }
    return result;
  }, [showPriorYears, priorMetrics, activeMetric, userSettings]);

  // For goals, always use the sport's primary metric config
  const primaryMetricConfig = useMemo(() => getMetricConfig(sport), [sport]);

  // Check if we're viewing the primary metric (for goal visibility)
  const isViewingPrimaryMetric = activeMetric === primaryMetric;

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return primaryMetricConfig.defaultGoalValue;
    return estimateYearEndDistance(chartData, year);
  }, [chartData, year, primaryMetricConfig.defaultGoalValue]);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management
  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    const { roundingFactor, defaultGoalValue } = primaryMetricConfig;
    const generatedGoals = generateDefaultGoals(estimatedYearEnd, roundingFactor, defaultGoalValue);
    const timeSport = isTimeSport(sport, sportConfig);

    return {
      goals: generatedGoals.map((goal) => ({
        id: goal.id,
        value: sportInfo?.has_distance
          ? Math.round(goalDisplayToMeters(goal.value, userSettings.distanceUnit))
          : timeSport
            ? Math.round(hoursToMinutes(goal.value))
            : goal.value,
        label: goal.label || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
  }, [
    estimatedYearEnd,
    primaryMetricConfig,
    sportInfo?.has_distance,
    userSettings.distanceUnit,
    sport,
    sportConfig,
  ]);

  const {
    data: goalsData,
    updateData: updateGoals,
    isSaving: isGoalsSaving,
    saveError: goalsSaveError,
    clearSaveError: clearGoalsSaveError,
  } = useUserConfig("goals", year, sport, defaultGoalsForYear);

  // One-time migration: convert goals from legacy miles format to meters
  useGoalMigration(goalsData, user?.uid ?? "", year, sport, !!sportInfo?.has_distance, updateGoals);

  // Convert goals from storage units to display units for UI
  const goals: Goals = useMemo(() => {
    if (!goalsData?.goals) return [];

    const timeSport = isTimeSport(sport, sportConfig);

    return goalsData.goals.map((g) => {
      let displayValue = g.value;
      if (sportInfo?.has_distance) {
        displayValue = Math.round(goalMetersToDisplay(g.value, userSettings.distanceUnit));
      } else if (timeSport) {
        displayValue = Math.round(minutesToHours(g.value));
      }

      return { id: g.id, value: displayValue, label: g.label };
    });
  }, [goalsData, sportInfo?.has_distance, userSettings.distanceUnit, sport, sportConfig]);

  // Handle goals change: convert from display units back to storage units
  const handleGoalsChange = useCallback(
    async (newGoals: Goals) => {
      const timeSport = isTimeSport(sport, sportConfig);
      const updatedGoalsForYear: GoalsForYear = {
        goals: newGoals.map((goal) => ({
          id: goal.id,
          value: sportInfo?.has_distance
            ? Math.round(goalDisplayToMeters(goal.value, userSettings.distanceUnit))
            : timeSport
              ? Math.round(hoursToMinutes(goal.value))
              : goal.value,
          label: goal.label || "",
          updatedAt: new Date().toISOString(),
          createdAt:
            goalsData?.goals?.find((g) => g.id === goal.id)?.createdAt || new Date().toISOString(),
        })),
      };
      await updateGoals(updatedGoalsForYear);
    },
    [sport, sportConfig, sportInfo?.has_distance, userSettings.distanceUnit, goalsData, updateGoals]
  );

  // Year context and pacing
  const yearContext = createYearContext(year);
  const averagePace = calculateAveragePace(currentValue, year);

  // Goal stats
  const { nextGoal, nextGoalProgress, nextGoalGap, paceNeededForNextGoal } = useGoalStats(
    goals,
    currentValue,
    yearContext.daysRemaining
  );

  // Momentum
  const { momentumLevel, trainingMomentum } = useTrainingMomentum(chartData, averagePace);

  return {
    currentYear: year,
    yearContext,
    chartData,
    currentValue,
    estimatedYearEnd,
    isLoading,
    error,
    retry,
    unit: metricUnit,
    goals,
    chartGoals: isViewingPrimaryMetric ? goals : [],
    onGoalsChange: handleGoalsChange,
    isGoalsSaving,
    goalsSaveError,
    clearGoalsSaveError,
    nextGoal,
    nextGoalProgress,
    nextGoalGap,
    paceNeededForNextGoal,
    averagePace,
    momentumLevel,
    trainingMomentum,
    availableSports,
    sportCounts,
    availableMetrics,
    activeMetric,
    onMetricChange: setSelectedMetric,
    priorYearData,
    showPriorYears,
    onPriorYearsChange: setShowPriorYears,
  };
}
