import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import EmptyState from "../components/EmptyState";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useUserConfig } from "../hooks/useUserConfig";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import type { GoalsForYear } from "../services/userConfigService";
import { calculateAveragePace } from "../utils/dateCalculations";
import type { DistanceEntry } from "../types/activity";
import { USE_FIXTURE_DATA } from "../config";
import { FIXTURE_SPORT_METRICS, FIXTURE_SPORT_CONFIG } from "../data/fixtures";
import { useAuth } from "../hooks/useAuth";
import { createYearContext } from "../utils/yearContext";

interface SportPageProps {
  sport: string;
}

export default function SportPage({ sport }: SportPageProps) {
  const { year } = useParams<{ year?: string }>();
  const navigate = useNavigate();
  const currentYear = year ? parseInt(year) : new Date().getFullYear();

  const [metrics, setMetrics] = useState<SportMetrics | null>(null);
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showFullYear, setShowFullYear] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  // Get auth state for smart mode
  const { user, loading: authLoading } = useAuth();

  // Retry handler for error recovery
  const handleRetry = () => {
    setError(null);
    setRetryCount((prev) => prev + 1);
  };

  // Fetch sport metrics and config
  useEffect(() => {
    // Don't make API calls while auth is still loading
    if (authLoading) {
      return;
    }

    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        // Smart mode: Use fixtures for anonymous users when USE_FIXTURE_DATA=true
        // Authenticated users always fetch from API (even if USE_FIXTURE_DATA=true)
        const shouldUseFixtures = USE_FIXTURE_DATA && !user;

        if (shouldUseFixtures) {
          // Load from fixtures (synchronous)
          const metricsData = FIXTURE_SPORT_METRICS[sport]?.[currentYear] || [];
          const configData = FIXTURE_SPORT_CONFIG;

          setMetrics(metricsData);
          setSportConfig(configData);
        } else {
          // Fetch from API (authenticated user or USE_FIXTURE_DATA=false)
          // Get Firebase ID token if user is authenticated
          let idToken: string | undefined;
          if (user) {
            const { getFirebaseAuth } = await import("../lib/firebase");
            const auth = getFirebaseAuth();
            const currentUser = auth.currentUser;
            if (currentUser) {
              idToken = await currentUser.getIdToken();
            }
          }

          const [metricsData, configData] = await Promise.all([
            fetchSportMetrics(currentYear, sport, controller.signal, idToken),
            fetchSportConfig(controller.signal, idToken),
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
  }, [currentYear, sport, user, authLoading, retryCount]);

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
  // Sport-specific fallback values ensure appropriate defaults when no data exists yet
  const defaultGoalsForYear: GoalsForYear = useMemo(() => {
    // Use sport-specific fallback values when estimatedYearEnd is not available
    const fallbackValue = sport === "yoga" ? 100 : sport === "running" ? 1000 : 2500;

    return {
      goals: generateDefaultGoals(estimatedYearEnd || fallbackValue).map((goal) => ({
        id: goal.id,
        value: goal.value,
        label: goal.label || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
  }, [estimatedYearEnd, sport]);

  const { data: goalsData, updateData: updateGoals } = useUserConfig(
    "goals",
    currentYear,
    sport,
    defaultGoalsForYear
  );

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
  const yearContext = useMemo(() => createYearContext(currentYear), [currentYear]);
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
          currentDistance={currentValue}
          unit={metricUnit}
          isLoading={isLoading || !!error}
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
            isLoading={isLoading || !!error}
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
                unit={metricUnit}
                sport={sport}
                onRetry={handleRetry}
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
                onRetry={handleRetry}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
