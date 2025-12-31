import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { convertDistance, getUserSettings } from "../utils/units";
import CumulativeMetricsChart from "../components/charts/CumulativeMetricsChart";
import PacingMetricsChart from "../components/charts/PacingMetricsChart";
import DemoSidebar from "../components/layout/DemoSidebar";
import KPICards from "../components/dashboard/KPICards";
import GoalSummaryTable from "../components/GoalSummaryTable";
import EmptyState from "../components/EmptyState";
import { estimateYearEndDistance, type Goals } from "../utils/goalCalculations";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import { useDemoData, getDemoGoalsForSport } from "../hooks/useDemoData";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { createYearContext } from "../utils/yearContext";

interface DemoSportPageProps {
  sport: string;
}

/**
 * Demo version of SportPage that uses generated demo data.
 * Goals are stored in localStorage for demo persistence.
 */
export default function DemoSportPage({ sport }: DemoSportPageProps) {
  const { year } = useParams<{ year?: string }>();
  const navigate = useNavigate();
  const currentYear = year ? parseInt(year) : new Date().getFullYear();
  const [showFullYear, setShowFullYear] = useState(true);
  const [showAchievements, setShowAchievements] = useState(true);

  // Fetch generated demo data
  const { metrics, sportConfig, isLoading, error } = useDemoData(currentYear, sport);

  // Use hardcoded settings for demo (no Firestore)
  const userSettings = getUserSettings(null);

  // Determine sport type and primary metric
  const sportInfo = sportConfig?.sport_categories[sport] ?? null;

  // Determine the unit label based on sport type
  const metricUnit = sportInfo?.has_distance ? userSettings.distanceUnit : "sessions";

  // Convert metrics to chart data format
  const chartData: DistanceEntry[] = useMemo(() => {
    if (!metrics || !sportInfo) return [];

    if (sportInfo.has_distance) {
      return metrics
        .filter((entry) => entry.distance !== undefined)
        .map((entry) => ({
          x: entry.date,
          y: convertDistance(entry.distance!, userSettings.distanceUnit),
        }));
    }

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

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management - use localStorage for demo persistence
  const storageKey = `demo_goals_${sport}_${currentYear}`;

  const [goals, setGoals] = useState<Goals>(() => {
    // Try to load from localStorage first
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return parsed.goals || [];
      } catch {
        // Fall back to defaults
      }
    }
    // Use generated demo goals for this sport
    const demoGoals = getDemoGoalsForSport(sport);
    if (demoGoals) {
      return [
        { id: "1", value: demoGoals.conservative, label: "Conservative" },
        { id: "2", value: demoGoals.target, label: "Target" },
        { id: "3", value: demoGoals.stretch, label: "Stretch" },
      ];
    }
    // Fallback
    return [
      { id: "1", value: 2000, label: "Conservative" },
      { id: "2", value: 2500, label: "Target" },
      { id: "3", value: 3000, label: "Stretch" },
    ];
  });

  const handleGoalsChange = async (newGoals: Goals): Promise<void> => {
    setGoals(newGoals);
    // Persist to localStorage
    localStorage.setItem(storageKey, JSON.stringify({ goals: newGoals }));
  };

  // Create year context
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
    <>
      {/* Demo mode banner - outside container for full width */}
      <div className="alert alert-info alert-dismissible fade show mb-0 rounded-0" role="alert">
        <div className="container-fluid">
          <strong>Demo Mode</strong> - Viewing sample data.{" "}
          <span className="text-muted small">Sign-in is invite-only.</span>
        </div>
      </div>

      <div className="container-fluid">
        <div className="row">
          <DemoSidebar
            currentYear={currentYear}
            sport={sport}
            onYearClick={(newYear) => {
              navigate(`/demo/${sport}/${newYear}`);
            }}
            goals={goals}
            onGoalsChange={handleGoalsChange}
            estimatedYearEnd={estimatedYearEnd}
            currentDistance={currentValue}
            unit={metricUnit}
            isLoading={isLoading}
            isSaving={false}
            saveError={null}
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
              yearContext={yearContext}
              unit={metricUnit}
              isLoading={isLoading}
            />

            {!isLoading && !error && chartData.length === 0 ? (
              <EmptyState sport={sport} year={currentYear} unit={metricUnit} />
            ) : (
              <GoalSummaryTable
                goals={goals}
                currentDistance={currentValue}
                yearContext={yearContext}
                unit={metricUnit}
                sport={sport}
                isLoading={isLoading}
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
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
