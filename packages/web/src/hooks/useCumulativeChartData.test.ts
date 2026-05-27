import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useCumulativeChartData } from "./useCumulativeChartData";
import { testGoals } from "../utils/goalTestFixtures";

// Stub user-config-backed dependencies that useDangerThresholds pulls in.
vi.mock("./useUserConfig", () => ({
  useUserConfig: () => ({ data: null }),
}));
vi.mock("./useAuth", () => ({
  useAuth: () => ({ user: { uid: "test-user" }, loading: false }),
}));
vi.mock("../contexts/ServiceContext", () => ({
  useServices: () => ({}),
}));
vi.mock("./usePublicSportConfig", () => ({
  usePublicSportConfig: () => ({
    sportConfig: {
      version: "1.0",
      sportCategories: {
        cycling: { dangerPace: { valuePerDay: 20, unit: "miles" } },
        running: { dangerPace: { valuePerDay: 10, unit: "miles" } },
        yoga: { dangerPace: { valuePerDay: 2, unit: "hours" } },
      },
    },
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

describe("useCumulativeChartData", () => {
  const year = 2024;
  const goals = testGoals([{ id: "1", value: 1000, label: "Goal 1" }]);
  const distanceData = [
    { x: "2024-01-01T00:00:00Z", y: 10 },
    { x: "2024-01-02T00:00:00Z", y: 20 },
  ];

  it("should calculate basic stats correctly", () => {
    const { result } = renderHook(() =>
      useCumulativeChartData({
        year,
        goals,
        distanceData,
        showFullYear: true,
        sport: "cycling",
      })
    );

    expect(result.current.totalDistanceTraveled).toBe(20);
    expect(result.current.estimatedYearEnd).toBeGreaterThan(0);
  });

  it("should merge data correctly for Recharts", () => {
    const { result } = renderHook(() =>
      useCumulativeChartData({
        year,
        goals,
        distanceData,
        showFullYear: true,
        sport: "cycling",
      })
    );

    expect(result.current.mergedData.length).toBeGreaterThan(0);
    // Check if actual data is present
    const actualPoints = result.current.mergedData.filter((d) => d.actual !== undefined);
    expect(actualPoints.length).toBe(2);
  });

  it("should calculate goal lines", () => {
    const { result } = renderHook(() =>
      useCumulativeChartData({
        year,
        goals,
        distanceData,
        showFullYear: true,
        sport: "cycling",
      })
    );

    expect(result.current.goalLines).toHaveLength(1);
    expect(result.current.goalLines[0]!.goal.value).toBe(1000);
  });
});
