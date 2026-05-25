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
import { useState, useEffect } from "react";
import type { DistanceEntry } from "../../types/activity";
import { type Goals } from "../../utils/goalCalculations";
import { getMetricUnitLabel, isSessionsUnit, type MetricUnit } from "../../utils/units";
import { getMetricDisplayLabel } from "../../config/metricConfig";
import { usePacingChartData } from "../../hooks/usePacingChartData";
import { useReducedMotion } from "../../hooks/useReducedMotion";
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
  showFullYear?: boolean | undefined;
  /** Hide the header section */
  hideHeader?: boolean | undefined;
  /** Unit for display (miles, kilometers, sessions) */
  unit?: MetricUnit | undefined;
  /** Active metric ID (e.g., "distance_meters", "time_minutes"). Drives chart title. */
  metric?: string | undefined;
  /** Sport type for empty state and danger zone threshold */
  sport?: string | undefined;
  /** Callback for retry on error */
  onRetry?: (() => void) | undefined;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive the pacing chart title from the metric ID, with unit-based fallback.
 * "Daily Pace" reads naturally for distance, but for time/sessions we want the
 * label to match the underlying metric.
 */
function getPacingChartTitle(
  metric: string | undefined,
  unit: MetricUnit,
  unitLabel: string
): string {
  if (metric === "activities" || unit === "sessions") return "Daily Activity (sessions / day)";
  if (metric === "time_minutes" || unit === "hours" || unit === "minutes") {
    return `Daily Time (${unitLabel} / day)`;
  }
  if (metric) return `Daily ${getMetricDisplayLabel(metric)} (${unitLabel} / day)`;
  return `Daily Pace (${unitLabel} / day)`;
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
    metric,
    sport = "cycling",
    onRetry,
  } = props;

  const reducedMotion = useReducedMotion();

  // Only animate chart lines on first mount — suppress re-animation on prop changes.
  // This one-time gate is intentional: the effect sets false after mount to prevent
  // Recharts from re-animating lines when goals or range presets change.
  const [isFirstRender, setIsFirstRender] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount animation gate
    setIsFirstRender(false);
  }, []);

  // Derive display values
  const isSessionsMode = isSessionsUnit(unit);
  const unitLabel = getMetricUnitLabel(unit);
  const chartTitle = getPacingChartTitle(metric, unit, unitLabel);

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
        isAnimationActive={isFirstRender && !reducedMotion}
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
