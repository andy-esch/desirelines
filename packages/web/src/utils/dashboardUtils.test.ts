import { describe, it, expect } from "vitest";
import { transformToSportGoalData } from "./dashboardUtils";
import type { SportConfig } from "../api/activities";

describe("dashboardUtils", () => {
  const mockSportConfig: SportConfig = {
    version: "1.0.0",
    sportCategories: {
      cycling: {
        displayName: "Cycling",
        stravaTypes: ["Ride"],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: ["distance_meters"],
        hasDistance: true,
        hasElevation: true,
      },
    },
  };

  const userSettings = {
    distanceUnit: "miles" as const,
    elevationUnit: "feet" as const,
    defaultSport: "cycling",
  };

  it("transforms distance-based sports correctly (meters to miles)", () => {
    const result = transformToSportGoalData({
      sport: "cycling",
      metrics: [{ date: "2026-01-01", distance: 1609.34 }], // 1 mile
      goalsData: {
        goals: [
          { id: "1", value: 3218.68, label: "Target", createdAt: "", updatedAt: "", metric: "" },
        ],
      },
      demoGoals: undefined,
      sportConfig: mockSportConfig,
      userSettings,
      isAuthMode: true,
    });

    expect(result.displayName).toBe("Cycling");
    expect(result.currentValue).toBeCloseTo(1.0, 1);
    expect(result.targetGoal).toBeCloseTo(2.0, 1);
    expect(result.metricUnit).toBe("mi");
    expect(result.metricType).toBe("distance");
  });

  it("uses demo goals when not in auth mode", () => {
    const result = transformToSportGoalData({
      sport: "cycling",
      metrics: [],
      goalsData: undefined,
      demoGoals: { conservative: 100, target: 200, stretch: 300 },
      sportConfig: mockSportConfig,
      userSettings,
      isAuthMode: false,
    });

    expect(result.targetGoal).toBe(200);
    expect(result.impactGoal).toBe(100);
    expect(result.impactGoalLabel).toBe("Conservative");
  });

  it("calculates impact goal as the smallest user goal", () => {
    const result = transformToSportGoalData({
      sport: "cycling",
      metrics: [],
      goalsData: {
        goals: [
          { id: "1", value: 10000, label: "Stretch", createdAt: "", updatedAt: "", metric: "" },
          { id: "2", value: 5000, label: "Base", createdAt: "", updatedAt: "", metric: "" },
        ],
      },
      demoGoals: undefined,
      sportConfig: mockSportConfig,
      userSettings,
      isAuthMode: true,
    });

    // 5000 meters ≈ 3.1 miles
    expect(result.impactGoal).toBeCloseTo(3.1, 1);
    expect(result.impactGoalLabel).toBe("Base");
  });
});
