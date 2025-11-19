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
const KPICards = React.memo(
  ({
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
  }: KPICardsProps) => {
    // Determine appropriate title based on unit
    const metricTitle = unit === "sessions" ? "Current # Sessions" : "Current Distance";

    return (
      <div className="row g-3 mb-4">
        {/* Current Distance/Sessions Card */}
        <KPICard
          title={metricTitle}
          value={
            isLoading
              ? "--"
              : currentDistance === 0
                ? "--"
                : `${currentDistance.toFixed(0)} ${unit}`
          }
          subtitle={
            isLoading ? (
              "Loading..."
            ) : currentDistance === 0 ? (
              <>
                {yearContext.isPastYear
                  ? `${yearContext.year} complete · No data available`
                  : `${yearContext.daysElapsed} days elapsed · No data available`}
              </>
            ) : (
              <>
                {averagePace.toFixed(1)} {unit} / day avg ·{" "}
                {momentumIndicator && <>{momentumIndicator} · </>}
                {yearContext.isPastYear
                  ? `${yearContext.year} complete`
                  : `${yearContext.daysElapsed} days elapsed`}
              </>
            )
          }
        />

        {/* Next Goal Card */}
        <KPICard
          title={nextGoal?.label || "Next Goal"}
          value={
            isLoading ? "--" : currentDistance === 0 ? "--" : `${nextGoalProgress.toFixed(0)}%`
          }
          subtitle={
            isLoading
              ? "Loading..."
              : currentDistance === 0
                ? "No data available"
                : nextGoalGap > 0
                  ? `${nextGoalGap.toFixed(0)} ${unit} to ${nextGoal?.value.toLocaleString()}`
                  : nextGoal
                    ? `${nextGoal.value.toLocaleString()} ${unit} reached!`
                    : "No goal set"
          }
        />

        {/* Pace to Goal Card */}
        <KPICard
          title={`Pace to ${nextGoal?.label || "Goal"}`}
          value={
            isLoading
              ? "--"
              : yearContext.shouldShowPacing && paceNeededForNextGoal > 0
                ? paceNeededForNextGoal.toFixed(1)
                : "—"
          }
          subtitle={
            isLoading
              ? "Loading..."
              : yearContext.isPastYear
                ? `Historical data`
                : yearContext.isFutureYear
                  ? `Future year`
                  : paceNeededForNextGoal > 0
                    ? `${unit} / day · ${yearContext.daysRemaining} days left`
                    : `${yearContext.daysRemaining} days remaining`
          }
        />
      </div>
    );
  }
);

KPICards.displayName = "KPICards";

export default KPICards;
