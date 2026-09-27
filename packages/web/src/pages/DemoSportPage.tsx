import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCurrentYear } from "../hooks/useCurrentYear";
import { getDisplayUnitForMetric, getUserSettings, type MetricUnit } from "../utils/units";
import {
  buildGoal,
  estimateYearEndDistance,
  goalToDisplay,
  toStoredGoal,
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
import { GOAL_STORAGE_VERSION, type GoalsForYear } from "../services/userConfigService";
import { useGoals } from "../hooks/useGoals";
import SportPageContent from "../components/SportPageContent";
import { DEMO_ROUTE_PREFIX } from "../constants/demoConfig";
import { Alert } from "../components/ui/alert";

interface DemoSportPageProps {
  sport: string;
  year: string;
}

/**
 * Demo version of SportPage that uses generated demo data.
 * Goals are the demo's own, through the config store (`useGoals`), apart from any account's.
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
  const metricConfig = useMemo(() => getMetricConfig(sport, sportConfig), [sport, sportConfig]);

  // Calculate current values
  const estimatedYearEnd = useMemo(() => {
    if (chartData.length === 0) return metricConfig.defaultGoalValue;
    return estimateYearEndDistance(chartData, currentYear);
  }, [chartData, currentYear, metricConfig.defaultGoalValue]);

  const currentValue = chartData.length === 0 ? 0 : (chartData[chartData.length - 1]?.y ?? 0);

  // Goals management: the demo's own, through the config store (`useGoals`), which the
  // account never reads. They're stored *canonical* (meters for distance, minutes for
  // time), like an account's; the Goals the UI gets are in display units.
  const isTime = isTimeSport(sport, sportConfig);
  const hasDistance = sportInfo?.hasDistance ?? false;
  const goalCtx: GoalUnitContext = useMemo(
    () => ({ hasDistance, isTime, distanceUnit: userSettings.distanceUnit }),
    [hasDistance, isTime, userSettings.distanceUnit]
  );

  // The demo's starting goals, shown until any are saved. They're in display units, so
  // stored canonical like a saved set.
  const startingGoals = useMemo((): GoalsForYear => {
    const now = new Date().toISOString();
    const demoGoals = getDemoGoalsForSport(sport);
    const starting = [
      buildGoal(
        { id: "1", value: demoGoals.conservative, label: "Conservative", metric: primaryMetric },
        now
      ),
      buildGoal({ id: "2", value: demoGoals.target, label: "Target", metric: primaryMetric }, now),
      buildGoal(
        { id: "3", value: demoGoals.stretch, label: "Stretch", metric: primaryMetric },
        now
      ),
    ];
    return {
      goals: starting.map((g) => toStoredGoal(g, goalCtx)),
      storageVersion: GOAL_STORAGE_VERSION,
    };
  }, [sport, goalCtx, primaryMetric]);

  const {
    goalsForYear,
    loading: goalsLoading,
    save: saveGoals,
    isSaving: isGoalsSaving,
    saveError: goalsSaveError,
    clearSaveError: clearGoalsSaveError,
  } = useGoals(currentYear, sport, startingGoals);

  const goals = useMemo((): Goals => {
    if (!goalsForYear) return [];
    // Stored canonical (storageVersion 2) → convert to display for the UI. Older entries
    // predate canonical storage and already hold display values; the next save stores
    // them canonical and stamps the version.
    const canonical = goalsForYear.storageVersion === GOAL_STORAGE_VERSION;
    // Legacy demo payloads may lack proto metadata (pre-#2 fix), which the store reads as
    // empty: fill it so the resulting Goals always satisfy the type.
    const now = new Date().toISOString();
    return goalsForYear.goals.map((g) => {
      // buildGoal sets createdAt === updatedAt (fresh-goal contract); for an existing
      // record the stored updatedAt is honored, so editing history isn't reset to now.
      const goal = buildGoal(
        {
          id: g.id || now,
          value: canonical ? goalToDisplay(g.value, goalCtx) : g.value,
          label: g.label,
          metric: g.metric || primaryMetric,
        },
        g.createdAt || now
      );
      return g.updatedAt ? { ...goal, updatedAt: g.updatedAt } : goal;
    });
  }, [goalsForYear, goalCtx, primaryMetric]);

  // Persist canonical values; convert display → storage on write.
  const handleGoalsChange = (newGoals: Goals): Promise<void> =>
    saveGoals({
      goals: newGoals.map((g) => toStoredGoal(g, goalCtx)),
      storageVersion: GOAL_STORAGE_VERSION,
    });

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
      <Alert variant="demo" className="rounded-none" role="alert">
        <div>
          <strong>Demo Mode</strong> - Viewing sample data.{" "}
          <span className="text-sm">Sign-in is invite-only.</span>
        </div>
      </Alert>

      <SportPageContent
        sport={sport}
        currentYear={currentYear}
        yearContext={yearContext}
        chartData={chartData}
        currentValue={currentValue}
        estimatedYearEnd={estimatedYearEnd}
        isLoading={isLoading || goalsLoading}
        error={error}
        unit={metricUnit}
        primaryMetric={primaryMetric}
        goals={goals}
        chartGoals={goals}
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
