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
import { useState, useMemo, useEffect, useRef } from "react";
import {
  convertDistance,
  convertElevation,
  getDisplayUnitForMetric,
  getUserSettings,
  minutesToHours,
  type MetricUnit,
  type DistanceUnit,
  type ElevationUnit,
} from "../utils/units";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  toDisplayGoal,
  toStoredGoal,
  type GoalUnitContext,
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
import { GOAL_STORAGE_VERSION, type GoalsForYear } from "../services/userConfigService";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import type { SportMetrics } from "../api/activities";
import { createYearContext, type YearContext } from "../utils/yearContext";
import { logger } from "../lib/logger";

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

  // Sport metrics
  /** Sport's primary metric (e.g. "distance_meters"). Required by GoalControls
   * so newly-added goals carry the right `metric` from creation. */
  primaryMetric: string;

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
  const metricUnit: MetricUnit = getDisplayUnitForMetric(
    activeMetric,
    userSettings,
    sportInfo?.hasDistance ? userSettings.distanceUnit : "sessions"
  );

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
  const primaryMetricConfig = getMetricConfig(sport, sportConfig);

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

  // Destructure the metric-config primitives the memo needs. getMetricConfig
  // returns a fresh object for override-sports, so depending on the whole
  // object below would defeat the memo (Object.is fails every render). Depend
  // on these stable primitives instead.
  const { roundingFactor, defaultGoalValue } = primaryMetricConfig;

  // Goals management
  // Explicit useMemo: contains new Date().toISOString() which would make the object
  // perpetually unstable, causing useUserConfig to re-trigger on every render.
  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    const now = new Date().toISOString();
    const goalMetric = getPrimaryMetric(sport, sportConfig);
    // generateDefaultGoals now stamps metric/createdAt/updatedAt itself, so the
    // map below only converts display→storage units.
    const generatedGoals = generateDefaultGoals({
      estimatedDistance: estimatedYearEnd,
      metric: goalMetric,
      granularity: roundingFactor,
      minValue: defaultGoalValue,
      now,
    });
    const ctx: GoalUnitContext = { hasDistance, isTime, distanceUnit };

    return {
      goals: generatedGoals.map((goal) => toStoredGoal(goal, ctx)),
      storageVersion: GOAL_STORAGE_VERSION,
    };
    /* eslint-disable react-hooks/preserve-manual-memoization -- intentional: new Date() is impure, compiler can't auto-memoize */
  }, [
    estimatedYearEnd,
    roundingFactor,
    defaultGoalValue,
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

  // One-time migration: convert legacy display-unit goal values to canonical
  // storage units (miles → meters for distance sports, hours → minutes for
  // time sports). No-op for sports without a canonical unit (e.g. sessions).
  useGoalMigration(goalsData, user?.uid ?? "", year, sport, hasDistance, isTime, updateGoals);

  // Warn once per distinct goal when its stored `metric` disagrees with the
  // sport's primary metric (catches stale data, e.g. a goal copied across
  // sports). Lives in an effect — not the render-path map below — so a standing
  // mismatch logs once rather than on every render (twice per mount under
  // StrictMode), and render stays a pure function.
  const warnedMetricMismatchRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    goalsData?.goals?.forEach((g) => {
      if (g.metric && g.metric !== primaryMetric) {
        const key = `${sport}/${year}/${g.id}`;
        if (!warnedMetricMismatchRef.current.has(key)) {
          warnedMetricMismatchRef.current.add(key);
          logger.warn(
            `[useSportPageData] Goal ${g.id} for ${sport}/${year} has metric=${g.metric} but sport primary metric is ${primaryMetric}`
          );
        }
      }
    });
  }, [goalsData, primaryMetric, sport, year]);

  // Convert goals from storage units to display units for UI.
  // Carries all proto fields through to the display layer so a later write
  // doesn't need to re-derive metric/createdAt/updatedAt — closes the bolt-on
  // gap from harden-user-config-goal-data-integrity #2.
  const goalCtx: GoalUnitContext = { hasDistance, isTime, distanceUnit };
  const goals: Goals = goalsData?.goals
    ? goalsData.goals.map((g) => toDisplayGoal(g, goalCtx))
    : [];

  // Handle goals change: pure unit conversion. All proto metadata
  // (metric/createdAt/updatedAt) is already on each Goal — useGoalManager
  // stamps it on creation and refreshes `updatedAt` on every mutation. This
  // hook no longer fabricates fields, which means any code path that calls
  // updateGoals with malformed data will surface the bug here (and via the
  // write-side schema guard in UserConfigService) instead of silently
  // persisting partial records.
  const handleGoalsChange = async (newGoals: Goals) => {
    const updatedGoalsForYear: GoalsForYear = {
      goals: newGoals.map((goal) => toStoredGoal(goal, goalCtx)),
      storageVersion: GOAL_STORAGE_VERSION,
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
    primaryMetric,
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
