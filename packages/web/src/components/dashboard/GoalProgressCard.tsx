import { Link } from "react-router-dom";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { PACE_THRESHOLDS } from "../../utils/goalCalculations";
import { formatMetricDisplayValue } from "../../utils/units";
import type { YearContext } from "../../utils/yearContext";
import RaceTrack, { RaceTrackLegend } from "../RaceTrack";
import Skeleton from "../Skeleton";

/**
 * Per-sport goal progress visualization using race track metaphor.
 *
 * Shows two emoji markers racing along a horizontal track:
 * - Dragon (🐲) at your actual progress toward the annual goal
 * - Ghost (👻) at where you'd be if perfectly on pace
 *
 * When ahead of pace, the dragon leads the ghost.
 * When behind, the ghost leads.
 *
 * Features:
 * - Sport name links to detail pages
 * - Status text (Ahead/On Track/Behind) per sport
 * - Metric values below track (current / goal)
 * - Legend explaining the markers
 */
export default function GoalProgressCard() {
  const { sportData, yearContext, isLoading, error } = useDashboardGoalData();

  if (error) {
    return (
      <div className="glass-panel h-full">
        <div className="text-center text-slate-light py-6">
          <small>Unable to load goal progress</small>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel h-full">
      <div className="mb-2">
        <h6 className="h6 mb-0 text-slate-light">{yearContext.year} Goals</h6>
      </div>
      {isLoading ? (
        <div role="status" aria-label="Loading goal progress">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mb-2">
              <div className="flex justify-between items-center mb-1">
                <Skeleton width={70} height={14} dualTheme={1} />
                <Skeleton width={90} height={14} dualTheme={1} />
              </div>
              <Skeleton height={28} borderRadius={4} dualTheme={1} />
              <div className="mt-1">
                <Skeleton width={100} height={10} dualTheme={1} />
              </div>
            </div>
          ))}
        </div>
      ) : sportData.length === 0 ? (
        <div className="text-center text-slate-light py-6">
          <small>No sports configured</small>
        </div>
      ) : (
        <>
          {sportData.map((sport) => (
            <SportProgressRow key={sport.sport} sport={sport} yearContext={yearContext} />
          ))}

          {/* Legend */}
          <RaceTrackLegend className="pt-2 mt-1" showPace={yearContext.shouldShowPacing} />
        </>
      )}
    </div>
  );
}

interface SportProgressRowProps {
  sport: SportGoalData;
  yearContext: YearContext;
}

function SportProgressRow({ sport, yearContext }: SportProgressRowProps) {
  // Calculate positions as percentages
  const youPosition = sport.targetGoal > 0 ? (sport.currentValue / sport.targetGoal) * 100 : 0;

  // Goal pace position: what % of the year has elapsed
  const totalDays = yearContext.daysElapsed + yearContext.daysRemaining;
  const pacePosition = totalDays > 0 ? (yearContext.daysElapsed / totalDays) * 100 : 0;

  const { label: status, delta } = getStatusForDashboard(
    sport.currentValue,
    sport.targetGoal,
    yearContext
  );

  // Natural phrasing: "43.3 mi ahead" / "On track" / "10.8 mi behind"
  let statusDisplay = status;
  if (delta !== null && status !== "On Track") {
    const formatted = formatMetricDisplayValue(Math.abs(delta), sport.isDistanceSport);
    const direction = delta >= 0 ? "ahead" : "behind";
    statusDisplay = `${formatted} ${sport.metricUnit} ${direction}`;
  }

  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-1">
        <Link
          to={`/${sport.sport}/${yearContext.year}`}
          className="text-sm"
          style={{ color: sport.color }}
        >
          {sport.displayName}
        </Link>
        <span className="text-sm text-slate-light">{statusDisplay}</span>
      </div>

      <RaceTrack
        primaryPosition={youPosition}
        pacePosition={pacePosition}
        showPace={yearContext.shouldShowPacing}
        trackColor={sport.color}
        height={28}
      />

      <div className="text-sm text-slate-light" style={{ fontSize: "0.7rem" }}>
        {formatMetricDisplayValue(sport.currentValue, sport.isDistanceSport)} /{" "}
        {formatMetricDisplayValue(sport.targetGoal, sport.isDistanceSport)} {sport.metricUnit}
      </div>
    </div>
  );
}

interface DashboardStatus {
  label: string;
  /** Delta between current value and prorated goal (positive = ahead, negative = behind). null when no delta applies. */
  delta: number | null;
}

function getStatusForDashboard(
  currentValue: number,
  targetGoal: number,
  yearContext: Pick<YearContext, "daysElapsed" | "daysRemaining" | "isPastYear">
): DashboardStatus {
  const progress = targetGoal > 0 ? (currentValue / targetGoal) * 100 : 0;

  if (yearContext.isPastYear) {
    return { label: progress >= 100 ? "Achieved" : "Not Met", delta: null };
  }

  if (progress >= 100) return { label: "Achieved", delta: null };

  // Calculate pace ratio: actual vs expected at this point
  const totalDays = yearContext.daysElapsed + yearContext.daysRemaining;
  if (totalDays === 0) return { label: "—", delta: null };
  const proratedGoal = targetGoal * (yearContext.daysElapsed / totalDays);
  if (proratedGoal === 0) return { label: currentValue > 0 ? "Ahead" : "—", delta: null };
  const paceRatio = currentValue / proratedGoal;
  const delta = currentValue - proratedGoal;

  if (paceRatio >= PACE_THRESHOLDS.AHEAD) return { label: "Ahead", delta };
  if (paceRatio >= PACE_THRESHOLDS.ON_TRACK) return { label: "On Track", delta };
  if (paceRatio >= PACE_THRESHOLDS.SLIGHTLY_BEHIND) return { label: "Slightly Behind", delta };
  return { label: "Behind", delta };
}
