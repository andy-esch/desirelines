import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
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

const USER_ID = "user-abc-123";

const GOALS_DATA: GoalsForYear = {
  goals: [
    { id: "1", value: 2000, label: "Conservative", createdAt: "", updatedAt: "", metric: "" },
    { id: "2", value: 2500, label: "Target", createdAt: "", updatedAt: "", metric: "" },
  ],
};

const MIGRATED_GOALS: GoalsForYear = {
  goals: [
    { id: "1", value: 3218688, label: "Conservative", createdAt: "", updatedAt: "", metric: "" },
    { id: "2", value: 4023360, label: "Target", createdAt: "", updatedAt: "", metric: "" },
  ],
};

describe("useGoalMigration", () => {
  let updateGoals: Mock<(goals: GoalsForYear) => Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateGoals = vi.fn<(goals: GoalsForYear) => Promise<void>>().mockResolvedValue(undefined);
  });

  it("does nothing when goalsData is null", () => {
    renderHook(() => useGoalMigration(null, USER_ID, 2026, "cycling", true, false, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
    expect(updateGoals).not.toHaveBeenCalled();
  });

  it("does nothing for sports without a canonical unit (sessions)", () => {
    renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "racket_sports", false, false, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
    expect(updateGoals).not.toHaveBeenCalled();
  });

  it("runs time-sport migration with kind=time", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: GOALS_DATA,
      needsSave: false,
    });

    renderHook(() => useGoalMigration(GOALS_DATA, USER_ID, 2026, "yoga", false, true, updateGoals));

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledWith(
      GOALS_DATA,
      USER_ID,
      2026,
      "yoga",
      "time"
    );
  });

  it("does nothing when already migrated", () => {
    mockIsGoalUnitMigrated.mockReturnValue(true);

    renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
    expect(updateGoals).not.toHaveBeenCalled();
  });

  it("does nothing when goals array is empty", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    const emptyGoals: GoalsForYear = { goals: [] };

    renderHook(() =>
      useGoalMigration(emptyGoals, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).not.toHaveBeenCalled();
  });

  it("runs migration and saves when needsSave is true", async () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: MIGRATED_GOALS,
      needsSave: true,
    });

    renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledWith(
      GOALS_DATA,
      USER_ID,
      2026,
      "cycling",
      "distance"
    );
    expect(updateGoals).toHaveBeenCalledWith(MIGRATED_GOALS);

    // Wait for the async save to resolve
    await vi.waitFor(() => {
      expect(mockMarkGoalUnitMigrated).toHaveBeenCalledWith(USER_ID, 2026, "cycling");
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

    renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

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

    renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

    expect(updateGoals).not.toHaveBeenCalled();
    expect(mockMarkGoalUnitMigrated).toHaveBeenCalledWith(USER_ID, 2026, "cycling");
  });

  it("does not re-trigger on rerender with same context", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: MIGRATED_GOALS,
      needsSave: true,
    });

    const { rerender } = renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledTimes(1);

    rerender();

    // Should not trigger again due to context ref guard
    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("re-runs migration when sport changes", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: MIGRATED_GOALS,
      needsSave: true,
    });

    let sport = "cycling";
    const { rerender } = renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, sport, true, false, updateGoals)
    );

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledTimes(1);
    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenLastCalledWith(
      GOALS_DATA,
      USER_ID,
      2026,
      "cycling",
      "distance"
    );

    // Navigate to a different sport
    sport = "running";
    rerender();

    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledTimes(2);
    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenLastCalledWith(
      GOALS_DATA,
      USER_ID,
      2026,
      "running",
      "distance"
    );
  });

  it("passes userId to migration utilities for per-user isolation", () => {
    mockIsGoalUnitMigrated.mockReturnValue(false);
    mockMigrateGoalUnitsIfNeeded.mockReturnValue({
      goals: GOALS_DATA,
      needsSave: false,
    });

    renderHook(() =>
      useGoalMigration(GOALS_DATA, USER_ID, 2026, "cycling", true, false, updateGoals)
    );

    expect(mockIsGoalUnitMigrated).toHaveBeenCalledWith(USER_ID, 2026, "cycling");
    expect(mockMigrateGoalUnitsIfNeeded).toHaveBeenCalledWith(
      GOALS_DATA,
      USER_ID,
      2026,
      "cycling",
      "distance"
    );
    expect(mockMarkGoalUnitMigrated).toHaveBeenCalledWith(USER_ID, 2026, "cycling");
  });
});
