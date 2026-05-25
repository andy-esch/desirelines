import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCurrentYear } from "../hooks/useCurrentYear";
import { getDisplayUnitForMetric, getUserSettings, type MetricUnit } from "../utils/units";
import {
  estimateYearEndDistance,
  goalToDisplay,
  goalToStorage,
  type GoalUnitContext,
  type Goals,
} from "../utils/goalCalculations";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import MomentumIndicator from "../components/MomentumIndicator";
import { useGoalStats } from "../hooks/useGoalStats";
import { useDemoData, getDemoGoalsForSport } from "../hooks/useDemoData";
import { useDemoSidebarSportData } from "../hooks/useSidebarSportData";
import { getMetricConfig } from "../config/metricConfig";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { createYearContext } from "../utils/yearContext";
import { getPrimaryMetric, isTimeSport } from "../utils/sportConfig";
import { convertMetricsToChartData } from "../hooks/useSportPageData";
import SportPageContent from "../components/SportPageContent";
import { DEMO_ROUTE_PREFIX } from "../constants/demoConfig";

interface DemoSportPageProps {
  sport: string;
  year: string;
}

/**
 * Demo version of SportPage that uses generated demo data.
 * Goals are stored in localStorage for demo persistence.
 */
export default function DemoSportPage({ sport, year }: DemoSportPageProps) {
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
  const sportInfo = sportConfig?.sportCategories?.[sport] ?? null;
  const primaryMetric = getPrimaryMetric(sport, sportConfig);

  const metricUnit: MetricUnit = getDisplayUnitForMetric(
    primaryMetric,
    userSettings,
    sportInfo?.hasDistance ? userSettings.distanceUnit : "sessions"
  );

  // Convert metrics to chart data format
  const chartData: DistanceEntry[] = useMemo(() => {
    if (!metrics || !sportInfo) return [];
    return convertMetricsToChartData(metrics, primaryMetric, userSettings);
  }, [metrics, sportInfo, primaryMetric, userSettings]);

  // Get sport-specific configuration from MetricConfig system
  const metricConfig = useMemo(() => getMetricConfig(sport), [sport]);

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return metricConfig.defaultGoalValue;
    return estimateYearEndDistance(chartData, currentYear);
  }, [chartData, currentYear, metricConfig.defaultGoalValue]);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management - use localStorage for demo persistence.
  //
  // localStorage holds *canonical* values (meters for distance, minutes for
  // time) so they round-trip cleanly into Firestore when a demo user signs in
  // (see the localStorage→Firestore migration in useUserConfig). The Goals
  // type returned to UI is in display units.
  const storageKey = `demo_goals_${sport}_${currentYear}`;
  const isTime = isTimeSport(sport, sportConfig);
  const hasDistance = sportInfo?.hasDistance ?? false;
  const goalCtx: GoalUnitContext = useMemo(
    () => ({ hasDistance, isTime, distanceUnit: userSettings.distanceUnit }),
    [hasDistance, isTime, userSettings.distanceUnit]
  );

  const loadGoals = useCallback((): Goals => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { goals?: Goals } | null;
        if (Array.isArray(parsed?.goals)) {
          // Stored canonical → convert to display for the UI.
          return parsed.goals.map((g) => ({ ...g, value: goalToDisplay(g.value, goalCtx) }));
        }
      } catch {
        // Fall back to defaults
      }
    }
    const demoGoals = getDemoGoalsForSport(sport);
    if (demoGoals) {
      // Demo defaults are already in display units — keep them that way for the UI.
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
    // goalCtx is derived from sport/userSettings; including them transitively.
  }, [storageKey, sport, goalCtx]);

  const [goals, setGoals] = useState<Goals>(loadGoals);
  const [prevStorageKey, setPrevStorageKey] = useState(storageKey);

  // Sync goals when sport or year changes (storageKey changes)
  if (storageKey !== prevStorageKey) {
    setPrevStorageKey(storageKey);
    setGoals(loadGoals());
  }

  const handleGoalsChange = (newGoals: Goals): Promise<void> => {
    setGoals(newGoals);
    // Persist canonical values; convert display → storage on write.
    const canonical = newGoals.map((g) => ({ ...g, value: goalToStorage(g.value, goalCtx) }));
    localStorage.setItem(storageKey, JSON.stringify({ goals: canonical }));
    return Promise.resolve();
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
      <div className="alert alert-demo mb-0 rounded-none" role="alert">
        <div className="container-fluid">
          <strong>Demo Mode</strong> - Viewing sample data.{" "}
          <span className="text-slate text-sm">Sign-in is invite-only.</span>
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
        activeMetric={primaryMetric}
        showAuthButton={false}
        onSportChange={(newSport) => {
          void navigate({
            to: "/demo/$sport/$year",
            params: { sport: newSport, year: String(currentYear) },
          });
        }}
        onYearChange={(newYear) => {
          void navigate({
            to: "/demo/$sport/$year",
            params: { sport, year: String(newYear) },
          });
        }}
        routePrefix={DEMO_ROUTE_PREFIX}
        priorYearData={{}}
      />
    </>
  );
}
