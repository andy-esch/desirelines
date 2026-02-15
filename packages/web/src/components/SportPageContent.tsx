import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
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
  onRetry?: () => void;

  // Units
  unit: MetricUnit;

  // Goals
  goals: Goals;
  /** Goals to pass to charts (pre-filtered: empty when not viewing primary metric) */
  chartGoals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  isGoalsSaving: boolean;
  goalsSaveError: Error | null;
  onClearGoalsSaveError?: () => void;

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
  showAuthButton?: boolean;

  // Navigation
  onSportChange: (sport: string) => void;
  onYearChange: (year: number) => void;
  /** Route prefix for links: "" for authenticated, "/demo" for demo */
  routePrefix: string;

  // Metric selector (optional — omit for demo / single-metric sports)
  availableMetrics?: string[];
  activeMetric?: string;
  onMetricChange?: (metric: string) => void;
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
}: SportPageContentProps) {
  const [showFullYear, setShowFullYear] = useState(true);
  const [showAchievements, setShowAchievements] = useState(true);

  const isCurrentYear = yearContext.isCurrentYear;
  // Note: error state is shown in the chart area (which receives `error` separately).
  // Other components receive `isLoading` only so they show default values on error,
  // not misleading loading spinners.

  return (
    <div className="px-3">
      <div className="flex page-bg-sport">
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
              isSaving={isGoalsSaving}
              saveError={goalsSaveError}
              onClearSaveError={onClearGoalsSaveError}
            />
          }
        />

        <div className="grow md:pl-4">
          <div className="flex justify-between flex-wrap md:flex-nowrap items-center pt-6 pb-2 mb-3">
            <h1 className="h2 font-display">
              {sport.charAt(0).toUpperCase() + sport.slice(1)} {currentYear}
            </h1>
          </div>

          {/* No data banner - show when viewing current year with no activities */}
          {!isLoading && currentValue === 0 && isCurrentYear && (
            <div
              className="alert flex items-center mb-6"
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
                  to={`${routePrefix}/${sport}/${currentYear - 1}`}
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
            unit={unit}
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
              currentDistance={currentValue}
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
                sport={sport}
                onRetry={onRetry}
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
