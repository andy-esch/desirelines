import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useGoalManager } from "./useGoalManager";
import { testGoals } from "../utils/goalTestFixtures";
import type { Goal } from "../utils/goalCalculations";

describe("useGoalManager", () => {
  const initialGoals = testGoals([
    { id: "1", value: 1000, label: "Goal 1" },
    { id: "2", value: 2000, label: "Goal 2" },
  ]);
  const onGoalsChange = vi.fn().mockResolvedValue(undefined);
  const defaultProps = {
    goals: initialGoals,
    onGoalsChange,
    estimatedYearEnd: 3000,
    sport: "cycling",
    primaryMetric: "distance_meters",
    sportConfig: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with correct default state", () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    expect(result.current.editingId).toBeNull();
    expect(result.current.editValue).toBe("");
    expect(result.current.editingLabel).toBeNull();
    expect(result.current.editValidationError).toBeNull();
    // Default increment size for cycling is 100
    expect(result.current.incrementSize).toBe(100);
  });

  it("should handle incrementing a goal value", async () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    await act(async () => {
      result.current.handleIncrement("1", 100);
    });

    expect(onGoalsChange).toHaveBeenCalledTimes(1);
    const saved = onGoalsChange.mock.calls[0]![0] as Goal[];
    expect(saved).toHaveLength(2);
    expect(saved[0]!.id).toBe("1");
    expect(saved[0]!.value).toBe(1100);
    expect(saved[1]!.id).toBe("2");
    expect(saved[1]!.value).toBe(2000);
  });

  it("should bump updatedAt on the mutated goal but leave siblings untouched", async () => {
    const original = testGoals([
      { id: "1", value: 1000, label: "Goal 1", createdAt: "2024-06-01T00:00:00.000Z" },
      { id: "2", value: 2000, label: "Goal 2", createdAt: "2024-06-01T00:00:00.000Z" },
    ]);
    const { result } = renderHook(() => useGoalManager({ ...defaultProps, goals: original }));

    await act(async () => {
      result.current.handleIncrement("1", 100);
    });

    const saved = onGoalsChange.mock.calls[0]![0] as Goal[];
    // Goal 1 was mutated → updatedAt is fresh (not the fixture stamp).
    expect(saved[0]!.updatedAt).not.toBe("2025-01-01T00:00:00.000Z");
    expect(saved[0]!.createdAt).toBe("2024-06-01T00:00:00.000Z");
    // Goal 2 was untouched → both timestamps unchanged.
    expect(saved[1]!.updatedAt).toBe(original[1]!.updatedAt);
    expect(saved[1]!.createdAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("should handle starting edit", () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    act(() => {
      result.current.handleStartEdit("1", 1000);
    });

    expect(result.current.editingId).toBe("1");
    expect(result.current.editValue).toBe("1000");
  });

  it("should handle saving edit with valid value", async () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    // Start edit first
    act(() => {
      result.current.handleStartEdit("1", 1000);
    });

    // Update value
    act(() => {
      result.current.setEditValue("1500");
    });

    // Save
    await act(async () => {
      result.current.handleSaveEdit("1");
    });

    const saved = onGoalsChange.mock.calls[0]![0] as Goal[];
    expect(saved[0]!.value).toBe(1500);
    expect(saved[1]!.value).toBe(2000);
    expect(result.current.editingId).toBeNull();
  });

  it("should validate invalid value on save", () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    act(() => {
      result.current.handleStartEdit("1", 1000);
    });

    act(() => {
      result.current.setEditValue("-100");
    });

    act(() => {
      result.current.handleSaveEdit("1");
    });

    expect(result.current.editValidationError).not.toBeNull();
    expect(onGoalsChange).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "1", value: -100 })])
    );
  });

  it("should handle adding a goal with full proto metadata", async () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    await act(async () => {
      result.current.handleAddGoal();
    });

    expect(onGoalsChange).toHaveBeenCalledTimes(1);
    const callArgs = onGoalsChange.mock.calls[0]![0] as Goal[];
    expect(callArgs).toHaveLength(3);

    const newGoal = callArgs[2]!;
    // The added goal must carry every proto field — no later code path can
    // "bolt on" missing fields. This is the core invariant from #2.
    expect(newGoal.id).toEqual(expect.any(String));
    expect(newGoal.value).toEqual(expect.any(Number));
    expect(newGoal.label).toBe("Goal 3");
    expect(newGoal.metric).toBe("distance_meters");
    expect(newGoal.createdAt).toEqual(expect.any(String));
    expect(newGoal.updatedAt).toEqual(expect.any(String));
    // ISO timestamps should be roughly now.
    expect(new Date(newGoal.createdAt).getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it("should respect primaryMetric when adding a goal", async () => {
    const { result } = renderHook(() =>
      useGoalManager({ ...defaultProps, primaryMetric: "time_minutes" })
    );

    await act(async () => {
      result.current.handleAddGoal();
    });

    const saved = onGoalsChange.mock.calls[0]![0] as Goal[];
    expect(saved[2]!.metric).toBe("time_minutes");
  });

  it("should handle removing a goal", async () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    await act(async () => {
      result.current.handleRemoveGoal("1");
    });

    const saved = onGoalsChange.mock.calls[0]![0] as Goal[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).toBe("2");
  });

  it("should handle save errors", async () => {
    // Suppress expected console.error from logApiError
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const error = new Error("Failed to save");
    const failingProps = { ...defaultProps, onGoalsChange: vi.fn().mockRejectedValue(error) };
    const { result } = renderHook(() => useGoalManager(failingProps));

    await act(async () => {
      result.current.handleIncrement("1", 100);
    });

    expect(result.current.saveError).toEqual(error);

    act(() => {
      result.current.clearSaveError();
    });

    expect(result.current.saveError).toBeNull();
    errorSpy.mockRestore();
  });

  it("should handle parallel edits on different goals without cancelling each other", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGoalManager(defaultProps));

    // Edit Goal 1
    act(() => {
      result.current.handleLabelEdit("1", "Updated 1");
    });

    // Edit Goal 2 immediately
    act(() => {
      result.current.handleLabelEdit("2", "Updated 2");
    });

    // Fast forward debounce
    await act(async () => {
      vi.runAllTimers();
    });

    // Should call save for both edits
    expect(onGoalsChange).toHaveBeenCalledTimes(2);
    expect(onGoalsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "1", label: "Updated 1" })])
    );
    expect(onGoalsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "2", label: "Updated 2" })])
    );

    vi.useRealTimers();
  });
});
