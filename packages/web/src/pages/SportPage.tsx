import { useState, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  convertDistance,
  getUserSettings,
  goalMetersToDisplay,
  goalDisplayToMeters,
} from "../utils/units";
import {
  migrateGoalUnitsIfNeeded,
  markGoalUnitMigrated,
  isGoalUnitMigrated,
} from "../utils/migration";
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
import { useUserConfig } from "../hooks/useUserConfig";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import { useSportData } from "../hooks/useSportData";
import { useSidebarSportData } from "../hooks/useSidebarSportData";
import { getMetricConfig } from "../config/metricConfig";
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
  const currentYear = year ? parseInt(year) : new Date().getFullYear();
  const [showFullYear, setShowFullYear] = useState(true);
  const [showAchievements, setShowAchievements] = useState(true);

  // Fetch sport metrics and config
  const { metrics, sportConfig, isLoading, error, retry } = useSportData(currentYear, sport);

  // Fetch sidebar sport data (available sports and counts)
  const { availableSports, sportCounts } = useSidebarSportData(currentYear);

  // Load user preferences for unit settings (BEFORE using them in calculations)
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  // Determine sport type and primary metric
  const sportInfo = sportConfig?.sport_categories[sport] ?? null;

  // Determine the unit label based on sport type
  const metricUnit = sportInfo?.has_distance ? userSettings.distanceUnit : "sessions";

  // Convert metrics to chart data format - use distance or activity count based on sport
  const chartData: DistanceEntry[] = useMemo(() => {
    if (!metrics || !sportInfo) return [];

    // For sports with distance (cycling, running), use distance metric
    if (sportInfo.has_distance) {
      return metrics
        .filter((entry) => entry.distance !== undefined)
        .map((entry) => ({
          x: entry.date,
          y: convertDistance(entry.distance!, userSettings.distanceUnit),
        }));
    }

    // For sports without distance (yoga), use activity count
    return metrics
      .filter((entry) => entry.activities !== undefined)
      .map((entry) => ({
        x: entry.date,
        y: entry.activities!,
      }));
  }, [metrics, sportInfo, userSettings.distanceUnit]);

  // Get sport-specific configuration from MetricConfig system
  const metricConfig = useMemo(() => getMetricConfig(sport), [sport]);

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return metricConfig.defaultGoalValue;
    return estimateYearEndDistance(chartData, currentYear);
  }, [chartData, currentYear, metricConfig.defaultGoalValue]);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management - memoize to prevent infinite loop
  // Sport-specific fallback values ensure appropriate defaults when no data exists yet

  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    // Use sport-specific configuration from MetricConfig for goal generation
    // - roundingFactor: granularity for goal increments (e.g., 100 for cycling, 10 for running)
    // - defaultGoalValue: minimum meaningful goal for this sport (e.g., 2500 for cycling, 100 for yoga)
    const { roundingFactor, defaultGoalValue } = metricConfig;

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
  }, [estimatedYearEnd, metricConfig, sportInfo?.has_distance, userSettings.distanceUnit]);

  const {
    data: goalsData,
    updateData: updateGoals,
    isSaving: isGoalsSaving,
    saveError: goalsSaveError,
    clearSaveError: clearGoalsSaveError,
  } = useUserConfig("goals", currentYear, sport, defaultGoalsForYear);

  // Track if we've triggered migration for this session to avoid loops
  const migrationTriggered = useRef(false);

  // One-time migration: convert goals from miles to meters (legacy format)
  // This runs once per year/sport when goals are first loaded
  useEffect(() => {
    if (!goalsData || migrationTriggered.current) return;
    if (!sportInfo?.has_distance) return; // Only distance sports need migration

    // Check if migration is needed
    if (!isGoalUnitMigrated(currentYear, sport) && goalsData.goals.length > 0) {
      migrationTriggered.current = true;
      const { goals: migratedGoals, needsSave } = migrateGoalUnitsIfNeeded(
        goalsData,
        currentYear,
        sport
      );

      if (needsSave) {
        // Save migrated goals (now in meters)
        updateGoals(migratedGoals).then(() => {
          markGoalUnitMigrated(currentYear, sport);
        });
      } else {
        // Already migrated or no conversion needed
        markGoalUnitMigrated(currentYear, sport);
      }
    }
  }, [goalsData, currentYear, sport, sportInfo?.has_distance, updateGoals]);

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
      <div className="row">
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

        <main
          className="col-md-9 ms-sm-auto col-lg-10 px-md-4"
          style={{ background: pageBackgrounds.sport }}
        >
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

          <div className="row">
            <div className="col-12 mb-4">
              <CumulativeMetricsChart
                year={currentYear}
                goals={goals}
                onGoalsChange={handleGoalsChange}
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

          <div className="row">
            <div className="col-12 mb-4">
              <PacingMetricsChart
                year={currentYear}
                goals={goals}
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
        </main>
      </div>
    </div>
  );
}
