import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useGoalMigration } from "./useGoalMigration";
import type { GoalsForYear } from "../services/userConfigService";

// Mock the migration utilities
vi.mock("../utils/migration", () => ({
  isGoalUnitMigrated: vi.fn(),
  migrateGoalUnitsIfNeeded: vi.fn(),
  markGoalUnitMigrated: vi.fn(),
}));

import {
  isGoalUnitMigrated,
  migrateGoalUnitsIfNeeded,
  markGoalUnitMigrated,
} from "../utils/migration";

const mockIsGoalUnitMigrated = vi.mocked(isGoalUnitMigrated);
const mockMigrateGoalUnitsIfNeeded = vi.mocked(migrateGoalUnitsIfNeeded);
const mockMarkGoalUnitMigrated = vi.mocked(markGoalUnitMigrated);

const GOALS_DATA: GoalsForYear = {
  goals: [
    { id: "1", value: 2000, label: "Conservative", createdAt: "", updatedAt: "" },
    { id: "2", value: 2500, label: "Target", createdAt: "", updatedAt: "" },
  ],
};

const MIGRATED_GOALS: GoalsForYear = {
  goals: [
    { id: "1", value: 3218688, label: "Conservative", createdAt: "", updatedAt: "" },
    { id: "2", value: 4023360, label: "Target", createdAt: "", updatedAt: "" },
  ],
};

describe("useGoalMigration", () => {
  let updateGoals: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateGoals = vi.fn().mockResolvedValue(undefined);
  });

  it("does nothing when goalsData is null", () => {
    renderHook(() => useGoalMigration(null, 2026, "cycling", true, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
    expect(updateGoals).not.toHaveBeenCalled();
  });

  it("does nothing for non-distance sports", () => {
    renderHook(() => useGoalMigration(GOALS_DATA, 2026, "yoga", false, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
    expect(updateGoals).not.toHaveBeenCalled();
  });

  it("does nothing when already migrated", () => {
    mockIsGoalUnitMigrated.mockReturnValue(true);

    renderHook(() => useGoalMigration(GOALS_DATA, 2026, "cycling", true, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
    expect(updateGoals).not.toHaveBeenCalled();
  });

  it("does nothing when goals array is empty", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    const emptyGoals: GoalsForYear = { goals: [] };

    renderHook(() => useGoalMigration(emptyGoals, 2026, "cycling", true, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
  });

  it("runs migration and saves when needsSave is true", async () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: MIGRATED_GOALS,
      needsSave: true,
    });

    renderHook(() => useGoalMigration(GOALS_DATA, 2026, "cycling", true, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledWith(GOALS_DATA, 2026, "cycling");
    expect(updateGoals).toHaveBeenCalledWith(MIGRATED_GOALS);

    // Wait for the async save to resolve
    await vi.waitFor(() => {
      expect(mockMarkGoalUnitMigrated).toHaveBeenCalledWith(2026, "cycling");
    });
  });

  it("does not mark migrated when save fails", async () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: MIGRATED_GOALS,
      needsSave: true,
    });
    const saveError = new Error("Firestore unavailable");
    updateGoals.mockRejectedValue(saveError);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() => useGoalMigration(GOALS_DATA, 2026, "cycling", true, updateGoals));

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to save migrated goals for 2026/cycling:",
        saveError
      );
    });

    expect(mockMarkGoalUnitMigrated).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("marks migrated without saving when needsSave is false", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: GOALS_DATA,
      needsSave: false,
    });

    renderHook(() => useGoalMigration(GOALS_DATA, 2026, "cycling", true, updateGoals));

    expect(updateGoals).not.toHaveBeenCalled();
    expect(mockMarkGoalUnitMigrated).toHaveBeenCalledWith(2026, "cycling");
  });

  it("does not re-trigger on rerender", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: MIGRATED_GOALS,
      needsSave: true,
    });

    const { rerender } = renderHook(() =>
      useGoalMigration(GOALS_DATA, 2026, "cycling", true, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledTimes(1);

    rerender();

    // Should not trigger again due to ref guard
    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledTimes(1);
  });
});
