import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSportPageData } from "./useSportPageData";
import { useAuth } from "./useAuth";
import { useSportData } from "./useSportData";
import { useUserConfig } from "./useUserConfig";
import { useSidebarSportData } from "./useSidebarSportData";
import { usePriorYearMetrics } from "./usePriorYearMetrics";
import { logger } from "../lib/logger";

// Mock all dependency hooks
vi.mock("./useAuth");
vi.mock("./useSportData");
vi.mock("./useUserConfig");
vi.mock("./useSidebarSportData");
vi.mock("./usePriorYearMetrics");
vi.mock("./useGoalMigration", () => ({ useGoalMigration: vi.fn() }));
vi.mock("./useTrainingMomentum", () => ({
  useTrainingMomentum: () => ({ momentumLevel: "steady", trainingMomentum: 0.5 }),
}));
vi.mock("./useGoalStats", () => ({
  useGoalStats: () => ({
    nextGoal: null,
    nextGoalProgress: 0,
    nextGoalGap: 0,
    paceNeededForNextGoal: 0,
  }),
}));

describe("useSportPageData", () => {
  const mockSportConfig = {
    sportCategories: {
      cycling: {
        displayName: "Cycling",
        stravaTypes: ["Ride"],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: ["distance_meters", "time_minutes"],
        hasDistance: true,
        hasElevation: true,
      },
      running: {
        displayName: "Running",
        stravaTypes: ["Run"],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: ["distance_meters", "time_minutes"],
        hasDistance: true,
        hasElevation: true,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(useAuth).mockReturnValue({ user: { uid: "test-user" } } as any);
    vi.mocked(useSportData).mockReturnValue({
      metrics: [{ date: "2026-01-01", distance: 16093.4, time: 60, elevation: 100, activities: 1 }],
      sportConfig: mockSportConfig as any,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
    vi.mocked(useUserConfig).mockReturnValue({
      data: { distanceUnit: "miles", elevationUnit: "feet" },
      isLoading: false,
      error: null,
      updateData: vi.fn(),
    } as any);
    vi.mocked(useSidebarSportData).mockReturnValue({
      availableSports: ["cycling"],
      sportCounts: { cycling: 1 },
      isLoading: false,
    } as any);
    vi.mocked(usePriorYearMetrics).mockReturnValue({
      priorMetrics: {},
      isLoading: false,
    } as any);
  });

  it("coordinates data fetching and returns chart-ready data in correct units", async () => {
    const { result } = renderHook(() => useSportPageData("cycling", 2026));

    // 16093.4 meters should be 10 miles
    expect(result.current.currentValue).toBeCloseTo(10, 1);
    expect(result.current.unit).toBe("miles");
    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0]!.y).toBeCloseTo(10, 1);
  });

  it("switches units when metric selection changes", async () => {
    const { result } = renderHook(() => useSportPageData("cycling", 2026));

    // Default is distance (miles)
    expect(result.current.unit).toBe("miles");

    // onMetricChange is part of the SportPageData public interface
    result.current.onMetricChange("time_minutes");

    await waitFor(() => {
      expect(result.current.activeMetric).toBe("time_minutes");
    });

    expect(result.current.unit).toBe("hours");
  });

  it("calculates estimated year end correctly", () => {
    const { result } = renderHook(() => useSportPageData("cycling", 2026));

    // 10 miles on Day 1 should project to 3650 miles for the year
    expect(result.current.estimatedYearEnd).toBeCloseTo(3650, 0);
  });

  it("handles empty data gracefully", () => {
    vi.mocked(useSportData).mockReturnValue({
      metrics: [],
      sportConfig: mockSportConfig as any,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    const { result } = renderHook(() => useSportPageData("cycling", 2026));

    expect(result.current.currentValue).toBe(0);
    expect(result.current.chartData).toEqual([]);
  });

  it("warns when a goal's stored metric disagrees with the sport's primary metric", () => {
    // Cycling's primary metric is distance_meters. A goal stored with
    // metric: "time_minutes" indicates data corruption (e.g. copied across
    // sports). The warning is a diagnostic, not user-facing — but it should
    // still fire so the issue surfaces in logs.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    // First useUserConfig call returns preferences; second returns goals.
    // Match the ordering useSportPageData uses.
    vi.mocked(useUserConfig)
      .mockReturnValueOnce({
        data: { distanceUnit: "miles", elevationUnit: "feet" },
        isLoading: false,
        error: null,
        updateData: vi.fn(),
      } as any)
      .mockReturnValueOnce({
        data: {
          goals: [
            {
              id: "stale",
              value: 1609344,
              label: "Stale",
              metric: "time_minutes", // ← deliberately wrong for cycling
              createdAt: "2025-01-01T00:00:00Z",
              updatedAt: "2025-01-01T00:00:00Z",
            },
          ],
        },
        isLoading: false,
        error: null,
        updateData: vi.fn(),
      } as any);

    renderHook(() => useSportPageData("cycling", 2026));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("metric=time_minutes but sport primary metric is distance_meters")
    );
    warnSpy.mockRestore();
  });

  it("keeps defaultGoalsForYear referentially stable across renders for an override-sport", () => {
    // `running` has a metricConfig overrides block, so getMetricConfig returns a
    // fresh merged object on every call. The defaultGoalsForYear memo must still
    // be stable (it depends on the primitive config fields, not the object), or
    // the goals shown with nothing saved change identity on every render.
    vi.mocked(useUserConfig).mockReturnValue({
      data: { distanceUnit: "miles", elevationUnit: "feet" },
      isLoading: false,
      error: null,
      updateData: vi.fn(),
    } as any);

    const latestGoalsDefault = () => {
      const goalsCalls = vi
        .mocked(useUserConfig)
        .mock.calls.filter((c) => (c[0] as string) === "goals");
      return goalsCalls[goalsCalls.length - 1]?.[3];
    };

    const { rerender } = renderHook(() => useSportPageData("running", 2026));
    const first = latestGoalsDefault();
    rerender();
    const second = latestGoalsDefault();

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("does not warn when a goal's metric matches the sport's primary metric", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    vi.mocked(useUserConfig)
      .mockReturnValueOnce({
        data: { distanceUnit: "miles", elevationUnit: "feet" },
        isLoading: false,
        error: null,
        updateData: vi.fn(),
      } as any)
      .mockReturnValueOnce({
        data: {
          goals: [
            {
              id: "ok",
              value: 1609344,
              label: "OK",
              metric: "distance_meters",
              createdAt: "2025-01-01T00:00:00Z",
              updatedAt: "2025-01-01T00:00:00Z",
            },
          ],
        },
        isLoading: false,
        error: null,
        updateData: vi.fn(),
      } as any);

    renderHook(() => useSportPageData("cycling", 2026));

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("metric="));
    warnSpy.mockRestore();
  });

  describe("suggested goals", () => {
    /** useUserConfig as it answers for goals: the caller's default, or what's saved. */
    function goalsConfig({ loading = false, isSaved = false, error = null as Error | null } = {}) {
      const updateData = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useUserConfig).mockImplementation(((
        configType: string,
        _year?: number,
        _sport?: string,
        defaultValue?: unknown
      ) =>
        configType === "goals"
          ? { data: defaultValue, loading, isSaved, error, updateData }
          : { data: { distanceUnit: "miles", elevationUnit: "feet" }, loading: false }) as any);
      return updateData;
    }

    it("are what the page shows when the athlete has saved none for the sport and year", () => {
      goalsConfig();
      const { result } = renderHook(() => useSportPageData("cycling", 2026));
      expect(result.current.goalsSuggested).toBe(true);
      expect(result.current.goals.length).toBeGreaterThan(0);
    });

    it.each([
      ["once goals are saved", { isSaved: true }],
      ["while the goals load", { loading: true }],
    ])("aren't flagged %s", (_, state) => {
      goalsConfig(state);
      const { result } = renderHook(() => useSportPageData("cycling", 2026));
      expect(result.current.goalsSuggested).toBe(false);
    });

    it("are saved as shown", async () => {
      const updateData = goalsConfig();
      const { result } = renderHook(() => useSportPageData("cycling", 2026));

      await result.current.onSaveSuggestedGoals();

      const shown = vi
        .mocked(useUserConfig)
        .mock.calls.filter((c) => (c[0] as string) === "goals")
        .at(-1)?.[3];
      expect(updateData).toHaveBeenCalledWith(shown);
    });

    describe("when the saved goals couldn't be loaded", () => {
      it("shows none, offers none to save, and says they can't be changed", () => {
        // The default standing in isn't what's saved: saving it, or an edit of it, could put
        // suggestions over the athlete's real goals.
        goalsConfig({ error: new Error("permission-denied") });
        const { result } = renderHook(() => useSportPageData("cycling", 2026));

        expect(result.current.goalsUnavailable).toBe(true);
        expect(result.current.goals).toEqual([]);
        expect(result.current.goalsSuggested).toBe(false);
      });

      it("keeps the last good copy after the listener fails, and it can still be changed", () => {
        goalsConfig({ error: new Error("offline"), isSaved: true });
        const { result } = renderHook(() => useSportPageData("cycling", 2026));

        expect(result.current.goalsUnavailable).toBe(false);
        expect(result.current.goals.length).toBeGreaterThan(0);
        expect(result.current.goalsSuggested).toBe(false);
      });
    });
  });
});
