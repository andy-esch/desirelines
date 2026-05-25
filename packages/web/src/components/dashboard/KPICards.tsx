import React from "react";
import KPICard from "./KPICard";
import type { MetricUnit } from "../../utils/units";
import type { YearContext } from "../../utils/yearContext";
import { getMetricDisplayLabel } from "../../config/metricConfig";

export interface KPICardsProps {
  /** Current total distance or count */
  currentDistance: number;
  /** Average pace (miles per day or sessions per day) */
  averagePace: number;
  /** Year context (current/past/future year state) */
  yearContext: YearContext;
  /** Next goal information */
  nextGoal: {
    label?: string;
    value: number;
  } | null;
  /** Progress towards next goal (0-100%) */
  nextGoalProgress: number;
  /** Gap to next goal */
  nextGoalGap: number;
  /** Pace needed to reach next goal */
  paceNeededForNextGoal: number;
  /** Optional momentum indicator component */
  momentumIndicator?: React.ReactNode;
  /** Unit label (e.g., "mi", "km", "sessions") */
  unit?: MetricUnit;
  /** Active metric ID (e.g., "distance_meters", "time_minutes"). Drives title text. */
  metric?: string | undefined;
  /** Whether data is still loading */
  isLoading?: boolean;
}

/** Derive the "Current ___" card title from the metric ID, with unit-based fallback. */
function getCurrentMetricTitle(metric: string | undefined, unit: MetricUnit): string {
  if (metric === "activities" || unit === "sessions") return "Current # Sessions";
  if (metric) return `Current ${getMetricDisplayLabel(metric)}`;
  if (unit === "hours" || unit === "minutes") return "Current Time";
  return "Current Distance";
}

/**
 * Dashboard KPI cards displaying key training metrics
 *
 * Displays three cards in a row:
 * 1. Current Distance - Total miles with average pace and momentum
 * 2. Next Goal - Progress percentage and remaining distance
 * 3. Pace to Goal - Required daily pace to reach goal
 *
 * @example
 * <KPICards
 *   currentDistance={2450}
 *   averagePace={8.3}
 *   daysElapsed={295}
 *   daysRemaining={70}
 *   nextGoal={{ label: "Challenger", value: 3000 }}
 *   nextGoalProgress={81.7}
 *   nextGoalGap={550}
 *   paceNeededForNextGoal={7.9}
 *   momentumIndicator={<MomentumIndicator />}
 * />
 */
function KPICards({
  currentDistance,
  averagePace,
  yearContext,
  nextGoal,
  nextGoalProgress,
  nextGoalGap,
  paceNeededForNextGoal,
  momentumIndicator,
  unit = "miles", // Default to miles
  metric,
  isLoading = false,
}: KPICardsProps) {
  const metricTitle = getCurrentMetricTitle(metric, unit);
  const hasData = !isLoading && currentDistance > 0;

  // Helper functions for cleaner rendering — all branch on `hasData` first
  // to separate loading/empty state from data display logic.
  const getCurrentDistanceValue = () => {
    if (!hasData) return "--";
    return (
      <>
        {currentDistance.toFixed(0)} <span className="text-lg">{unit}</span>
      </>
    );
  };

  const getCurrentDistanceSubtitle = () => {
    if (isLoading) return "Loading...";

    if (!hasData) {
      const yearStatus = yearContext.isPastYear
        ? `${yearContext.year} complete · No data available`
        : `${yearContext.daysElapsed} days elapsed · No data available`;
      return <>{yearStatus}</>;
    }

    const yearStatus = yearContext.isPastYear
      ? `${yearContext.year} complete`
      : `${yearContext.daysElapsed} days elapsed`;

    return (
      <>
        {averagePace.toFixed(1)} {unit} / day avg ·{" "}
        {momentumIndicator && <>{momentumIndicator} · </>}
        {yearStatus}
      </>
    );
  };

  const getNextGoalValue = () => {
    if (!hasData) return "--";
    return `${nextGoalProgress.toFixed(0)}%`;
  };

  const getNextGoalSubtitle = () => {
    if (isLoading) return "Loading...";
    if (!hasData) return "No data available";

    if (nextGoalGap > 0) {
      return `${nextGoalGap.toFixed(0)} ${unit} to ${nextGoal?.value.toLocaleString()}`;
    }

    if (nextGoal) {
      return `${nextGoal.value.toLocaleString()} ${unit} reached!`;
    }

    return "No goal set";
  };

  const getPaceToGoalValue = () => {
    if (!hasData) return "--";
    if (yearContext.shouldShowPacing && paceNeededForNextGoal > 0) {
      return paceNeededForNextGoal.toFixed(1);
    }
    return "—";
  };

  const getPaceToGoalSubtitle = () => {
    if (isLoading) return "Loading...";
    if (yearContext.isPastYear) return "Historical data";
    if (yearContext.isFutureYear) return "Future year";

    if (paceNeededForNextGoal > 0) {
      return `${unit} / day · ${yearContext.daysRemaining} days left`;
    }

    return `${yearContext.daysRemaining} days remaining`;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8">
      {/* Current Distance/Sessions Card */}
      <KPICard
        title={metricTitle}
        value={getCurrentDistanceValue()}
        subtitle={getCurrentDistanceSubtitle()}
      />

      {/* Next Goal Card */}
      <KPICard
        title={nextGoal?.label || "Next Goal"}
        value={getNextGoalValue()}
        subtitle={getNextGoalSubtitle()}
      />

      {/* Pace to Goal Card — full width on mobile */}
      <div className="col-span-2 md:col-span-1">
        <KPICard
          title={`Pace to ${nextGoal?.label || "Goal"}`}
          value={getPaceToGoalValue()}
          subtitle={getPaceToGoalSubtitle()}
        />
      </div>
    </div>
  );
}

export default KPICards;
