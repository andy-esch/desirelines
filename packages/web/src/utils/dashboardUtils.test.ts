import { describe, it, expect } from "vitest";
import { transformToSportGoalData } from "./dashboardUtils";
import type { SportConfig } from "../api/activities";

describe("dashboardUtils", () => {
  const mockSportConfig: SportConfig = {
    version: "1.0.0",
    sport_categories: {
      cycling: {
        display_name: "Cycling",
        strava_types: ["Ride"],
        excluded_types: [],
        primary_metric: "distance_meters",
        metrics: ["distance_meters"],
        has_distance: true,
        has_elevation: true,
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
      index: 0,
      totalSports: 1,
      metrics: [{ date: "2026-01-01", distance: 1609.34 } as any], // 1 mile
      goalsData: {
        goals: [{ id: "1", value: 3218.68, label: "Target", createdAt: "", updatedAt: "" }],
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
    expect(result.isDistanceSport).toBe(true);
  });

  it("uses demo goals when not in auth mode", () => {
    const result = transformToSportGoalData({
      sport: "cycling",
      index: 0,
      totalSports: 1,
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
      index: 0,
      totalSports: 1,
      metrics: [],
      goalsData: {
        goals: [
          { id: "1", value: 10000, label: "Stretch", createdAt: "", updatedAt: "" },
          { id: "2", value: 5000, label: "Base", createdAt: "", updatedAt: "" },
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
