import React from "react";
import { type Goals, PACE_THRESHOLDS } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import type { MetricUnit } from "../utils/units";
import { useDangerThresholds } from "../hooks/useDangerThresholds";
import { CheckIcon, WarningIcon } from "./icons";
import { StatusSymbol, type GoalStatus } from "./theme/StatusSymbol";
import { getYearElapsedShare, type YearContext } from "../utils/yearContext";
import { Panel } from "./theme/Panel";
import { Meter } from "./theme/Meter";
import { useThemeStructure } from "./theme/useThemeStructure";
import { Alert } from "./ui/alert";
import { Table } from "./ui/table";

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
  const { year, isPastYear, daysRemaining } = yearContext;
  const { goalTrackStyle } = useThemeStructure();
  // Where linear pacing puts you today, as a share of the year: the goal track's pace tick.
  const paceShare = yearContext.shouldShowPacing ? getYearElapsedShare(yearContext) : undefined;

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
  const calculateProratedGoal = (goalValue: number): number =>
    goalValue * getYearElapsedShare(yearContext);

  /**
   * Calculate pace ratio: actual progress vs expected progress at this point in year.
   * ratio >= 1.0 means on track or ahead, < 1.0 means behind pace.
   */
  const calculatePaceRatio = (goalValue: number): number => {
    const proratedGoal = calculateProratedGoal(goalValue);
    if (proratedGoal === 0) return currentValue > 0 ? Infinity : 1;
    return currentValue / proratedGoal;
  };

  const getStatus = (goalValue: number): { status: GoalStatus; label: string } => {
    const progress = calculateProgress(goalValue);
    const achieved = { status: "achieved", label: "Achieved" } as const;

    // Past tense labels for historical years - binary: achieved or not
    if (isPastYear) {
      return progress >= 100 ? achieved : { status: "not-met", label: "Not Met" };
    }

    // Already achieved the full year goal
    if (progress >= 100) return achieved;

    // For current/future years, compare against prorated goal (where you should be now)
    const paceRatio = calculatePaceRatio(goalValue);

    if (paceRatio >= PACE_THRESHOLDS.AHEAD) return { status: "ahead", label: "Ahead" };
    if (paceRatio >= PACE_THRESHOLDS.ON_TRACK) return { status: "on-track", label: "On Track" };
    if (paceRatio >= PACE_THRESHOLDS.SLIGHTLY_BEHIND) {
      return { status: "slightly-behind", label: "Slightly Behind" };
    }
    if (paceRatio >= PACE_THRESHOLDS.BEHIND) return { status: "behind", label: "Behind" };
    return { status: "far-behind", label: "Far Behind" };
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
    <Panel title="Goal Achievability Summary" className="mb-8">
      <div className="overflow-x-auto">
        <Table hover className="mb-4">
          <caption className="sr-only">Goal achievability summary</caption>
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
              const status = isLoading
                ? ({ status: "no-activity", label: "Loading..." } as const)
                : getStatus(goal.value);
              const isDangerous = dangerousGoalIds.has(goal.id);

              // Find the original index in the unsorted goals array to get the correct color
              const originalIndex = goals.findIndex((g) => g.id === goal.id);
              const goalColor = GOAL_COLORS[originalIndex % GOAL_COLORS.length];

              return (
                <tr
                  key={goal.id}
                  className={isDangerous ? "bg-danger/8 hover:bg-danger/12" : undefined}
                >
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
                    {goalTrackStyle !== "bar-with-percent" ? (
                      <div className="flex min-w-[140px] items-center gap-3">
                        <Meter
                          value={progress / 100}
                          marker={paceShare}
                          color={goalColor}
                          label={`${goal.label || "Unnamed"} progress`}
                          className="grow"
                        />
                        <span className="w-10 shrink-0 text-right tabular-nums">
                          {isLoading ? "--" : `${progress.toFixed(0)}%`}
                        </span>
                      </div>
                    ) : (
                      <div className="relative flex h-(--track-height) min-w-[100px] rounded-(--track-radius) bg-(--track-bg)">
                        <div
                          className="flex flex-col justify-center [background-image:var(--progress-shine)] transition-[width] duration-300"
                          role="progressbar"
                          aria-label={`${goal.label || "Unnamed"} progress`}
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
                          // scrim (`bg-scrim/50`) gives the white text its own consistent
                          // background → WCAG 1.4.3 passes (~4.8:1+) on every goal fill and
                          // both themes, regardless of what's behind the bar.
                          className="text-on-scrim bg-scrim/50 px-1.5 py-0.5 rounded-sm leading-none"
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
                    )}
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
                    <StatusSymbol
                      status={status.status}
                      label={status.label}
                      badgeStyle={{ backgroundColor: goalColor }}
                      badgeContent={
                        status.status === "achieved" ? (
                          <>
                            Achieved{" "}
                            <CheckIcon size={12} className="ml-1 inline" aria-hidden="true" />
                          </>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {/* Warning banner - only if dangerous goals exist and data is loaded */}
      {hasDangerousGoals && (
        <Alert variant="warning" role="alert" className="mt-6">
          <small>
            <strong>
              <WarningIcon size={12} className="inline mr-1" aria-hidden="true" />
              Warning:
            </strong>{" "}
            Goals marked with <WarningIcon
              size={12}
              className="inline mx-0.5"
              aria-hidden="true"
            />{" "}
            require a pace exceeding{" "}
            <strong>
              {dangerThreshold} {unit}/day
            </strong>
            , which may be unsustainable. Consider adjusting your targets.
          </small>
        </Alert>
      )}

      {yearContext.shouldShowPacing && (
        <p className="text-muted-text mt-2 mb-0">
          <small>
            {yearContext.daysRemaining} days remaining in {year}
          </small>
        </p>
      )}
      {isPastYear && (
        <p className="text-muted-text mt-2 mb-0">
          <small>Historical year - {year} complete</small>
        </p>
      )}
      {yearContext.isFutureYear && (
        <p className="text-muted-text mt-2 mb-0">
          <small>Future year - planning mode</small>
        </p>
      )}
    </Panel>
  );
};

export default GoalSummaryTable;
