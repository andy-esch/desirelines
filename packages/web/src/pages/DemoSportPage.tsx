import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { convertDistance, getUserSettings } from "../utils/units";
import { pageBackgrounds } from "../styles/pageBackgrounds";
import CumulativeMetricsChart from "../components/charts/CumulativeMetricsChart";
import PacingMetricsChart from "../components/charts/PacingMetricsChart";
import Sidebar from "../components/layout/Sidebar";
import FilterControls from "../components/layout/FilterControls";
import GoalControls from "../components/GoalControls";
import { useDemoSidebarSportData } from "../hooks/useSidebarSportData";
import KPICards from "../components/dashboard/KPICards";
import GoalSummaryTable from "../components/GoalSummaryTable";
import EmptyState from "../components/EmptyState";
import { estimateYearEndDistance, type Goals } from "../utils/goalCalculations";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import { useDemoData, getDemoGoalsForSport } from "../hooks/useDemoData";
import { getMetricConfig } from "../config/metricConfig";
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

  // Fetch sidebar sport data for demo mode
  const { availableSports, sportCounts } = useDemoSidebarSportData(currentYear);

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

  // Get sport-specific configuration from MetricConfig system
  const metricConfig = useMemo(() => getMetricConfig(sport), [sport]);

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return metricConfig.defaultGoalValue;
    return estimateYearEndDistance(chartData, currentYear);
  }, [chartData, currentYear, metricConfig.defaultGoalValue]);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management - use localStorage for demo persistence
  const storageKey = `demo_goals_${sport}_${currentYear}`;

  const [goals, setGoals] = useState<Goals>(() => {
    // Try to load from localStorage first
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.goals)) {
          return parsed.goals;
        }
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
      <div className="alert alert-demo mb-0 rounded-0" role="alert">
        <div className="container-fluid">
          <strong>Demo Mode</strong> - Viewing sample data.{" "}
          <span className="text-muted small">Sign-in is invite-only.</span>
        </div>
      </div>

      <div className="container-fluid">
        <div className="row">
          <Sidebar
            estimatedYearEnd={estimatedYearEnd}
            currentValue={currentValue}
            unit={metricUnit}
            isLoading={isLoading}
            showAuthButton={false}
            filtersSlot={
              <FilterControls
                sport={sport}
                availableSports={availableSports}
                sportCounts={sportCounts}
                onSportChange={(newSport) => navigate(`/demo/${newSport}/${currentYear}`)}
                currentYear={currentYear}
                onYearChange={(newYear) => navigate(`/demo/${sport}/${newYear}`)}
              />
            }
            goalsSlot={
              <GoalControls
                goals={goals}
                onGoalsChange={handleGoalsChange}
                estimatedYearEnd={estimatedYearEnd}
                unit={metricUnit}
                sport={sport}
                isSaving={false}
                saveError={null}
                onClearSaveError={undefined}
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
                    to={`/demo/${sport}/${currentYear - 1}`}
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
              isLoading={isLoading}
            />

            {!isLoading && !error && chartData.length === 0 ? (
              <EmptyState
                sport={sport}
                year={currentYear}
                unit={metricUnit}
                suggestedYear={
                  currentYear === new Date().getFullYear() ? currentYear - 1 : undefined
                }
              />
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
                  distanceData={chartData}
                  isLoading={isLoading}
                  error={error}
                  showFullYear={showFullYear}
                  onViewChange={setShowFullYear}
                  showAchievements={showAchievements}
                  onAchievementsChange={setShowAchievements}
                  unit={metricUnit}
                  sport={sport}
                  onRetry={undefined} // Demo data cannot error
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
                  onRetry={undefined} // Demo data cannot error
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
