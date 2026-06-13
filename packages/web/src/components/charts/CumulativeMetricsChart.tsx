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
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { DistanceEntry } from "../../types/activity";
import { type Goals } from "../../utils/goalCalculations";
import { getMetricUnitLabel, isSessionsUnit, type MetricUnit } from "../../utils/units";
import { getMetricDisplayLabel } from "../../config/metricConfig";
import { useCumulativeChartData } from "../../hooks/useCumulativeChartData";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import ChartContainer from "./ChartContainer";
import CumulativeChartPresenter from "./CumulativeChartPresenter";

// ============================================================================
// Helpers
// ============================================================================

/** Derive the "Cumulative ___" chart title from the metric ID, with unit-based fallback. */
function getCumulativeChartTitle(metric: string | undefined, unit: MetricUnit): string {
  if (metric === "activities" || unit === "sessions") return "Cumulative Sessions";
  if (metric) return `Cumulative ${getMetricDisplayLabel(metric)}`;
  if (unit === "hours" || unit === "minutes") return "Cumulative Time";
  return "Cumulative Distance";
}

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
  showFullYear?: boolean | undefined;
  /** Callback when view toggle changes */
  onViewChange?: ((showFullYear: boolean) => void) | undefined;
  /** Whether to show achievement markers */
  showAchievements?: boolean | undefined;
  /** Callback when achievement toggle changes */
  onAchievementsChange?: ((show: boolean) => void) | undefined;
  /** Hide the header section */
  hideHeader?: boolean | undefined;
  /** Unit for display (miles, kilometers, sessions) */
  unit?: MetricUnit | undefined;
  /** Active metric ID (e.g., "distance_meters", "time_minutes"). Drives chart title. */
  metric?: string | undefined;
  /** Sport type for empty state messaging */
  sport?: string | undefined;
  /** Callback for retry on error */
  onRetry?: (() => void) | undefined;
  /** Prior year chart data keyed by year */
  priorYearData?: Record<number, DistanceEntry[]> | undefined;
  /** Whether prior year ghost lines are visible */
  showPriorYears?: boolean | undefined;
  /** Callback when prior years toggle changes */
  onPriorYearsChange?: ((show: boolean) => void) | undefined;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Header controls for the chart (view toggle, achievement toggle).
 * Extracted to keep the main component clean.
 */
type RangePreset = "7d" | "30d" | "month" | "ytd" | "full";

