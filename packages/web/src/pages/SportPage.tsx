import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  convertDistance,
  convertElevation,
  getUserSettings,
  goalMetersToDisplay,
  goalDisplayToMeters,
} from "../utils/units";
import { pageBackgrounds } from "../styles/pageBackgrounds";
import CumulativeMetricsChart from "../components/charts/CumulativeMetricsChart";
import PacingMetricsChart from "../components/charts/PacingMetricsChart";
import Sidebar from "../components/layout/Sidebar";
import FilterControls from "../components/layout/FilterControls";
import GoalControls from "../components/GoalControls";
import KPICards from "../components/dashboard/KPICards";
import GoalSummaryTable from "../components/GoalSummaryTable";
import EmptyState from "../components/EmptyState";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useAuth } from "../hooks/useAuth";
import { useUserConfig } from "../hooks/useUserConfig";
import { useGoalMigration } from "../hooks/useGoalMigration";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import { useSportData } from "../hooks/useSportData";
import { useSidebarSportData } from "../hooks/useSidebarSportData";
import { getMetricConfig, getMetricFieldName } from "../config/metricConfig";
import { getSportMetrics, getPrimaryMetric } from "../utils/sportConfig";
import MetricSelector from "../components/charts/MetricSelector";
import type { GoalsForYear } from "../services/userConfigService";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { createYearContext } from "../utils/yearContext";

interface SportPageProps {
  sport: string;
}

export default function SportPage({ sport }: SportPageProps) {
  const { year } = useParams<{ year?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentYear = year ? parseInt(year) : new Date().getFullYear();
  const [showFullYear, setShowFullYear] = useState(true);
  const [showAchievements, setShowAchievements] = useState(true);
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

  const { momentumIndicator } = useTrainingMomentum(chartData, averagePace);

  return (
    <div className="container-fluid">
      <div className="row" style={{ background: pageBackgrounds.sport }}>
        <Sidebar
          estimatedYearEnd={estimatedYearEnd}
          currentValue={currentValue}
          unit={metricUnit}
          isLoading={isLoading || !!error}
          filtersSlot={
            <FilterControls
              sport={sport}
              availableSports={availableSports}
              sportCounts={sportCounts}
              onSportChange={(newSport) => navigate(`/${newSport}/${currentYear}`)}
              currentYear={currentYear}
              onYearChange={(newYear) => navigate(`/${sport}/${newYear}`)}
            />
          }
          goalsSlot={
            <GoalControls
              goals={goals}
              onGoalsChange={handleGoalsChange}
              estimatedYearEnd={estimatedYearEnd}
              unit={metricUnit}
              sport={sport}
              isSaving={isGoalsSaving}
              saveError={goalsSaveError}
              onClearSaveError={clearGoalsSaveError}
            />
          }
        />

        <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
          <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3">
            <h1 className="h2">
              {sport.charAt(0).toUpperCase() + sport.slice(1)} {currentYear}
            </h1>
          </div>

          {/* No data banner - show when viewing current year with no activities */}
          {!isLoading && currentValue === 0 && currentYear === new Date().getFullYear() && (
            <div
              className="alert d-flex align-items-center mb-3"
              role="alert"
              style={{
                backgroundColor: "rgba(0, 212, 255, 0.1)",
                border: "1px solid rgba(0, 212, 255, 0.3)",
                color: "var(--slate-light, #94a3b8)",
              }}
            >
              <span>
                No {sport} activities recorded for {currentYear}.{" "}
                <Link
                  to={`/${sport}/${currentYear - 1}`}
                  style={{ color: "var(--accent-cyan, #00d4ff)" }}
                >
                  View {currentYear - 1} instead →
                </Link>
              </span>
            </div>
          )}

          <KPICards
            currentDistance={currentValue}
            nextGoal={nextGoal}
            nextGoalProgress={nextGoalProgress}
            nextGoalGap={nextGoalGap}
            paceNeededForNextGoal={paceNeededForNextGoal}
            averagePace={averagePace}
            momentumIndicator={momentumIndicator}
            yearContext={yearContext}
            unit={metricUnit}
            isLoading={isLoading || !!error}
          />

          {!isLoading && !error && chartData.length === 0 ? (
            <EmptyState
              sport={sport}
              year={currentYear}
              unit={metricUnit}
              suggestedYear={currentYear === new Date().getFullYear() ? currentYear - 1 : undefined}
            />
          ) : (
            <GoalSummaryTable
              goals={goals}
              currentDistance={currentValue}
              yearContext={yearContext}
              unit={metricUnit}
              sport={sport}
              isLoading={isLoading || !!error}
            />
          )}

          {/* Metric Selector - only show when multiple metrics available */}
          {availableMetrics.length > 1 && (
            <div className="d-flex justify-content-end align-items-center mb-3">
              <MetricSelector
                availableMetrics={availableMetrics}
                selectedMetric={activeMetric}
                onMetricChange={setSelectedMetric}
              />
            </div>
          )}

          <div className="row">
            <div className="col-12 mb-4">
              <div className="glass-panel">
                <CumulativeMetricsChart
                  year={currentYear}
                  goals={isViewingPrimaryMetric ? goals : []}
                  distanceData={chartData}
                  isLoading={isLoading}
                  error={error}
                  showFullYear={showFullYear}
                  onViewChange={setShowFullYear}
                  showAchievements={showAchievements}
                  onAchievementsChange={setShowAchievements}
                  unit={metricUnit}
                  sport={sport}
                  onRetry={retry}
                />
              </div>
            </div>
          </div>

          <div className="row">
            <div className="col-12 mb-4">
              <div className="glass-panel">
                <PacingMetricsChart
                  year={currentYear}
                  goals={isViewingPrimaryMetric ? goals : []}
                  distanceData={chartData}
                  isLoading={isLoading}
                  error={error}
                  showFullYear={showFullYear}
                  unit={metricUnit}
                  sport={sport}
                  onRetry={retry}
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
