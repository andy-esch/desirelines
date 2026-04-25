import { useMemo } from "react";
import type { Goal } from "../utils/goalCalculations";

export interface GoalStats {
  /** The next goal to achieve (or last goal if all passed) */
  nextGoal: Goal | null;
  /** Progress towards next goal as percentage (0-100+) */
  nextGoalProgress: number;
  /** Distance remaining to next goal (0 if goal reached) */
  nextGoalGap: number;
  /** Daily pace needed to reach next goal by year end */
  paceNeededForNextGoal: number;
}

/**
 * Custom hook for calculating goal-related statistics
 *
 * Encapsulates the logic for:
 * - Finding the next goal to achieve
 * - Calculating progress towards that goal
 * - Computing the gap remaining
 * - Determining the daily pace needed to reach it
 *
 * @param goals - Array of goals (sorted by value)
 * @param currentDistance - Current cumulative distance
 * @param daysRemaining - Number of days remaining in the year
 * @returns Goal statistics for display in KPI cards and tables
 *
 * @example
 * const { nextGoal, nextGoalProgress, paceNeededForNextGoal } = useGoalStats(
 *   goals,
 *   2450,
 *   70
 * );
 */
export function useGoalStats(
  goals: Goal[],
  currentDistance: number,
  daysRemaining: number
): GoalStats {
  return useMemo(() => {
    // Smart "Next Goal" logic: first goal above current, or highest goal if all passed
    let nextGoal: Goal | null = null;
    if (goals.length > 0) {
      const goalsAbove = goals.filter((g) => g.value > currentDistance);
      nextGoal = (goalsAbove.length > 0 ? goalsAbove[0] : goals.at(-1)) ?? null;
    }

    const nextGoalProgress = nextGoal ? (currentDistance / nextGoal.value) * 100 : 0;
    const nextGoalGap = nextGoal ? Math.max(0, nextGoal.value - currentDistance) : 0;
    const paceNeededForNextGoal =
      daysRemaining > 0 && nextGoalGap > 0 ? nextGoalGap / daysRemaining : 0;

    return { nextGoal, nextGoalProgress, nextGoalGap, paceNeededForNextGoal };
  }, [goals, currentDistance, daysRemaining]);
}
