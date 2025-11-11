import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { fetchSportMetrics, type SportMetrics } from "../api/activities";
import { convertDistance, DEFAULT_USER_SETTINGS } from "../utils/units";
import DistanceChart from "../components/charts/DistanceChartRecharts";
import PacingChart from "../components/charts/PacingChartRecharts";
import Sidebar from "../components/layout/Sidebar";
import KPICards from "../components/dashboard/KPICards";
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

interface SportPageProps {
  sport: string;
}

export default function SportPage({ sport }: SportPageProps) {
  const { year } = useParams<{ year?: string }>();
  const currentYear = year ? parseInt(year) : new Date().getFullYear();

  const [metrics, setMetrics] = useState<SportMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showFullYear, setShowFullYear] = useState(true);

  // Fetch sport metrics
  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchSportMetrics(currentYear, sport, controller.signal);
        setMetrics(data);
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

  // Convert metrics to DistanceEntry format for charts
  const distanceData: DistanceEntry[] = useMemo(() => {
    if (!metrics) return [];

    return metrics
      .filter((entry) => entry.distance !== undefined)
      .map((entry) => ({
        x: entry.date,
        y: convertDistance(entry.distance!, DEFAULT_USER_SETTINGS.distanceUnit),
      }));
  }, [metrics]);

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (distanceData.length === 0) return 2500;
    return estimateYearEndDistance(distanceData, currentYear);
  }, [distanceData, currentYear]);

  const currentDistance = useMemo(() => {
    if (distanceData.length === 0) return 0;
    const lastEntry = distanceData[distanceData.length - 1];
    return lastEntry?.y || 0;
  }, [distanceData]);

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
  const averagePace = calculateAveragePace(currentDistance, currentYear);

  // Custom hooks for complex calculations
  const { nextGoal, nextGoalProgress, nextGoalGap, paceNeededForNextGoal } = useGoalStats(
    goals,
    currentDistance,
    daysRemaining
  );

  const { momentumIndicator } = useTrainingMomentum(distanceData, averagePace);

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
          currentDistance={currentDistance}
        />

        <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
          <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3">
            <h1 className="h2">
              {sport.charAt(0).toUpperCase() + sport.slice(1)} {currentYear}
            </h1>
          </div>

          <KPICards
            currentDistance={currentDistance}
            nextGoal={nextGoal}
            nextGoalProgress={nextGoalProgress}
            nextGoalGap={nextGoalGap}
            paceNeededForNextGoal={paceNeededForNextGoal}
            averagePace={averagePace}
            momentumIndicator={momentumIndicator}
            daysElapsed={daysElapsed}
            daysRemaining={daysRemaining}
          />

          <div className="row">
            <div className="col-12 mb-4">
              <DistanceChart
                year={currentYear}
                goals={goals}
                onGoalsChange={handleGoalsChange}
                distanceData={distanceData}
                isLoading={isLoading}
                error={error}
                showFullYear={showFullYear}
                onViewChange={setShowFullYear}
              />
            </div>
          </div>

          <div className="row">
            <div className="col-12 mb-4">
              <PacingChart
                year={currentYear}
                goals={goals}
                distanceData={distanceData}
                isLoading={isLoading}
                error={error}
                showFullYear={showFullYear}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
