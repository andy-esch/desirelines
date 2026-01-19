/**
 * CumulativeMetricsChart - Container component for cumulative distance/sessions charts.
 *
 * This is a "smart" container that:
 * - Fetches and transforms data via useCumulativeChartData hook
 * - Handles loading/error/empty states via ChartContainer
 * - Manages user interaction (view toggle, achievement toggle)
 * - Delegates rendering to CumulativeChartPresenter
 *
 * Architecture: Container/Presenter pattern
 * - Container (this file): Data, state, callbacks
 * - Presenter (CumulativeChartPresenter): Pure rendering
 */
import { memo } from "react";
import type { DistanceEntry } from "../../types/activity";
import { type Goals } from "../../utils/goalCalculations";
import { getMetricUnitLabel, type MetricUnit } from "../../utils/units";
import { useCumulativeChartData } from "../../hooks/useCumulativeChartData";
import ChartContainer from "./ChartContainer";
import CumulativeChartPresenter from "./CumulativeChartPresenter";

// ============================================================================
// Types
// ============================================================================

interface CumulativeMetricsChartProps {
  /** Year to display data for */
  year: number;
  /** User's distance goals */
  goals: Goals;
  /** Cumulative distance data points */
  distanceData: DistanceEntry[];
  /** Whether data is currently loading */
  isLoading: boolean;
  /** Error from data fetch, if any */
  error: Error | null;
  /** Whether to show full year or just up to latest data */
  showFullYear?: boolean;
  /** Callback when view toggle changes */
  onViewChange?: (showFullYear: boolean) => void;
  /** Whether to show achievement markers */
  showAchievements?: boolean;
  /** Callback when achievement toggle changes */
  onAchievementsChange?: (show: boolean) => void;
  /** Hide the header section */
  hideHeader?: boolean;
  /** Unit for display (miles, kilometers, sessions) */
  unit?: MetricUnit;
  /** Sport type for empty state messaging */
  sport?: string;
  /** Callback for retry on error */
  onRetry?: () => void;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Header controls for the chart (view toggle, achievement toggle).
 * Extracted to keep the main component clean.
 */
function HeaderControls({
  showFullYear,
  onViewChange,
  showAchievements,
  onAchievementsChange,
  achievementCount,
}: {
  showFullYear: boolean;
  onViewChange?: (showFullYear: boolean) => void;
  showAchievements: boolean;
  onAchievementsChange?: (show: boolean) => void;
  achievementCount: number;
}) {
  return (
    <>
      {/* Achievement toggle - only show if there are achievements and callback provided */}
      {onAchievementsChange && achievementCount > 0 && (
        <button
          type="button"
          className={`btn btn-sm ${showAchievements ? "btn-outline-warning" : "btn-outline-secondary"}`}
          onClick={() => onAchievementsChange(!showAchievements)}
          title={showAchievements ? "Hide achievement markers" : "Show achievement markers"}
        >
          {showAchievements ? "★" : "☆"} {achievementCount}
        </button>
      )}

      {/* View toggle - only show if callback provided */}
      {onViewChange && (
        <div className="btn-group btn-group-sm" role="group">
          <input
            type="radio"
            className="btn-check"
            name="chartView"
            id="viewCurrent"
            autoComplete="off"
            checked={!showFullYear}
            onChange={() => onViewChange(false)}
          />
          <label className="btn btn-outline-secondary" htmlFor="viewCurrent">
            Current
          </label>

          <input
            type="radio"
            className="btn-check"
            name="chartView"
            id="viewFullYear"
            autoComplete="off"
            checked={showFullYear}
            onChange={() => onViewChange(true)}
          />
          <label className="btn btn-outline-secondary" htmlFor="viewFullYear">
            Full Year
          </label>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Container component for cumulative distance/sessions charts.
 *
 * @example
 * ```tsx
 * <CumulativeMetricsChart
 *   year={2024}
 *   goals={userGoals}
 *   distanceData={activityData}
 *   isLoading={isLoading}
 *   error={error}
 *   showFullYear={true}
 *   onViewChange={setShowFullYear}
 *   unit="miles"
 * />
 * ```
 */
const CumulativeMetricsChart = (props: CumulativeMetricsChartProps) => {
  const {
    year,
    goals,
    distanceData,
    isLoading,
    error,
    showFullYear = true,
    onViewChange,
    showAchievements = true,
    onAchievementsChange,
    hideHeader = false,
    unit = "miles",
    sport,
    onRetry,
  } = props;

  // Derive display values
  const isSessionsMode = unit === "sessions";
  const chartTitle = isSessionsMode ? "Cumulative Sessions" : "Cumulative Distance";
  const unitLabel = getMetricUnitLabel(unit);

  // Get chart data from hook
  const {
    totalDistanceTraveled,
    estimatedYearEnd,
    startDate,
    displayEndDate,
    goalLines,
    goalAchievements,
    mergedData,
    currentValues,
    yAxisTicks,
  } = useCumulativeChartData({
    year,
    goals,
    distanceData,
    showFullYear,
    sport,
  });

  // Build header controls
  const headerControls = (
    <HeaderControls
      showFullYear={showFullYear}
      onViewChange={onViewChange}
      showAchievements={showAchievements}
      onAchievementsChange={onAchievementsChange}
      achievementCount={goalAchievements.length}
    />
  );

  return (
    <ChartContainer
      title={chartTitle}
      isLoading={isLoading}
      error={error}
      isEmpty={distanceData.length === 0}
      hideHeader={hideHeader}
      onRetry={onRetry}
      headerControls={headerControls}
      emptyStateConfig={{ sport, year, unit, message: "No chart data available" }}
      infoTooltip="Y-axis labels show where each line currently sits — your actual progress vs. where goal trajectories are today. This shows the 'race' between your progress and your goals."
    >
      <CumulativeChartPresenter
        mergedData={mergedData}
        goalLines={goalLines}
        goalAchievements={goalAchievements}
        currentValues={currentValues}
        startDate={startDate}
        displayEndDate={displayEndDate}
        yAxisTicks={yAxisTicks}
        year={year}
        unitLabel={unitLabel}
        totalDistanceTraveled={totalDistanceTraveled}
        estimatedYearEnd={estimatedYearEnd}
        isSessionsMode={isSessionsMode}
        showAchievements={showAchievements}
      />
    </ChartContainer>
  );
};

export default memo(CumulativeMetricsChart);