function HeaderControls({
  activeRange,
  onRangeChange,
  showAchievements,
  onAchievementsChange,
  achievementCount,
  isZoomed,
  onResetZoom,
  showPriorYears,
  onPriorYearsChange,
}: {
  activeRange: RangePreset;
  onRangeChange: (preset: RangePreset) => void;
  showAchievements: boolean;
  onAchievementsChange?: ((show: boolean) => void) | undefined;
  achievementCount: number;
  isZoomed: boolean;
  onResetZoom: () => void;
  showPriorYears?: boolean | undefined;
  onPriorYearsChange?: ((show: boolean) => void) | undefined;
}) {
  const presets: { key: RangePreset; label: string }[] = [
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "month", label: "This Month" },
    { key: "ytd", label: "YTD" },
    { key: "full", label: "Full Year" },
  ];

  return (
    <>
      {/* Unified range selector */}
      <div className="btn-group btn-group-sm" role="group">
        {presets.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`btn ${activeRange === key && !isZoomed ? "btn-secondary" : "btn-outline-secondary"}`}
            onClick={() => onRangeChange(key)}
          >
            {label}
          </button>
        ))}
        {isZoomed && (
          <button type="button" className="btn btn-outline-warning" onClick={onResetZoom}>
            Reset
          </button>
        )}
      </div>

      {/* Achievement toggle */}
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

      {/* Prior years toggle */}
      {onPriorYearsChange && (
        <button
          type="button"
          className={`btn btn-sm ${showPriorYears ? "btn-outline-info" : "btn-outline-secondary"}`}
          onClick={() => onPriorYearsChange(!showPriorYears)}
          title={showPriorYears ? "Hide prior year lines" : "Show prior year lines"}
        >
          Prior Years
        </button>
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
    metric,
    sport,
    onRetry,
    priorYearData,
    showPriorYears = false,
    onPriorYearsChange,
  } = props;

  // Only animate chart lines on first mount — suppress re-animation on goal/range changes.
  // Both lint-clean alternatives have tradeoffs: a ref read during render trips
  // `react-hooks/refs` (purity), and dropping the gate makes Recharts re-animate
  // every prop change. The set-state-in-effect cost (one extra render at mount)
  // is acceptable here.
  const [isFirstRender, setIsFirstRender] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount-only gate for Recharts animation
    setIsFirstRender(false);
  }, []);

  // Respect OS-level reduced motion preference
  const reducedMotion = useReducedMotion();

  // Active range preset — drives which button is highlighted and x-axis domain
  const [activeRange, setActiveRange] = useState<RangePreset>(showFullYear ? "full" : "ytd");
  // When user drags to zoom, we set a custom domain and clear the active preset
  const [dragZoomDomain, setDragZoomDomain] = useState<{ start: number; end: number } | null>(null);
  const isDragZoomed = dragZoomDomain !== null;

  // Drag selection state (ephemeral, only during mouse drag)
  const [selectionLeft, setSelectionLeft] = useState<number | undefined>(undefined);
  const [selectionRight, setSelectionRight] = useState<number | undefined>(undefined);
  const dragAnchor = useRef<number | undefined>(undefined);

  // Derive display values
  const isSessionsMode = isSessionsUnit(unit);
  const chartTitle = getCumulativeChartTitle(metric, unit);
  const unitLabel = getMetricUnitLabel(unit);

  // Get chart data from hook
  const {
    totalDistanceTraveled,
    estimatedYearEnd,
    startDate,
    goalLines,
    goalAchievements,
    mergedData,
    currentValues,
    yAxisTicks,
    priorYearLines,
    shouldShowDangerZone,
    dangerThreshold,
  } = useCumulativeChartData({
    year,
    goals,
    distanceData,
    showFullYear: true, // Always generate full year data so goal projections extend; x-axis domain handles visual clipping
    sport,
    priorYearData: showPriorYears ? priorYearData : undefined,
  });

  // Drag-to-zoom handlers
  const handleChartMouseDown = useCallback((e: { activeLabel?: string | number }) => {
    if (e.activeLabel != null) {
      const ts = Number(e.activeLabel);
      dragAnchor.current = ts;
      setSelectionLeft(ts);
      setSelectionRight(ts);
    }
  }, []);

  const handleChartMouseMove = useCallback((e: { activeLabel?: string | number }) => {
    if (dragAnchor.current != null && e.activeLabel != null) {
      setSelectionRight(Number(e.activeLabel));
    }
  }, []);

  const handleChartMouseUp = useCallback(() => {
    if (dragAnchor.current != null && selectionLeft != null && selectionRight != null) {
      const left = Math.min(selectionLeft, selectionRight);
      const right = Math.max(selectionLeft, selectionRight);
      if (right - left > 0) {
        setDragZoomDomain({ start: left, end: right });
      }
    }
    dragAnchor.current = undefined;
    setSelectionLeft(undefined);
    setSelectionRight(undefined);
  }, [selectionLeft, selectionRight]);

  const resetDragZoom = useCallback(() => {
    setDragZoomDomain(null);
  }, []);

  // Range preset handler — computes domain relative to available data
  const handleRangeChange = useCallback(
    (preset: RangePreset) => {
      setActiveRange(preset);
      setDragZoomDomain(null); // Clear any drag zoom
      // ytd/full are handled via showFullYear in the hook, not zoom domain
      if (preset === "ytd") {
        onViewChange?.(false);
      } else if (preset === "full") {
        onViewChange?.(true);
      }
    },
    [onViewChange]
  );

  // Compute effective x-axis domain
  // All dates use UTC to match the hook's Date.UTC() convention
  const today = new Date();
  const isCurrentYear = today.getUTCFullYear() === year;
  const anchorYear = isCurrentYear ? today.getUTCFullYear() : year;
  const anchorMonth = isCurrentYear ? today.getUTCMonth() : 11;
  const anchorDay = isCurrentYear ? today.getUTCDate() : 31;

  const effectiveDomain = (() => {
    if (isDragZoomed) {
      return { start: new Date(dragZoomDomain.start), end: new Date(dragZoomDomain.end) };
    }
    if (activeRange === "7d" || activeRange === "30d" || activeRange === "month") {
      let startTs: number;
      let endTs: number;
      if (activeRange === "7d") {
        endTs = Date.UTC(anchorYear, anchorMonth, anchorDay);
        startTs = Date.UTC(anchorYear, anchorMonth, anchorDay - 7);
      } else if (activeRange === "30d") {
        endTs = Date.UTC(anchorYear, anchorMonth, anchorDay);
        startTs = Date.UTC(anchorYear, anchorMonth, anchorDay - 30);
      } else {
        // Full calendar month: 1st to last day of current month
        startTs = Date.UTC(anchorYear, anchorMonth, 1);
        endTs = Date.UTC(anchorYear, anchorMonth + 1, 0);
      }
      // Clamp start to year boundary
      const yearStartTs = Date.UTC(year, 0, 1);
      if (startTs < yearStartTs) {
        startTs = yearStartTs;
      }
      return { start: new Date(startTs), end: new Date(endTs) };
    }
    if (activeRange === "ytd") {
      return { start: startDate, end: new Date(Date.UTC(anchorYear, anchorMonth, anchorDay)) };
    }
    // "full" — full year
    return { start: startDate, end: new Date(Date.UTC(year, 11, 31)) };
  })();

  // Filter mergedData to visible x-axis range so y-axis auto-scales to visible data
  const visibleData = useMemo(() => {
    const startTs = effectiveDomain.start.getTime();
    const endTs = effectiveDomain.end.getTime();
    return mergedData.filter((d) => {
      const ts = d.date.getTime();
      return ts >= startTs && ts <= endTs;
    });
  }, [mergedData, effectiveDomain.start, effectiveDomain.end]);

  // Build header controls
  const headerControls = (
    <HeaderControls
      activeRange={activeRange}
      onRangeChange={handleRangeChange}
      showAchievements={showAchievements}
      onAchievementsChange={onAchievementsChange}
      achievementCount={goalAchievements.length}
      isZoomed={isDragZoomed}
      onResetZoom={resetDragZoom}
      showPriorYears={showPriorYears}
      onPriorYearsChange={onPriorYearsChange}
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
        mergedData={visibleData}
        goalLines={goalLines}
        goalAchievements={goalAchievements}
        currentValues={currentValues}
        startDate={effectiveDomain.start}
        displayEndDate={effectiveDomain.end}
        yAxisTicks={yAxisTicks}
        year={year}
        unitLabel={unitLabel}
        totalDistanceTraveled={totalDistanceTraveled}
        estimatedYearEnd={estimatedYearEnd}
        isSessionsMode={isSessionsMode}
        showAchievements={showAchievements}
        isAnimationActive={isFirstRender && !reducedMotion}
        isZoomed={isDragZoomed || activeRange !== "full"}
        selectionLeft={selectionLeft}
        selectionRight={selectionRight}
        onChartMouseDown={handleChartMouseDown}
        onChartMouseMove={handleChartMouseMove}
        onChartMouseUp={handleChartMouseUp}
        priorYearLines={priorYearLines}
        dangerZone={{
          show: shouldShowDangerZone,
          threshold: dangerThreshold,
        }}
      />
    </ChartContainer>
  );
};

export default CumulativeMetricsChart;
