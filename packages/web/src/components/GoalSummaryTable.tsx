import React from "react";
import { Goals } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import type { MetricUnit } from "../utils/units";
import { getDangerThreshold } from "../constants/dangerZoneThresholds";

interface GoalSummaryTableProps {
  goals: Goals;
  currentDistance: number;
  year: number;
  unit?: MetricUnit; // Unit label (e.g., "mi", "km", "sessions")
  sport?: string; // Sport type for danger zone threshold lookup
}

const GoalSummaryTable: React.FC<GoalSummaryTableProps> = ({
  goals,
  currentDistance,
  year,
  unit = "miles",
  sport = "cycling",
}) => {
  const today = new Date();
  const isCurrentYear = year === today.getFullYear();

  // Get danger threshold for this sport
  const dangerThreshold = getDangerThreshold(sport);

  const calculateDaysRemaining = (): number => {
    if (!isCurrentYear) return 0;
    // Use UTC to avoid timezone issues
    const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const endOfYear = Date.UTC(year, 11, 31);
    const msPerDay = 1000 * 60 * 60 * 24;
    // Add 1 to include today in the count (inclusive of both start and end dates)
    return Math.ceil((endOfYear - todayStart) / msPerDay) + 1;
  };

  const calculateDailyPaceNeeded = (goalValue: number): number => {
    const daysRemaining = calculateDaysRemaining();
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
    if (progress >= 100) return "Achieved ✓";
    if (progress >= 90) return "Nearly There";
    if (progress >= 75) return "On Track";
    if (progress >= 50) return "Behind";
    return "Far Behind";
  };

  const daysRemaining = calculateDaysRemaining();

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
                {isCurrentYear && daysRemaining > 0 && <th>Daily Pace Needed</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedGoals.map((goal) => {
                const progress = calculateProgress(goal.value);
                const remaining = Math.max(0, goal.value - currentDistance);
                const paceNeeded = calculateDailyPaceNeeded(goal.value);
                const status = getStatusText(goal.value);
                const isDangerous = isPaceDangerous(paceNeeded);

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
                          {progress.toFixed(0)}%
                        </div>
                      </div>
                    </td>
                    <td>
                      {remaining.toFixed(0)} {unit}
                    </td>
                    {isCurrentYear && daysRemaining > 0 && (
                      <td>
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

        {/* Warning banner - only if dangerous goals exist */}
        {sortedGoals.some((g) => isPaceDangerous(calculateDailyPaceNeeded(g.value))) && (
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

        {isCurrentYear && daysRemaining > 0 && (
          <p className="text-muted mt-2 mb-0">
            <small>
              {daysRemaining} days remaining in {year}
            </small>
          </p>
        )}
        {!isCurrentYear && (
          <p className="text-muted mt-2 mb-0">
            <small>Historical year - pace calculations not applicable</small>
          </p>
        )}
      </div>
    </div>
  );
};

export default GoalSummaryTable;
