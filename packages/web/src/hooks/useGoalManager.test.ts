import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useGoalManager } from "./useGoalManager";

describe("useGoalManager", () => {
  const initialGoals = [
    { id: "1", value: 1000, label: "Goal 1" },
    { id: "2", value: 2000, label: "Goal 2" },
  ];
  const onGoalsChange = vi.fn().mockResolvedValue(undefined);
  const defaultProps = {
    goals: initialGoals,
    onGoalsChange,
    estimatedYearEnd: 3000,
    sport: "cycling",
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

    expect(onGoalsChange).toHaveBeenCalledWith([
      { id: "1", value: 1100, label: "Goal 1" },
      { id: "2", value: 2000, label: "Goal 2" },
    ]);
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

    expect(onGoalsChange).toHaveBeenCalledWith([
      { id: "1", value: 1500, label: "Goal 1" },
      { id: "2", value: 2000, label: "Goal 2" },
    ]);
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
      expect.arrayContaining([{ id: "1", value: -100 }])
    );
  });

  it("should handle adding a goal", async () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    await act(async () => {
      result.current.handleAddGoal();
    });

    expect(onGoalsChange).toHaveBeenCalled();
    const callArgs = onGoalsChange.mock.calls[0][0];
    expect(callArgs).toHaveLength(3);
    expect(callArgs[2].label).toBe("Goal 3");
  });

  it("should handle removing a goal", async () => {
    const { result } = renderHook(() => useGoalManager(defaultProps));

    await act(async () => {
      result.current.handleRemoveGoal("1");
    });

    expect(onGoalsChange).toHaveBeenCalledWith([{ id: "2", value: 2000, label: "Goal 2" }]);
  });
});
