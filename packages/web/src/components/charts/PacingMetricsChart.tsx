/**
 * PacingMetricsChart - Container component for daily pacing charts.
 *
 * This is a "smart" container that:
 * - Fetches and transforms data via usePacingChartData hook
 * - Handles loading/error/empty states via ChartContainer
 * - Delegates rendering to PacingChartPresenter
 *
 * Architecture: Container/Presenter pattern
 * - Container (this file): Data, state, callbacks
 * - Presenter (PacingChartPresenter): Pure rendering
 */
import { useRef, useEffect } from "react";
import type { DistanceEntry } from "../../types/activity";
import { type Goals } from "../../utils/goalCalculations";
import { getMetricUnitLabel, type MetricUnit } from "../../utils/units";
import { usePacingChartData } from "../../hooks/usePacingChartData";
import ChartContainer from "./ChartContainer";
import PacingChartPresenter from "./PacingChartPresenter";

// ============================================================================
// Types
// ============================================================================

interface PacingMetricsChartProps {
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
  /** Hide the header section */
  hideHeader?: boolean;
  /** Unit for display (miles, kilometers, sessions) */
  unit?: MetricUnit;
  /** Sport type for empty state and danger zone threshold */
  sport?: string;
  /** Callback for retry on error */
  onRetry?: () => void;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Container component for daily pacing charts.
 *
 * Shows the required daily pace to achieve goals, with a "danger zone"
 * indicating when the required pace becomes unrealistic.
 *
 * @example
 * ```tsx
 * <PacingMetricsChart
 *   year={2024}
 *   goals={userGoals}
 *   distanceData={activityData}
 *   isLoading={isLoading}
 *   error={error}
 *   showFullYear={true}
 *   unit="miles"
 *   sport="cycling"
 * />
 * ```
 */
const PacingMetricsChart = (props: PacingMetricsChartProps) => {
  const {
    year,
    goals,
    distanceData,
    isLoading,
    error,
    showFullYear = true,
    hideHeader = false,
    unit = "miles",
    sport = "cycling",
    onRetry,
  } = props;

  // Only animate chart lines on first mount — suppress re-animation on prop changes
  const isFirstRender = useRef(true);
  useEffect(() => {
    isFirstRender.current = false;
  }, []);

  // Derive display values
  const isSessionsMode = unit === "sessions";
  const unitLabel = getMetricUnitLabel(unit);
  const chartTitle = isSessionsMode
    ? "Daily Activity (sessions / day)"
    : `Daily Pace (${unitLabel} / day)`;

  // Get chart data from hook
  const {
    startDate,
    displayEndDate,
    pacingGoals,
    mergedData,
    currentValues,
    dangerThreshold,
    naturalYMax,
    shouldShowDangerZone,
  } = usePacingChartData({
    year,
    goals,
    distanceData,
    showFullYear,
    sport,
  });

  return (
    <ChartContainer
      title={chartTitle}
      isLoading={isLoading}
      error={error}
      isEmpty={distanceData.length === 0}
      hideHeader={hideHeader}
      onRetry={onRetry}
      emptyStateConfig={{ sport, year, unit, message: "No pacing data available" }}
      className={hideHeader ? "" : "mt-6"}
    >
      <PacingChartPresenter
        mergedData={mergedData}
        pacingGoals={pacingGoals}
        currentValues={currentValues}
        startDate={startDate}
        displayEndDate={displayEndDate}
        naturalYMax={naturalYMax}
        year={year}
        unitLabel={unitLabel}
        isSessionsMode={isSessionsMode}
        isAnimationActive={isFirstRender.current}
        dangerZone={{
          show: shouldShowDangerZone,
          threshold: dangerThreshold,
          yMax: naturalYMax,
        }}
      />
    </ChartContainer>
  );
};

export default PacingMetricsChart;
