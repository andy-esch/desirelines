import React from "react";
import KPICard from "./KPICard";
import type { MetricUnit } from "../../utils/units";
import type { YearContext } from "../../utils/yearContext";

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
  /** Whether data is still loading */
  isLoading?: boolean;
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
  isLoading = false,
}: KPICardsProps) {
  // Determine appropriate title based on unit
  const metricTitle = unit === "sessions" ? "Current # Sessions" : "Current Distance";
  const hasData = !isLoading && currentDistance > 0;

  // Helper functions for cleaner rendering
  const getCurrentDistanceValue = () => {
    if (isLoading || currentDistance === 0) return "--";
    return `${currentDistance.toFixed(0)} ${unit}`;
  };

  const getCurrentDistanceSubtitle = () => {
    if (isLoading) return "Loading...";

    if (currentDistance === 0) {
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
    if (currentDistance === 0) return "No data available";

    if (nextGoalGap > 0) {
      return `${nextGoalGap.toFixed(0)} ${unit} to ${nextGoal?.value.toLocaleString()}`;
    }

    if (nextGoal) {
      return `${nextGoal.value.toLocaleString()} ${unit} reached!`;
    }

    return "No goal set";
  };

  const getPaceToGoalValue = () => {
    if (isLoading) return "--";
    if (currentDistance === 0) return "—"; // No pace calculation when no data
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
