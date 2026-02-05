import { Link } from "react-router-dom";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { formatMetricDisplayValue } from "../../utils/units";
import type { YearContext } from "../../utils/yearContext";

/**
 * Per-sport progress bars toward annual goals.
 *
 * Uses neon progress bar styling from GoalSummaryTable:
 * - progress-neon / progress-bar-neon CSS classes
 * - boxShadow glow effect per sport color
 * - Pace status per sport (Ahead / On Track / Behind)
 * - Links sport names to sport detail pages
 */
export default function GoalProgressCard() {
  const { sportData, yearContext, isLoading, error } = useDashboardGoalData();

  if (error) {
    return (
      <div className="border rounded p-2 h-100" style={{ background: "transparent" }}>
        <div className="text-center text-muted py-3">
          <small>Unable to load goal progress</small>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded p-2 h-100" style={{ background: "transparent" }}>
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
          <div className="d-flex gap-3 pt-2 mt-1">
            <LegendItem filled label="On Track" />
            <LegendItem filled={false} label="Behind" />
          </div>
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
  const progress = sport.targetGoal > 0 ? (sport.currentValue / sport.targetGoal) * 100 : 0;

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
      <div className="progress progress-neon" style={{ height: 16, position: "relative" }}>
        <div
          className="progress-bar progress-bar-neon"
          role="progressbar"
          style={{
            width: `${Math.min(100, progress)}%`,
            backgroundColor: sport.color,
            boxShadow: `0 0 ${1 + (progress / 100) * 3}px ${sport.color}`,
          }}
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "0.65rem",
            fontWeight: 500,
            color: progress > 50 ? "#fff" : "#333",
            textShadow: progress > 50 ? "0 0 2px rgba(0,0,0,0.5)" : "none",
          }}
        >
          {progress.toFixed(0)}%
        </span>
      </div>
      <div className="small text-muted" style={{ fontSize: "0.7rem" }}>
        {formatMetricDisplayValue(sport.currentValue, sport.isDistanceSport)} /{" "}
        {formatMetricDisplayValue(sport.targetGoal, sport.isDistanceSport)} {sport.metricUnit}
      </div>
    </div>
  );
}

function LegendItem({ filled, label }: { filled: boolean; label: string }) {
  return (
    <span className="d-flex align-items-center gap-1">
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: filled ? "rgba(0, 200, 100, 0.85)" : "rgba(150, 150, 150, 0.5)",
        }}
      />
      <small className="text-muted">{label}</small>
    </span>
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

  if (paceRatio >= 1.1) return "Ahead";
  if (paceRatio >= 0.9) return "On Track";
  if (paceRatio >= 0.75) return "Slightly Behind";
  return "Behind";
}
