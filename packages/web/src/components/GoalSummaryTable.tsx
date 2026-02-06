import React from "react";
import { Goals, PACE_THRESHOLDS } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import type { MetricUnit } from "../utils/units";
import { getDangerThreshold } from "../constants/dangerZoneThresholds";
import type { YearContext } from "../utils/yearContext";

interface GoalSummaryTableProps {
  goals: Goals;
  currentDistance: number;
  yearContext: YearContext;
  unit?: MetricUnit; // Unit label (e.g., "mi", "km", "sessions")
  sport?: string; // Sport type for danger zone threshold lookup
  isLoading?: boolean; // Whether data is still loading
}

const GoalSummaryTable: React.FC<GoalSummaryTableProps> = ({
  goals,
  currentDistance,
  yearContext,
  unit = "miles",
  sport = "cycling",
  isLoading = false,
}) => {
  const { year, isPastYear, daysElapsed, daysRemaining } = yearContext;

  // Get danger threshold for this sport
  const dangerThreshold = getDangerThreshold(sport);

  const calculateDailyPaceNeeded = (goalValue: number): number => {
    if (daysRemaining <= 0) return 0;

    const distanceRemaining = Math.max(0, goalValue - currentDistance);
    return distanceRemaining / daysRemaining;
  };

  // Helper to check if pace is in danger zone
  const isPaceDangerous = (paceNeeded: number): boolean => {
    return paceNeeded > dangerThreshold;
  };

  const calculateProgress = (goalValue: number): number => {
    return goalValue > 0 ? (currentDistance / goalValue) * 100 : 0;
  };

  /**
   * Calculate the prorated goal for the current point in the year.
   * This is what you "should" have achieved by now if pacing linearly.
   */
  const calculateProratedGoal = (goalValue: number): number => {
    const totalDays = daysElapsed + daysRemaining;
    if (totalDays === 0) return goalValue;
    return goalValue * (daysElapsed / totalDays);
  };

  /**
   * Calculate pace ratio: actual progress vs expected progress at this point in year.
   * ratio >= 1.0 means on track or ahead, < 1.0 means behind pace.
   */
  const calculatePaceRatio = (goalValue: number): number => {
    const proratedGoal = calculateProratedGoal(goalValue);
    if (proratedGoal === 0) return currentDistance > 0 ? Infinity : 1;
    return currentDistance / proratedGoal;
  };

  const getStatusText = (goalValue: number): string => {
    const progress = calculateProgress(goalValue);

    // Past tense labels for historical years - binary: achieved or not
    if (isPastYear) {
      return progress >= 100 ? "Achieved ✓" : "Not Met";
    }

    // Already achieved the full year goal
    if (progress >= 100) return "Achieved ✓";

    // For current/future years, compare against prorated goal (where you should be now)
    const paceRatio = calculatePaceRatio(goalValue);

    if (paceRatio >= PACE_THRESHOLDS.AHEAD) return "Ahead";
    if (paceRatio >= PACE_THRESHOLDS.ON_TRACK) return "On Track";
    if (paceRatio >= PACE_THRESHOLDS.SLIGHTLY_BEHIND) return "Slightly Behind";
    if (paceRatio >= PACE_THRESHOLDS.BEHIND) return "Behind";
    return "Far Behind";
  };

  // Sort goals by value for display
  const sortedGoals = [...goals].sort((a, b) => a.value - b.value);

  return (
    <div className="card mb-4">
      <div className="card-header">
        <h5>Goal Achievability Summary</h5>
      </div>
      <div className="card-body">
        <div className="table-responsive">
          <table className="table table-hover table-sm">
            <thead>
              <tr>
                <th style={{ width: "10px" }}></th>
                <th>Goal</th>
                <th>Target</th>
                <th>Progress</th>
                <th>Remaining</th>
                {yearContext.shouldShowPacing && <th>Daily Pace Needed</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedGoals.map((goal) => {
                const progress = isLoading ? 0 : calculateProgress(goal.value);
                const remaining = isLoading ? 0 : Math.max(0, goal.value - currentDistance);
                const paceNeeded = isLoading ? 0 : calculateDailyPaceNeeded(goal.value);
                const status = isLoading ? "Loading..." : getStatusText(goal.value);
                const isDangerous = !isLoading && isPaceDangerous(paceNeeded);

                // Find the original index in the unsorted goals array to get the correct color
                const originalIndex = goals.findIndex((g) => g.id === goal.id);
                const goalColor = GOAL_COLORS[originalIndex % GOAL_COLORS.length];

                return (
                  <tr key={goal.id} className={isDangerous ? "table-warning" : ""}>
                    <td
                      style={{
                        borderLeft: `4px solid ${goalColor}`,
                        padding: "0",
                        width: "10px",
                      }}
                    ></td>
                    <td>
                      <strong>{goal.label || "Unnamed"}</strong>
                    </td>
                    <td>
                      {goal.value.toLocaleString()} {unit}
                    </td>
                    <td>
                      <div
                        className="progress progress-neon"
                        style={{ height: "20px", minWidth: "100px", position: "relative" }}
                      >
                        <div
                          className="progress-bar progress-bar-neon"
                          role="progressbar"
                          style={{
                            width: `${Math.min(100, progress)}%`,
                            backgroundColor: goalColor,
                            boxShadow: `0 0 ${1 + (progress / 100) * 3}px ${goalColor}`,
                          }}
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                        {/* Percentage text positioned absolutely for visibility at any width */}
                        <span
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            color: progress > 50 ? "#fff" : "#333",
                            textShadow: progress > 50 ? "0 0 2px rgba(0,0,0,0.5)" : "none",
                          }}
                        >
                          {isLoading ? "--" : `${progress.toFixed(0)}%`}
                        </span>
                      </div>
                    </td>
                    <td>{isLoading ? "--" : `${remaining.toFixed(0)} ${unit}`}</td>
                    {yearContext.shouldShowPacing && (
                      <td>
                        {isLoading ? (
                          "--"
                        ) : (
                          <span className={isDangerous ? "fw-bold text-danger" : ""}>
                            {paceNeeded.toFixed(1)} {unit}/day
                            {isDangerous && (
                              <span
                                className="ms-2"
                                title="This pace exceeds sustainable limits"
                                style={{ cursor: "help" }}
                              >
                                ⚠️
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    )}
                    <td>
                      <span className="badge" style={{ backgroundColor: goalColor }}>
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Warning banner - only if dangerous goals exist and data is loaded */}
        {!isLoading &&
          sortedGoals.some((g) => isPaceDangerous(calculateDailyPaceNeeded(g.value))) && (
            <div className="alert alert-warning mt-3 mb-0" role="alert">
              <small>
                <strong>⚠️ Warning:</strong> Goals marked with ⚠️ require a pace exceeding{" "}
                <strong>
                  {dangerThreshold} {unit}/day
                </strong>
                , which may be unsustainable. Consider adjusting your targets.
              </small>
            </div>
          )}

        {yearContext.shouldShowPacing && (
          <p className="text-muted mt-2 mb-0">
            <small>
              {yearContext.daysRemaining} days remaining in {year}
            </small>
          </p>
        )}
        {isPastYear && (
          <p className="text-muted mt-2 mb-0">
            <small>Historical year - {year} complete</small>
          </p>
        )}
        {yearContext.isFutureYear && (
          <p className="text-muted mt-2 mb-0">
            <small>Future year - planning mode</small>
          </p>
        )}
      </div>
    </div>
  );
};

export default GoalSummaryTable;
