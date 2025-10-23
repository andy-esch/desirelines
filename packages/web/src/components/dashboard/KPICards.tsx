import React from "react";
import KPICard from "./KPICard";

export interface KPICardsProps {
  /** Current total distance */
  currentDistance: number;
  /** Average pace (miles per day) */
  averagePace: number;
  /** Days elapsed in the year */
  daysElapsed: number;
  /** Days remaining in the year */
  daysRemaining: number;
  /** Next goal information */
  nextGoal: {
    label?: string;
    value: number;
  } | null;
  /** Progress towards next goal (0-100%) */
  nextGoalProgress: number;
  /** Gap to next goal in miles */
  nextGoalGap: number;
  /** Pace needed to reach next goal */
  paceNeededForNextGoal: number;
  /** Optional momentum indicator component */
  momentumIndicator?: React.ReactNode;
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
    daysElapsed,
    daysRemaining,
    nextGoal,
    nextGoalProgress,
    nextGoalGap,
    paceNeededForNextGoal,
    momentumIndicator,
  }: KPICardsProps) => {
    return (
      <div className="row g-3 mb-4">
        {/* Current Distance Card */}
        <KPICard
          title="Current Distance"
          value={`${currentDistance.toFixed(0)} mi`}
          subtitle={
            <>
              {averagePace.toFixed(1)} mi/day avg
              {momentumIndicator && <>{momentumIndicator} · </>}
              {daysElapsed} days
            </>
          }
        />

        {/* Next Goal Card */}
        <KPICard
          title={nextGoal?.label || "Next Goal"}
          value={`${nextGoalProgress.toFixed(0)}%`}
          subtitle={
            nextGoalGap > 0
              ? `${nextGoalGap.toFixed(0)} mi to ${nextGoal?.value.toLocaleString()}`
              : nextGoal
                ? `${nextGoal.value.toLocaleString()} mi reached!`
                : "No goal set"
          }
        />

        {/* Pace to Goal Card */}
        <KPICard
          title={`Pace to ${nextGoal?.label || "Goal"}`}
          value={paceNeededForNextGoal > 0 ? paceNeededForNextGoal.toFixed(1) : "—"}
          subtitle={
            paceNeededForNextGoal > 0
              ? `mi/day · ${daysRemaining} days left`
              : `${daysRemaining} days remaining`
          }
        />
      </div>
    );
  }
);

KPICards.displayName = "KPICards";

export default KPICards;
