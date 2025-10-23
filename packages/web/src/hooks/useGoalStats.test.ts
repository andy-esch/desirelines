import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGoalStats } from "./useGoalStats";
import type { Goal } from "../utils/goalCalculations";

describe("useGoalStats", () => {
  const createGoals = (): Goal[] => [
    { id: "1", value: 1000, label: "Base" },
    { id: "2", value: 2000, label: "Challenger" },
    { id: "3", value: 3000, label: "Elite" },
  ];

  it("finds next goal when current distance is below first goal", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 500, 70));

    expect(result.current.nextGoal).toEqual({ id: "1", value: 1000, label: "Base" });
    expect(result.current.nextGoalProgress).toBe(50); // 500/1000 * 100
    expect(result.current.nextGoalGap).toBe(500);
  });

  it("finds next goal when current distance is between goals", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 1500, 70));

    expect(result.current.nextGoal).toEqual({ id: "2", value: 2000, label: "Challenger" });
    expect(result.current.nextGoalProgress).toBe(75); // 1500/2000 * 100
    expect(result.current.nextGoalGap).toBe(500);
  });

  it("returns highest goal when all goals are passed", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 3500, 70));

    expect(result.current.nextGoal).toEqual({ id: "3", value: 3000, label: "Elite" });
    expect(result.current.nextGoalProgress).toBeGreaterThan(100); // 3500/3000 * 100 = 116.67
    expect(result.current.nextGoalGap).toBe(0); // No gap when goal is passed
  });

  it("returns null when no goals are set", () => {
    const { result } = renderHook(() => useGoalStats([], 1500, 70));

    expect(result.current.nextGoal).toBeNull();
    expect(result.current.nextGoalProgress).toBe(0);
    expect(result.current.nextGoalGap).toBe(0);
  });

  it("calculates correct pace needed for next goal", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 2300, 70));

    // nextGoal = 3000, gap = 700, days = 70
    // pace needed = 700 / 70 = 10 mi/day
    expect(result.current.paceNeededForNextGoal).toBe(10);
  });

  it("returns zero pace needed when goal is already reached", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 3000, 70));

    expect(result.current.paceNeededForNextGoal).toBe(0);
    expect(result.current.nextGoalGap).toBe(0);
  });

  it("returns zero pace needed when no days remaining", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 2500, 0));

    expect(result.current.paceNeededForNextGoal).toBe(0);
  });

  it("handles exact goal completion", () => {
    const goals = createGoals();
    const { result } = renderHook(() => useGoalStats(goals, 2000, 70));

    // Exactly at Challenger goal
    expect(result.current.nextGoal).toEqual({ id: "3", value: 3000, label: "Elite" });
    expect(result.current.nextGoalProgress).toBe(66.66666666666666); // 2000/3000 * 100
    expect(result.current.nextGoalGap).toBe(1000);
  });

  it("updates when goals array changes", () => {
    const goals = createGoals();
    const { result, rerender } = renderHook(
      ({ goals, distance, days }) => useGoalStats(goals, distance, days),
      {
        initialProps: { goals, distance: 1500, days: 70 },
      }
    );

    expect(result.current.nextGoal?.label).toBe("Challenger");

    // Add a new goal between current distance and next goal
    const newGoals = [
      ...goals,
      { id: "4", value: 1800, label: "Intermediate" },
    ].sort((a, b) => a.value - b.value);

    rerender({ goals: newGoals, distance: 1500, days: 70 });

    expect(result.current.nextGoal?.label).toBe("Intermediate");
  });

  it("recalculates when current distance changes", () => {
    const goals = createGoals();
    const { result, rerender } = renderHook(
      ({ goals, distance, days }) => useGoalStats(goals, distance, days),
      {
        initialProps: { goals, distance: 500, days: 70 },
      }
    );

    expect(result.current.nextGoal?.label).toBe("Base");
    expect(result.current.nextGoalGap).toBe(500);

    rerender({ goals, distance: 1500, days: 70 });

    expect(result.current.nextGoal?.label).toBe("Challenger");
    expect(result.current.nextGoalGap).toBe(500);
  });

  it("recalculates pace when days remaining changes", () => {
    const goals = createGoals();
    const { result, rerender } = renderHook(
      ({ goals, distance, days }) => useGoalStats(goals, distance, days),
      {
        initialProps: { goals, distance: 2300, days: 70 },
      }
    );

    expect(result.current.paceNeededForNextGoal).toBe(10); // 700/70

    rerender({ goals, distance: 2300, days: 35 });

    expect(result.current.paceNeededForNextGoal).toBe(20); // 700/35
  });

  it("handles single goal", () => {
    const goals: Goal[] = [{ id: "1", value: 2000, label: "Only Goal" }];
    const { result } = renderHook(() => useGoalStats(goals, 1500, 70));

    expect(result.current.nextGoal).toEqual({ id: "1", value: 2000, label: "Only Goal" });
    expect(result.current.nextGoalProgress).toBe(75);
  });

  it("handles progress over 100%", () => {
    const goals: Goal[] = [{ id: "1", value: 1000, label: "Goal" }];
    const { result } = renderHook(() => useGoalStats(goals, 1500, 70));

    expect(result.current.nextGoalProgress).toBe(150);
    expect(result.current.nextGoalGap).toBe(0);
  });
});
