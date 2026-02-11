import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  convertDistance,
  convertElevation,
  getUserSettings,
  goalMetersToDisplay,
  goalDisplayToMeters,
} from "../utils/units";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useAuth } from "../hooks/useAuth";
import { useUserConfig } from "../hooks/useUserConfig";
import { useGoalMigration } from "../hooks/useGoalMigration";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import MomentumIndicator from "../components/MomentumIndicator";
import { useGoalStats } from "../hooks/useGoalStats";
import { useSportData } from "../hooks/useSportData";
import { useSidebarSportData } from "../hooks/useSidebarSportData";
import { getMetricConfig, getMetricFieldName } from "../config/metricConfig";
import { getSportMetrics, getPrimaryMetric } from "../utils/sportConfig";
import type { GoalsForYear } from "../services/userConfigService";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { createYearContext } from "../utils/yearContext";
import SportPageContent from "../components/SportPageContent";

interface SportPageProps {
  sport: string;
}

export default function SportPage({ sport }: SportPageProps) {
  const { year } = useParams<{ year?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const parsedYear = year ? parseInt(year, 10) : NaN;
  const currentYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear();
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // Fetch sport metrics and config
  const { metrics, sportConfig, isLoading, error, retry } = useSportData(currentYear, sport);

  // Fetch sidebar sport data (available sports and counts)
  const { availableSports, sportCounts } = useSidebarSportData(currentYear);

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
      setSelectedMetric(primaryMetric);
    }
  }, [sport, sportConfig, primaryMetric]);

  // Use selectedMetric or fall back to primary
  const activeMetric = selectedMetric ?? primaryMetric;

  // Determine the unit label based on selected metric
  const metricUnit = (() => {
    switch (activeMetric) {
      case "distance_meters":
        return userSettings.distanceUnit;
      case "elevation_meters":
        return userSettings.elevationUnit;
      case "time_minutes":
        return "minutes" as const;
      case "activities":
        return "sessions" as const;
      default:
        return sportInfo?.has_distance ? userSettings.distanceUnit : "sessions";
    }
  })();

  // Convert metrics to chart data format based on selected metric
  const chartData: DistanceEntry[] = useMemo(() => {
    if (!metrics || !sportInfo) return [];

    // Get the field name for the selected metric
    const fieldName = getMetricFieldName(activeMetric);

    return metrics
      .filter((entry) => entry[fieldName] !== undefined)
      .map((entry) => {
        const rawValue = entry[fieldName]!;

        // Apply appropriate conversion based on metric type
        let convertedValue: number;
        switch (activeMetric) {
          case "distance_meters":
            convertedValue = convertDistance(rawValue, userSettings.distanceUnit);
            break;
          case "elevation_meters":
            convertedValue = convertElevation(rawValue, userSettings.elevationUnit);
            break;
          case "time_minutes":
          case "activities":
          default:
            convertedValue = rawValue;
            break;
        }

        return {
          x: entry.date,
          y: convertedValue,
        };
      });
  }, [metrics, sportInfo, activeMetric, userSettings.distanceUnit, userSettings.elevationUnit]);

  // For goals, always use the sport's primary metric config
  // (metric-specific chart config will be added when charts accept MetricConfig)
  const primaryMetricConfig = useMemo(() => getMetricConfig(sport), [sport]);

  // Check if we're viewing the primary metric (for goal visibility)
  const isViewingPrimaryMetric = activeMetric === primaryMetric;

  // Calculate current values (for primary metric, used in goal calculations)
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return primaryMetricConfig.defaultGoalValue;
    return estimateYearEndDistance(chartData, currentYear);
  }, [chartData, currentYear, primaryMetricConfig.defaultGoalValue]);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management - memoize to prevent infinite loop
  // Sport-specific fallback values ensure appropriate defaults when no data exists yet

  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    // Use sport-specific configuration from MetricConfig for goal generation
    // Always use primaryMetricConfig since goals are tied to the sport's primary metric
    // - roundingFactor: granularity for goal increments (e.g., 100 for cycling, 10 for running)
    // - defaultGoalValue: minimum meaningful goal for this sport (e.g., 2500 for cycling, 100 for yoga)
    const { roundingFactor, defaultGoalValue } = primaryMetricConfig;

    // Pass sport-specific granularity and minimum value to prevent 0/invalid goals
    // This ensures goals are always meaningful even when no data exists
    const generatedGoals = generateDefaultGoals(estimatedYearEnd, roundingFactor, defaultGoalValue);

    return {
      goals: generatedGoals.map((goal) => ({
        id: goal.id,
        // For distance sports, convert from display units to meters for storage
        // Non-distance sports (yoga) store values as-is
        value: sportInfo?.has_distance
          ? Math.round(goalDisplayToMeters(goal.value, userSettings.distanceUnit))
          : goal.value,
        label: goal.label || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
  }, [estimatedYearEnd, primaryMetricConfig, sportInfo?.has_distance, userSettings.distanceUnit]);

  const {
    data: goalsData,
    updateData: updateGoals,
    isSaving: isGoalsSaving,
    saveError: goalsSaveError,
    clearSaveError: clearGoalsSaveError,
  } = useUserConfig("goals", currentYear, sport, defaultGoalsForYear);

  // One-time migration: convert goals from legacy miles format to meters
  useGoalMigration(
    goalsData,
    user?.uid ?? "",
    currentYear,
    sport,
    !!sportInfo?.has_distance,
    updateGoals
  );

  // Convert goals from meters (storage) to display units (miles/km) for UI
  // Non-distance sports (yoga) don't need conversion
  const goals: Goals = useMemo(() => {
    if (!goalsData?.goals) return [];

    // Only convert for distance-based sports
    if (!sportInfo?.has_distance) {
      return goalsData.goals.map((g) => ({
        id: g.id,
        value: g.value,
        label: g.label,
      }));
    }

    // Convert from meters to user's display unit
    return goalsData.goals.map((g) => ({
      id: g.id,
      value: Math.round(goalMetersToDisplay(g.value, userSettings.distanceUnit)),
      label: g.label,
    }));
  }, [goalsData, sportInfo?.has_distance, userSettings.distanceUnit]);

  // Handle goals change: convert from display units back to meters for storage
  const handleGoalsChange = async (newGoals: Goals) => {
    const updatedGoalsForYear: GoalsForYear = {
      goals: newGoals.map((goal) => ({
        id: goal.id,
        // Convert from display units to meters for storage (distance sports only)
        value: sportInfo?.has_distance
          ? Math.round(goalDisplayToMeters(goal.value, userSettings.distanceUnit))
          : goal.value,
        label: goal.label || "",
        updatedAt: new Date().toISOString(),
        createdAt:
          goalsData?.goals?.find((g) => g.id === goal.id)?.createdAt || new Date().toISOString(),
      })),
    };
    await updateGoals(updatedGoalsForYear);
  };

  // Create year context (encapsulates current/past/future year logic)
  const yearContext = createYearContext(currentYear);
  const { daysRemaining } = yearContext;
  const averagePace = calculateAveragePace(currentValue, currentYear);

  // Custom hooks for complex calculations
  const { nextGoal, nextGoalProgress, nextGoalGap, paceNeededForNextGoal } = useGoalStats(
    goals,
    currentValue,
    daysRemaining
  );

  const { momentumLevel, trainingMomentum } = useTrainingMomentum(chartData, averagePace);

  return (
    <SportPageContent
      sport={sport}
      currentYear={currentYear}
      yearContext={yearContext}
      chartData={chartData}
      currentValue={currentValue}
      estimatedYearEnd={estimatedYearEnd}
      isLoading={isLoading}
      error={error}
      onRetry={retry}
      unit={metricUnit}
      goals={goals}
      chartGoals={isViewingPrimaryMetric ? goals : []}
      onGoalsChange={handleGoalsChange}
      isGoalsSaving={isGoalsSaving}
      goalsSaveError={goalsSaveError}
      onClearGoalsSaveError={clearGoalsSaveError}
      nextGoal={nextGoal}
      nextGoalProgress={nextGoalProgress}
      nextGoalGap={nextGoalGap}
      paceNeededForNextGoal={paceNeededForNextGoal}
      averagePace={averagePace}
      momentumIndicator={
        <MomentumIndicator momentumLevel={momentumLevel} trainingMomentum={trainingMomentum} />
      }
      availableSports={availableSports}
      sportCounts={sportCounts}
      showAuthButton={true}
      onSportChange={(newSport) => navigate(`/${newSport}/${currentYear}`)}
      onYearChange={(newYear) => navigate(`/${sport}/${newYear}`)}
      routePrefix=""
      availableMetrics={availableMetrics}
      activeMetric={activeMetric}
      onMetricChange={setSelectedMetric}
    />
  );
}
