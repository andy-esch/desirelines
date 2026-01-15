import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { convertDistance, getUserSettings } from "../utils/units";
import { pageBackgrounds } from "../styles/pageBackgrounds";
import CumulativeMetricsChart from "../components/charts/CumulativeMetricsChart";
import PacingMetricsChart from "../components/charts/PacingMetricsChart";
import Sidebar from "../components/layout/Sidebar";
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
    // Use sport-specific fallback values from MetricConfig when estimatedYearEnd is not available
    const fallbackValue = metricConfig.defaultGoalValue;

    return {
      goals: generateDefaultGoals(estimatedYearEnd || fallbackValue).map((goal) => ({
        id: goal.id,
        value: goal.value,
        label: goal.label || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
  }, [estimatedYearEnd, metricConfig]);

  const {
    data: goalsData,
    updateData: updateGoals,
    isSaving: isGoalsSaving,
    saveError: goalsSaveError,
    clearSaveError: clearGoalsSaveError,
  } = useUserConfig("goals", currentYear, sport, defaultGoalsForYear);

  const goals = goalsData?.goals || [];

  const handleGoalsChange = async (newGoals: Goals) => {
    const updatedGoalsForYear: GoalsForYear = {
      goals: newGoals.map((goal) => ({
        id: goal.id,
        value: goal.value,
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
          currentYear={currentYear}
          sport={sport}
          onYearClick={(newYear) => {
            navigate(`/${sport}/${newYear}`);
          }}
          goals={goals}
          onGoalsChange={handleGoalsChange}
          estimatedYearEnd={estimatedYearEnd}
          currentValue={currentValue}
          unit={metricUnit}
          isLoading={isLoading || !!error}
          isSaving={isGoalsSaving}
          saveError={goalsSaveError}
          onClearSaveError={clearGoalsSaveError}
          availableSports={availableSports}
          sportCounts={sportCounts}
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
