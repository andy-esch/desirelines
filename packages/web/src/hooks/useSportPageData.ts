/**
 * useSportPageData - Encapsulates all data logic for the authenticated sport page.
 *
 * Handles: data fetching, unit conversion, metric selection, goal management,
 * goal migration, momentum tracking, sidebar data, and year context.
 *
 * Extracted from SportPage.tsx to keep the page component thin (~20 lines).
 *
 * Memoization strategy (React Compiler hybrid):
 *
 * Most derivations are left unmemoized — the React Compiler handles these.
 * Exceptions where explicit memoization is retained:
 *   - handleGoalsChange (useCallback): passed as a prop to child components;
 *     without stable identity, goal editor would re-render on every parent render.
 *   - defaultGoalsForYear (useMemo): contains new Date().toISOString() calls that
 *     produce fresh values each render, making the object perpetually unstable
 *     and defeating useUserConfig's default-value comparison.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
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

  // Load user preferences for unit settings
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  // Determine sport type and primary metric
  const sportInfo = sportConfig?.sportCategories?.[sport] ?? null;
  const primaryMetric = getPrimaryMetric(sport, sportConfig);
  const availableMetrics = getSportMetrics(sport, sportConfig);
  const isTime = isTimeSport(sport, sportConfig);

  // Initialize selectedMetric to primary when sport or config changes
  useEffect(() => {
    if (sportConfig) {
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
        return sportInfo?.hasDistance ? userSettings.distanceUnit : "sessions";
    }
  })();

  // Convert metrics to chart data format based on selected metric
  const chartData: DistanceEntry[] =
    metrics && sportInfo ? convertMetricsToChartData(metrics, activeMetric, userSettings) : [];

  // Fetch prior year metrics (only when toggle is on)
  const { priorMetrics } = usePriorYearMetrics({
    currentYear: year,
    sport,
    enabled: showPriorYears,
  });

  // Convert each prior year's metrics to chart data
  const priorYearData: Record<number, DistanceEntry[]> = {};
  if (showPriorYears) {
    for (const [yearStr, metrics] of Object.entries(priorMetrics)) {
      const converted = convertMetricsToChartData(metrics, activeMetric, userSettings);
      if (converted.length > 0) {
        priorYearData[Number(yearStr)] = converted;
      }
    }
  }

  // For goals, always use the sport's primary metric config
  const primaryMetricConfig = getMetricConfig(sport);

  // Check if we're viewing the primary metric (for goal visibility)
  const isViewingPrimaryMetric = activeMetric === primaryMetric;

  // Calculate current values
  const estimatedYearEnd =
    chartData.length === 0
      ? primaryMetricConfig.defaultGoalValue
      : estimateYearEndDistance(chartData, year);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management
  // Explicit useMemo: contains new Date().toISOString() which would make the object
  // perpetually unstable, causing useUserConfig to re-trigger on every render.
  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    const { roundingFactor, defaultGoalValue } = primaryMetricConfig;
    const generatedGoals = generateDefaultGoals(estimatedYearEnd, roundingFactor, defaultGoalValue);
    const now = new Date().toISOString();
    const primaryMetric = getPrimaryMetric(sport, sportConfig);

    return {
      goals: generatedGoals.map((goal) => ({
        id: goal.id,
        value: sportInfo?.hasDistance
          ? Math.round(goalDisplayToMeters(goal.value, userSettings.distanceUnit))
          : isTime
            ? Math.round(hoursToMinutes(goal.value))
            : goal.value,
        label: goal.label || "",
        metric: primaryMetric,
        createdAt: now,
        updatedAt: now,
      })),
    };
  }, [
    estimatedYearEnd,
    primaryMetricConfig,
    sportInfo?.hasDistance,
    userSettings.distanceUnit,
    isTime,
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
  useGoalMigration(goalsData, user?.uid ?? "", year, sport, !!sportInfo?.hasDistance, updateGoals);

  // Convert goals from storage units to display units for UI
  const goals: Goals = goalsData?.goals
    ? goalsData.goals.map((g) => {
        let displayValue = g.value;
        if (sportInfo?.hasDistance) {
          displayValue = Math.round(goalMetersToDisplay(g.value, userSettings.distanceUnit));
        } else if (isTime) {
          displayValue = Math.round(minutesToHours(g.value));
        }

        return { id: g.id, value: displayValue, label: g.label };
      })
    : [];

  // Handle goals change: convert from display units back to storage units
  // Explicit useCallback: passed as onGoalsChange prop to child components.
  const handleGoalsChange = useCallback(
    async (newGoals: Goals) => {
      const primaryMetric = getPrimaryMetric(sport, sportConfig);
      const updatedGoalsForYear: GoalsForYear = {
        goals: newGoals.map((goal) => ({
          id: goal.id,
          value: sportInfo?.hasDistance
            ? Math.round(goalDisplayToMeters(goal.value, userSettings.distanceUnit))
            : isTime
              ? Math.round(hoursToMinutes(goal.value))
              : goal.value,
          label: goal.label || "",
          metric: primaryMetric,
          updatedAt: new Date().toISOString(),
          createdAt:
            goalsData?.goals?.find((g) => g.id === goal.id)?.createdAt || new Date().toISOString(),
        })),
      };
      await updateGoals(updatedGoalsForYear);
    },
    [
      isTime,
      sportInfo?.hasDistance,
      userSettings.distanceUnit,
      goalsData,
      updateGoals,
      sport,
      sportConfig,
    ]
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
