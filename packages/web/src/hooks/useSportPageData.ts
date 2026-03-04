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
 * Exception where explicit memoization is retained:
 *   - defaultGoalsForYear (useMemo): contains new Date().toISOString() calls that
 *     produce fresh values each render, making the object perpetually unstable
 *     and defeating useUserConfig's default-value comparison. The compiler's
 *     preserve-manual-memoization rule is suppressed here since the compiler
 *     cannot auto-memoize impure Date() calls.
 */
import { useState, useMemo } from "react";
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
  const [metricSelection, setMetricSelection] = useState<{
    sport: string;
    metric: string;
  } | null>(null);
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

  // Derive active metric: use selection if it's for the current sport, otherwise fall back to primary
  const activeMetric = metricSelection?.sport === sport ? metricSelection.metric : primaryMetric;

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
    for (const [yearStr, priorMetric] of Object.entries(priorMetrics)) {
      const converted = convertMetricsToChartData(priorMetric, activeMetric, userSettings);
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

  // Capture mutable property accesses into stable locals for the React Compiler.
  // Without this, the compiler sees `userSettings.distanceUnit` and `sportInfo?.hasDistance`
  // as properties on mutable objects that could change between the memo check and usage.
  const distanceUnit = userSettings.distanceUnit;
  const hasDistance = sportInfo?.hasDistance ?? false;

  // Goals management
  // Explicit useMemo: contains new Date().toISOString() which would make the object
  // perpetually unstable, causing useUserConfig to re-trigger on every render.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional: new Date() is impure, compiler can't auto-memoize
  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    const { roundingFactor, defaultGoalValue } = primaryMetricConfig;
    const generatedGoals = generateDefaultGoals(estimatedYearEnd, roundingFactor, defaultGoalValue);
    const now = new Date().toISOString();
    const goalMetric = getPrimaryMetric(sport, sportConfig);

    return {
      goals: generatedGoals.map((goal) => ({
        id: goal.id,
        value: hasDistance
          ? Math.round(goalDisplayToMeters(goal.value, distanceUnit))
          : isTime
            ? Math.round(hoursToMinutes(goal.value))
            : goal.value,
        label: goal.label || "",
        metric: goalMetric,
        createdAt: now,
        updatedAt: now,
      })),
    };
    /* eslint-disable react-hooks/preserve-manual-memoization -- intentional: new Date() is impure, compiler can't auto-memoize */
  }, [
    estimatedYearEnd,
    primaryMetricConfig,
    hasDistance,
    distanceUnit,
    isTime,
    sport,
    sportConfig,
  ]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const {
    data: goalsData,
    updateData: updateGoals,
    isSaving: isGoalsSaving,
    saveError: goalsSaveError,
    clearSaveError: clearGoalsSaveError,
  } = useUserConfig("goals", year, sport, defaultGoalsForYear);

  // One-time migration: convert goals from legacy miles format to meters
  useGoalMigration(goalsData, user?.uid ?? "", year, sport, hasDistance, updateGoals);

  // Convert goals from storage units to display units for UI
  const goals: Goals = goalsData?.goals
    ? goalsData.goals.map((g) => {
        let displayValue = g.value;
        if (hasDistance) {
          displayValue = Math.round(goalMetersToDisplay(g.value, distanceUnit));
        } else if (isTime) {
          displayValue = Math.round(minutesToHours(g.value));
        }

        return { id: g.id, value: displayValue, label: g.label };
      })
    : [];

  // Handle goals change: convert from display units back to storage units
  // No manual useCallback — the React Compiler auto-memoizes this. The new Date()
  // calls are inside the callback body (lazy), so they don't break memoization.
  const handleGoalsChange = async (newGoals: Goals) => {
    const goalMetric = getPrimaryMetric(sport, sportConfig);
    const updatedGoalsForYear: GoalsForYear = {
      goals: newGoals.map((goal) => ({
        id: goal.id,
        value: hasDistance
          ? Math.round(goalDisplayToMeters(goal.value, distanceUnit))
          : isTime
            ? Math.round(hoursToMinutes(goal.value))
            : goal.value,
        label: goal.label || "",
        metric: goalMetric,
        updatedAt: new Date().toISOString(),
        createdAt:
          goalsData?.goals?.find((g) => g.id === goal.id)?.createdAt || new Date().toISOString(),
      })),
    };
    await updateGoals(updatedGoalsForYear);
  };

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
    onMetricChange: (metric: string) => setMetricSelection({ sport, metric }),
    priorYearData,
    showPriorYears,
    onPriorYearsChange: setShowPriorYears,
  };
}
