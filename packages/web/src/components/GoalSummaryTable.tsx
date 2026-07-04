import React from "react";
import { type Goals, PACE_THRESHOLDS } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import type { MetricUnit } from "../utils/units";
import { useDangerThresholds } from "../hooks/useDangerThresholds";
import { CheckIcon, WarningIcon } from "./icons";
import type { YearContext } from "../utils/yearContext";

interface GoalSummaryTableProps {
  goals: Goals;
  /** Current cumulative value in display units (distance, time, sessions, or elevation). */
  currentValue: number;
  yearContext: YearContext;
  /** Display unit label (e.g., "mi", "km", "sessions", "hours"). */
  unit: MetricUnit;
  /** Sport key (e.g., "cycling", "yoga") — drives the danger zone threshold lookup. */
  sport: string;
  isLoading?: boolean; // Whether data is still loading
}

const GoalSummaryTable: React.FC<GoalSummaryTableProps> = ({
  goals,
  currentValue,
  yearContext,
  unit,
  sport,
  isLoading = false,
}) => {
  const { year, isPastYear, daysElapsed, daysRemaining } = yearContext;

  // Get danger threshold for this sport
  const { getThreshold } = useDangerThresholds();
  const dangerThreshold = getThreshold(sport);

  const calculateDailyPaceNeeded = (goalValue: number): number => {
    if (daysRemaining <= 0) return 0;

    const remaining = Math.max(0, goalValue - currentValue);
    return remaining / daysRemaining;
  };

  // Helper to check if pace is in danger zone
  const isPaceDangerous = (paceNeeded: number): boolean => {
    return paceNeeded > dangerThreshold;
  };

  const calculateProgress = (goalValue: number): number => {
    return goalValue > 0 ? (currentValue / goalValue) * 100 : 0;
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
    if (proratedGoal === 0) return currentValue > 0 ? Infinity : 1;
    return currentValue / proratedGoal;
  };

  const getStatusContent = (goalValue: number): React.ReactNode => {
    const progress = calculateProgress(goalValue);

    const achieved = (
      <>
        Achieved <CheckIcon size={12} className="ml-1 inline" aria-hidden="true" />
      </>
    );

    // Past tense labels for historical years - binary: achieved or not
    if (isPastYear) {
      return progress >= 100 ? achieved : "Not Met";
    }

    // Already achieved the full year goal
    if (progress >= 100) return achieved;

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

  // Danger state per goal, computed once: row cells look it up by id and the
  // warning banner reuses the aggregate instead of recomputing the pace check.
  const dangerousGoals = isLoading
    ? []
    : sortedGoals.filter((g) => isPaceDangerous(calculateDailyPaceNeeded(g.value)));
  const dangerousGoalIds = new Set(dangerousGoals.map((g) => g.id));
  const hasDangerousGoals = dangerousGoals.length > 0;

  return (
    <div className="card glass-panel mb-8">
      <div className="card-header">
        <h5>Goal Achievability Summary</h5>
      </div>
      <div className="card-body">
        <div className="overflow-x-auto">
          <table className="table table-hover table-sm table-dark-transparent">
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
                const remaining = isLoading ? 0 : Math.max(0, goal.value - currentValue);
                const paceNeeded = isLoading ? 0 : calculateDailyPaceNeeded(goal.value);
                const status = isLoading ? "Loading..." : getStatusContent(goal.value);
                const isDangerous = dangerousGoalIds.has(goal.id);

                // Find the original index in the unsorted goals array to get the correct color
                const originalIndex = goals.findIndex((g) => g.id === goal.id);
                const goalColor = GOAL_COLORS[originalIndex % GOAL_COLORS.length];

                return (
                  <tr key={goal.id} className={isDangerous ? "table-row-danger" : ""}>
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
                          // The % overlays the colored fill *and* the dark track depending
                          // on progress, so no single text color works for both. A dark
                          // scrim (`bg-black/50`) gives the white text its own consistent
                          // background → WCAG 1.4.3 passes (~4.8:1+) on every goal fill and
                          // both themes, regardless of what's behind the bar.
                          className="text-white bg-black/50 px-1.5 py-0.5 rounded-sm leading-none"
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            textShadow: "0 0 3px rgba(0, 0, 0, 0.7)",
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
                          <span className={isDangerous ? "font-bold text-danger" : ""}>
                            {paceNeeded.toFixed(1)} {unit}/day
                            {isDangerous && (
                              <span
                                className="ml-2 inline-flex items-center text-danger"
                                title="This pace exceeds sustainable limits"
                                style={{ cursor: "help" }}
                              >
                                <WarningIcon size={14} aria-hidden="true" />
                                <span className="sr-only">Warning: unsustainable pace</span>
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
        {hasDangerousGoals && (
          <div className="alert alert-warning mt-6 mb-0" role="alert">
            <small>
              <strong>
                <WarningIcon size={12} className="inline mr-1" aria-hidden="true" />
                Warning:
              </strong>{" "}
              Goals marked with{" "}
              <WarningIcon size={12} className="inline mx-0.5" aria-hidden="true" /> require a pace
              exceeding{" "}
              <strong>
                {dangerThreshold} {unit}/day
              </strong>
              , which may be unsustainable. Consider adjusting your targets.
            </small>
          </div>
        )}

        {yearContext.shouldShowPacing && (
          <p className="text-slate-light mt-2 mb-0">
            <small>
              {yearContext.daysRemaining} days remaining in {year}
            </small>
          </p>
        )}
        {isPastYear && (
          <p className="text-slate-light mt-2 mb-0">
            <small>Historical year - {year} complete</small>
          </p>
        )}
        {yearContext.isFutureYear && (
          <p className="text-slate-light mt-2 mb-0">
            <small>Future year - planning mode</small>
          </p>
        )}
      </div>
    </div>
  );
};

export default GoalSummaryTable;
