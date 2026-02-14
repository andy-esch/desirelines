import { useState, useMemo, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCurrentYear } from "../hooks/useCurrentYear";
import { convertDistance, getUserSettings } from "../utils/units";
import { estimateYearEndDistance, type Goals } from "../utils/goalCalculations";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import MomentumIndicator from "../components/MomentumIndicator";
import { useGoalStats } from "../hooks/useGoalStats";
import { useDemoData, getDemoGoalsForSport } from "../hooks/useDemoData";
import { useDemoSidebarSportData } from "../hooks/useSidebarSportData";
import { getMetricConfig } from "../config/metricConfig";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { createYearContext } from "../utils/yearContext";
import SportPageContent from "../components/SportPageContent";

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
  const parsedYear = year ? parseInt(year, 10) : NaN;
  const fallbackYear = useCurrentYear();
  const currentYear = Number.isFinite(parsedYear) ? parsedYear : fallbackYear;

  // Fetch generated demo data (uses config defaults from demoConfig.ts)
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

  const loadGoals = useCallback((): Goals => {
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
    const demoGoals = getDemoGoalsForSport(sport);
    if (demoGoals) {
      return [
        { id: "1", value: demoGoals.conservative, label: "Conservative" },
        { id: "2", value: demoGoals.target, label: "Target" },
        { id: "3", value: demoGoals.stretch, label: "Stretch" },
      ];
    }
    return [
      { id: "1", value: 2000, label: "Conservative" },
      { id: "2", value: 2500, label: "Target" },
      { id: "3", value: 3000, label: "Stretch" },
    ];
  }, [storageKey, sport]);

  const [goals, setGoals] = useState<Goals>(loadGoals);

  // Re-load goals when sport or year changes (storageKey changes)
  useEffect(() => {
    setGoals(loadGoals());
  }, [loadGoals]);

  const handleGoalsChange = async (newGoals: Goals): Promise<void> => {
    setGoals(newGoals);
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

  const { momentumLevel, trainingMomentum } = useTrainingMomentum(chartData, averagePace);

  return (
    <>
      {/* Demo mode banner - outside container for full width */}
      <div className="alert alert-demo mb-0 rounded-0" role="alert">
        <div className="container-fluid">
          <strong>Demo Mode</strong> - Viewing sample data.{" "}
          <span className="text-muted small">Sign-in is invite-only.</span>
        </div>
      </div>

      <SportPageContent
        sport={sport}
        currentYear={currentYear}
        yearContext={yearContext}
        chartData={chartData}
        currentValue={currentValue}
        estimatedYearEnd={estimatedYearEnd}
        isLoading={isLoading}
        error={error}
        unit={metricUnit}
        goals={goals}
        chartGoals={goals}
        onGoalsChange={handleGoalsChange}
        isGoalsSaving={false}
        goalsSaveError={null}
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
        showAuthButton={false}
        onSportChange={(newSport) => navigate(`/demo/${newSport}/${currentYear}`)}
        onYearChange={(newYear) => navigate(`/demo/${sport}/${newYear}`)}
        routePrefix="/demo"
      />
    </>
  );
}
