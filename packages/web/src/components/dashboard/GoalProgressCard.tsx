import { Link } from "react-router-dom";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { PACE_THRESHOLDS } from "../../utils/goalCalculations";
import { formatMetricDisplayValue } from "../../utils/units";
import type { YearContext } from "../../utils/yearContext";
import RaceTrack, { RaceTrackLegend } from "../RaceTrack";

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
      <div className="glass-panel h-100">
        <div className="text-center text-muted py-3">
          <small>Unable to load goal progress</small>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel h-100">
      <div className="mb-2">
        <h6 className="h6 mb-0 text-muted">{yearContext.year} Goals</h6>
      </div>
      {isLoading ? (
        <div className="text-center text-muted py-3">
          <small>Loading...</small>
        </div>
      ) : sportData.length === 0 ? (
        <div className="text-center text-muted py-3">
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

  const status = getStatusForDashboard(sport.currentValue, sport.targetGoal, yearContext);

  return (
    <div className="mb-2">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Link
          to={`/${sport.sport}/${yearContext.year}`}
          className="small text-decoration-none"
          style={{ color: sport.color }}
        >
          {sport.displayName}
        </Link>
        <span className="small text-muted">{status}</span>
      </div>

      <RaceTrack
        primaryPosition={youPosition}
        pacePosition={pacePosition}
        showPace={yearContext.shouldShowPacing}
        trackColor={sport.color}
        height={28}
      />

      <div className="small text-muted" style={{ fontSize: "0.7rem" }}>
        {formatMetricDisplayValue(sport.currentValue, sport.isDistanceSport)} /{" "}
        {formatMetricDisplayValue(sport.targetGoal, sport.isDistanceSport)} {sport.metricUnit}
      </div>
    </div>
  );
}

function getStatusForDashboard(
  currentValue: number,
  targetGoal: number,
  yearContext: Pick<YearContext, "daysElapsed" | "daysRemaining" | "isPastYear">
): string {
  const progress = targetGoal > 0 ? (currentValue / targetGoal) * 100 : 0;

  if (yearContext.isPastYear) {
    return progress >= 100 ? "Achieved" : "Not Met";
  }

  if (progress >= 100) return "Achieved";

  // Calculate pace ratio: actual vs expected at this point
  const totalDays = yearContext.daysElapsed + yearContext.daysRemaining;
  if (totalDays === 0) return "—";
  const proratedGoal = targetGoal * (yearContext.daysElapsed / totalDays);
  if (proratedGoal === 0) return currentValue > 0 ? "Ahead" : "—";
  const paceRatio = currentValue / proratedGoal;

  if (paceRatio >= PACE_THRESHOLDS.AHEAD) return "Ahead";
  if (paceRatio >= PACE_THRESHOLDS.ON_TRACK) return "On Track";
  if (paceRatio >= PACE_THRESHOLDS.SLIGHTLY_BEHIND) return "Slightly Behind";
  return "Behind";
}
