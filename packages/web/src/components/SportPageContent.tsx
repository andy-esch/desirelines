import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import CumulativeMetricsChart from "./charts/CumulativeMetricsChart";
import PacingMetricsChart from "./charts/PacingMetricsChart";
import MetricSelector from "./charts/MetricSelector";
import Sidebar from "./layout/Sidebar";
import FilterControls from "./layout/FilterControls";
import GoalControls from "./GoalControls";
import KPICards from "./dashboard/KPICards";
import GoalSummaryTable from "./GoalSummaryTable";
import EmptyState from "./EmptyState";
import type { Goals } from "../utils/goalCalculations";
import type { Goal } from "../utils/goalCalculations";
import type { MetricUnit } from "../utils/units";
import type { YearContext } from "../utils/yearContext";
import type { DistanceEntry } from "../types/activity";
import { getSportGradient } from "../constants/sportGradients";
import { usePublicSportConfig } from "../hooks/usePublicSportConfig";
import { getSportDisplayName } from "../utils/sportConfig";
import { DEMO_ROUTE_PREFIX } from "../constants/demoConfig";

export interface SportPageContentProps {
  // Core
  sport: string;
  currentYear: number;
  yearContext: YearContext;

  // Data
  chartData: DistanceEntry[];
  currentValue: number;
  estimatedYearEnd: number;
  isLoading: boolean;
  error: Error | null;
  onRetry?: (() => void) | undefined;

  // Units
  unit: MetricUnit;

  // Sport metrics
  /** Sport's primary metric — passed to GoalControls so newly-added goals
   * carry the right `metric` from creation. */
  primaryMetric: string;

  // Goals
  goals: Goals;
  /** Goals to pass to charts (pre-filtered: empty when not viewing primary metric) */
  chartGoals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  isGoalsSaving: boolean;
  goalsSaveError: Error | null;
  onClearGoalsSaveError?: (() => void) | undefined;

  // Goal stats (from useGoalStats)
  nextGoal: Goal | null;
  nextGoalProgress: number;
  nextGoalGap: number;
  paceNeededForNextGoal: number;

  // Pace & momentum
  averagePace: number;
  momentumIndicator: ReactNode;

  // Sidebar
  availableSports: string[];
  sportCounts: Record<string, number>;
  showAuthButton?: boolean | undefined;

  // Navigation
  onSportChange: (sport: string) => void;
  onYearChange: (year: number) => void;
  /** Route prefix for links: "" for authenticated, "/demo" for demo */
  routePrefix: string;

  // Metric selector (optional — omit for demo / single-metric sports)
  availableMetrics?: string[] | undefined;
  activeMetric?: string | undefined;
  onMetricChange?: ((metric: string) => void) | undefined;

  // Prior years (optional — omit for demo)
  priorYearData?: Record<number, DistanceEntry[]> | undefined;
  showPriorYears?: boolean | undefined;
  onPriorYearsChange?: ((show: boolean) => void) | undefined;
}

