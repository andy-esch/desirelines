import React from "react";
import { Goals } from "../utils/goalCalculations";
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
  const { year, isCurrentYear, isPastYear, daysRemaining } = yearContext;

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

  const getStatusText = (goalValue: number): string => {
    const progress = calculateProgress(goalValue);

    // Past tense labels for historical years - binary: achieved or not
    if (isPastYear) {
      return progress >= 100 ? "Achieved ✓" : "Not Met";
    }

    // Present tense labels for current year - more granular for in-progress tracking
    if (progress >= 100) return "Achieved ✓";
    if (progress >= 90) return "Nearly There";
    if (progress >= 75) return "On Track";
    if (progress >= 50) return "Behind";
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
                      <div className="progress" style={{ height: "20px", minWidth: "100px" }}>
                        <div
                          className="progress-bar"
                          role="progressbar"
                          style={{
                            width: `${Math.min(100, progress)}%`,
                            backgroundColor: goalColor,
                          }}
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          {isLoading ? "--" : `${progress.toFixed(0)}%`}
                        </div>
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
