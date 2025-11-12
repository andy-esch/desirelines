import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  fetchSportMetrics,
  fetchSportConfig,
  type SportMetrics,
  type SportConfig,
} from "../api/activities";
import { convertDistance, getUserSettings } from "../utils/units";
import CumulativeMetricsChart from "../components/charts/CumulativeMetricsChart";
import PacingMetricsChart from "../components/charts/PacingMetricsChart";
import Sidebar from "../components/layout/Sidebar";
import KPICards from "../components/dashboard/KPICards";
import GoalSummaryTable from "../components/GoalSummaryTable";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useUserConfig } from "../hooks/useUserConfig";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import type { GoalsForYear } from "../services/userConfigService";
import { calculateYearStats, calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { USE_FIXTURE_DATA } from "../config";
import { FIXTURE_SPORT_METRICS, FIXTURE_SPORT_CONFIG } from "../data/fixtures";

interface SportPageProps {
  sport: string;
}

export default function SportPage({ sport }: SportPageProps) {
  const { year } = useParams<{ year?: string }>();
  const currentYear = year ? parseInt(year) : new Date().getFullYear();

  const [metrics, setMetrics] = useState<SportMetrics | null>(null);
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showFullYear, setShowFullYear] = useState(true);

  // Fetch sport metrics and config
  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        // Use fixtures if configured or fallback to API
        if (USE_FIXTURE_DATA) {
          // Load from fixtures (synchronous)
          const metricsData = FIXTURE_SPORT_METRICS[sport]?.[currentYear] || [];
          const configData = FIXTURE_SPORT_CONFIG;

          setMetrics(metricsData);
          setSportConfig(configData);
        } else {
          // Fetch from API
          const [metricsData, configData] = await Promise.all([
            fetchSportMetrics(currentYear, sport, controller.signal),
            fetchSportConfig(controller.signal),
          ]);

          setMetrics(metricsData);
          setSportConfig(configData);
        }
      } catch (err) {
        if (err instanceof Error && err.message !== "Request cancelled") {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadData();

    return () => {
      controller.abort();
    };
  }, [currentYear, sport]);

  // Load user preferences for unit settings (BEFORE using them in calculations)
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = useMemo(() => getUserSettings(preferences), [preferences]);

  // Determine sport type and primary metric
  const sportInfo = useMemo(() => {
    if (!sportConfig) return null;
    return sportConfig.sport_categories[sport];
  }, [sportConfig, sport]);

  // Determine the unit label based on sport type
  const metricUnit = useMemo(() => {
    if (!sportInfo) return userSettings.distanceUnit;
    return sportInfo.has_distance ? userSettings.distanceUnit : "sessions";
  }, [sportInfo, userSettings.distanceUnit]);

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

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return 2500;
    return estimateYearEndDistance(chartData, currentYear);
  }, [chartData, currentYear]);

  const currentValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    const lastEntry = chartData[chartData.length - 1];
    return lastEntry?.y || 0;
  }, [chartData]);

  // Goals management - memoize to prevent infinite loop
  const defaultGoalsForYear: GoalsForYear = useMemo(
    () => ({
      goals: generateDefaultGoals(estimatedYearEnd || 2500).map((goal) => ({
        id: goal.id,
        value: goal.value,
        label: goal.label || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    }),
    [estimatedYearEnd]
  );

  const { data: goalsData, updateData: updateGoals } = useUserConfig(
    "goals",
    currentYear,
    sport,
    defaultGoalsForYear
  );

  const goals = goalsData?.goals || [];

  // Debug logging
  console.log("SportPage goals debug:", {
    sport,
    currentYear,
    estimatedYearEnd,
    defaultGoalsCount: defaultGoalsForYear.goals.length,
    goalsData,
    goalsCount: goals.length,
  });

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

  // Calculate stats for cards
  const yearStats = calculateYearStats(currentYear);
  const { daysElapsed, daysRemaining } = yearStats;
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
            // TODO: Use router navigation when we add year routes
            window.location.href = `/${sport}/${newYear}`;
          }}
          goals={goals}
          onGoalsChange={handleGoalsChange}
          estimatedYearEnd={estimatedYearEnd}
          currentDistance={currentValue}
          unit={metricUnit}
        />

        <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
          <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3">
            <h1 className="h2">
              {sport.charAt(0).toUpperCase() + sport.slice(1)} {currentYear}
            </h1>
          </div>

          <KPICards
            currentDistance={currentValue}
            nextGoal={nextGoal}
            nextGoalProgress={nextGoalProgress}
            nextGoalGap={nextGoalGap}
            paceNeededForNextGoal={paceNeededForNextGoal}
            averagePace={averagePace}
            momentumIndicator={momentumIndicator}
            daysElapsed={daysElapsed}
            daysRemaining={daysRemaining}
            unit={metricUnit}
          />

          <GoalSummaryTable
            goals={goals}
            currentDistance={currentValue}
            year={currentYear}
            unit={metricUnit}
          />

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
                unit={metricUnit}
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
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