export default function SportPageContent({
  sport,
  currentYear,
  yearContext,
  chartData,
  currentValue,
  estimatedYearEnd,
  isLoading,
  error,
  onRetry,
  unit,
  primaryMetric,
  goals,
  chartGoals,
  onGoalsChange,
  isGoalsSaving,
  goalsSaveError,
  onClearGoalsSaveError,
  nextGoal,
  nextGoalProgress,
  nextGoalGap,
  paceNeededForNextGoal,
  averagePace,
  momentumIndicator,
  availableSports,
  sportCounts,
  showAuthButton,
  onSportChange,
  onYearChange,
  routePrefix,
  availableMetrics,
  activeMetric,
  onMetricChange,
  priorYearData,
  showPriorYears,
  onPriorYearsChange,
}: SportPageContentProps) {
  const [showFullYear, setShowFullYear] = useState(true);
  const [showAchievements, setShowAchievements] = useState(true);

  // Honor the configured displayName (e.g. "E-Bike", "Water Sports") rather
  // than a raw capitalization of the sport key. Shares the React Query cache
  // slot with useSportConfig, so this is free for the authenticated path too.
  const { sportConfig } = usePublicSportConfig();
  const sportDisplayName = getSportDisplayName(sport, sportConfig);

  const isCurrentYear = yearContext.isCurrentYear;
  // Note: error state is shown in the chart area (which receives `error` separately).
  // Other components receive `isLoading` only so they show default values on error,
  // not misleading loading spinners.

  return (
    <div
      className="overflow-x-hidden px-4 md:pl-0 md:pr-6"
      style={{ background: getSportGradient(sport) }}
    >
      <div className="flex">
        <Sidebar
          estimatedYearEnd={estimatedYearEnd}
          currentValue={currentValue}
          unit={unit}
          isLoading={isLoading}
          showAuthButton={showAuthButton}
          filtersSlot={
            <FilterControls
              sport={sport}
              availableSports={availableSports}
              sportCounts={sportCounts}
              onSportChange={onSportChange}
              currentYear={currentYear}
              onYearChange={onYearChange}
            />
          }
          goalsSlot={
            <GoalControls
              goals={goals}
              onGoalsChange={onGoalsChange}
              estimatedYearEnd={estimatedYearEnd}
              unit={unit}
              sport={sport}
              primaryMetric={primaryMetric}
              isSaving={isGoalsSaving}
              saveError={goalsSaveError}
              onClearSaveError={onClearGoalsSaveError}
            />
          }
        />

        <div className="grow min-w-0 md:pl-4">
          <div className="flex justify-between flex-wrap md:flex-nowrap items-center pt-6 pb-2 mb-3">
            <h1 className="h2 font-display">
              {sportDisplayName} {currentYear}
            </h1>
          </div>

          {/* No data banner - show when viewing current year with no activities */}
          {!isLoading && currentValue === 0 && isCurrentYear && (
            <div
              className="alert flex items-center mb-6"
              role="alert"
              style={{
                backgroundColor: "var(--color-accent-cyan-glow)",
                border: "1px solid var(--color-accent-cyan-glow)",
                color: "var(--color-slate-light)",
              }}
            >
              <span>
                No {sportDisplayName} activities recorded for {currentYear}.{" "}
                {routePrefix === DEMO_ROUTE_PREFIX ? (
                  <Link
                    to="/demo/$sport/$year"
                    params={{ sport, year: String(currentYear - 1) }}
                    style={{ color: "var(--color-accent-cyan)" }}
                  >
                    View {currentYear - 1} instead →
                  </Link>
                ) : (
                  <Link
                    to="/$sport/$year"
                    params={{ sport, year: String(currentYear - 1) }}
                    style={{ color: "var(--color-accent-cyan)" }}
                  >
                    View {currentYear - 1} instead →
                  </Link>
                )}
              </span>
            </div>
          )}

          <KPICards
            currentValue={currentValue}
            nextGoal={nextGoal}
            nextGoalProgress={nextGoalProgress}
            nextGoalGap={nextGoalGap}
            paceNeededForNextGoal={paceNeededForNextGoal}
            averagePace={averagePace}
            momentumIndicator={momentumIndicator}
            yearContext={yearContext}
            unit={unit}
            metric={activeMetric}
            isLoading={isLoading}
          />

          {!isLoading && !error && chartData.length === 0 ? (
            <EmptyState
              sport={sport}
              year={currentYear}
              unit={unit}
              suggestedYear={isCurrentYear ? currentYear - 1 : undefined}
              linkPrefix={routePrefix}
            />
          ) : (
            <GoalSummaryTable
              goals={goals}
              currentValue={currentValue}
              yearContext={yearContext}
              unit={unit}
              sport={sport}
              isLoading={isLoading}
            />
          )}

          {/* Metric Selector - only show when multiple metrics available */}
          {availableMetrics && availableMetrics.length > 1 && activeMetric && onMetricChange && (
            <div className="flex justify-end items-center mb-4">
              <MetricSelector
                availableMetrics={availableMetrics}
                selectedMetric={activeMetric}
                onMetricChange={onMetricChange}
              />
            </div>
          )}

          <div className="mb-10">
            <div className="glass-panel">
              <CumulativeMetricsChart
                year={currentYear}
                goals={chartGoals}
                distanceData={chartData}
                isLoading={isLoading}
                error={error}
                showFullYear={showFullYear}
                onViewChange={setShowFullYear}
                showAchievements={showAchievements}
                onAchievementsChange={setShowAchievements}
                unit={unit}
                metric={activeMetric}
                sport={sport}
                onRetry={onRetry}
                priorYearData={priorYearData}
                showPriorYears={showPriorYears}
                onPriorYearsChange={onPriorYearsChange}
              />
            </div>
          </div>

          <div className="mb-12">
            <div className="glass-panel">
              <PacingMetricsChart
                year={currentYear}
                goals={chartGoals}
                distanceData={chartData}
                isLoading={isLoading}
                error={error}
                showFullYear={showFullYear}
                unit={unit}
                metric={activeMetric}
                sport={sport}
                onRetry={onRetry}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
