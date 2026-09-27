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

  describe("without goals", () => {
    const signedInWith = (goalsData: Parameters<typeof transformToSportGoalData>[0]["goalsData"]) =>
      transformToSportGoalData({
        sport: "cycling",
        metrics: [{ date: "2026-03-01", distance: 160934.4 }],
        goalsData,
        demoGoals: undefined,
        sportConfig: mockSportConfig,
        userSettings,
        isAuthMode: true,
      });

    // Before, both fell back to the sport's default goal (2,500 mi), which the Impact
    // column and the goals card then measured against as if the athlete had set it.
    it.each([
      ["nothing saved", null],
      ["an empty goal list", { goals: [] }],
      ["goals still loading", undefined],
    ])("has no goal for a signed-in athlete with %s", (_, goalsData) => {
      expect(signedInWith(goalsData)).toMatchObject({
        currentValue: expect.closeTo(100, 3) as number,
        hasGoal: false,
        targetGoal: 0,
        impactGoal: 0,
        impactGoalLabel: "",
      });
    });

    it("has a goal once the athlete saves one", () => {
      const result = signedInWith({
        goals: [
          { id: "1", value: 1609344, label: "Target", createdAt: "", updatedAt: "", metric: "" },
        ],
      });
      expect(result.hasGoal).toBe(true);
      expect(result.targetGoal).toBeCloseTo(1000, 2);
    });

    it("always has the demo's goals in demo mode", () => {
      const result = transformToSportGoalData({
        sport: "cycling",
        metrics: [],
        goalsData: undefined,
        demoGoals: { conservative: 100, target: 200, stretch: 300 },
        sportConfig: mockSportConfig,
        userSettings,
        isAuthMode: false,
      });
      expect(result.hasGoal).toBe(true);
    });
  });
});
