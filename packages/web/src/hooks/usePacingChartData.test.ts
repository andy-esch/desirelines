import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { usePacingChartData } from "./usePacingChartData";

// Mock dependencies
vi.mock("./useUserConfig", () => ({
  useUserConfig: () => ({ data: {} }),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => ({ user: { uid: "test-user" }, loading: false }),
}));

vi.mock("../contexts/ServiceContext", () => ({
  useServices: () => ({}),
}));

describe("usePacingChartData", () => {
  // Test fixtures
  const year = 2024;
  const goals = [
    { id: "1", value: 3000, label: "Base Goal" },
    { id: "2", value: 5000, label: "Stretch Goal" },
  ];
  const distanceData = [
    { x: "2024-01-01T00:00:00Z", y: 10 },
    { x: "2024-01-02T00:00:00Z", y: 25 },
    { x: "2024-01-03T00:00:00Z", y: 50 },
  ];

  describe("date range calculations", () => {
    it("should calculate correct date range for full year view", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.startDate.getUTCFullYear()).toBe(2024);
      expect(result.current.startDate.getUTCMonth()).toBe(0); // January
      expect(result.current.startDate.getUTCDate()).toBe(1);

      // Full year should end Dec 31
      expect(result.current.displayEndDate.getUTCFullYear()).toBe(2024);
      expect(result.current.displayEndDate.getUTCMonth()).toBe(11); // December
      expect(result.current.displayEndDate.getUTCDate()).toBe(31);
    });

    it("should calculate correct date range for current view", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: false,
          sport: "cycling",
        })
      );

      // Current view should end at latest data point
      expect(result.current.displayEndDate.toISOString()).toBe("2024-01-03T00:00:00.000Z");
    });
  });

  describe("pacing goal calculations", () => {
    it("should calculate pacing goals for each goal", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.pacingGoals).toHaveLength(2);
      expect(result.current.pacingGoals[0].goal.value).toBe(3000);
      expect(result.current.pacingGoals[1].goal.value).toBe(5000);
    });

    it("should include pacing data arrays", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.pacingGoals[0].pacing.length).toBeGreaterThan(0);
      expect(result.current.pacingGoals[1].pacing.length).toBeGreaterThan(0);
    });
  });

  describe("merged data", () => {
    it("should merge actual and goal pacing data", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.mergedData.length).toBeGreaterThan(0);

      // Should have actual pacing data
      const pointsWithActual = result.current.mergedData.filter((d) => d.actual !== undefined);
      expect(pointsWithActual.length).toBeGreaterThan(0);
    });

    it("should sort merged data by date", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      const timestamps = result.current.mergedData.map((d) => d.date.getTime());
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b);
      expect(timestamps).toEqual(sortedTimestamps);
    });
  });

  describe("current values", () => {
    it("should calculate current actual pacing value", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.currentValues.actual).toBeGreaterThanOrEqual(0);
    });

    it("should calculate current goal pacing values", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.currentValues.goals).toHaveLength(2);
      result.current.currentValues.goals.forEach((goal) => {
        expect(goal).toHaveProperty("label");
        expect(goal).toHaveProperty("value");
        expect(goal).toHaveProperty("color");
      });
    });
  });

  describe("danger zone", () => {
    it("should provide danger threshold based on sport", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.dangerThreshold).toBeGreaterThan(0);
    });

    it("should calculate natural Y max", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.naturalYMax).toBeGreaterThan(0);
    });

    it("should provide adaptive Y-axis scaling and prevent excessive headroom", () => {
      // Scenario: User is far behind. Actual pace ~10, but goal requires 100.
      const { result } = renderHook(() =>
        usePacingChartData({
          year: 2024,
          goals: [{ id: "1", value: 36600, label: "Extreme" }], // Requires 100/day
          distanceData: [{ x: "2024-01-01T00:00:00Z", y: 10 }],
          showFullYear: true,
          sport: "cycling",
        })
      );

      // maxActualPace = 10
      // dangerThreshold = 20
      // absoluteCap = max(20 * 2, 10 * 1.2) = 40
      expect(result.current.naturalYMax).toBe(40);
    });

    it("should provide enough headroom for actual data exceeding danger threshold", () => {
      // Scenario: User is crushing it. Actual pace 25, danger threshold 20.
      const { result } = renderHook(() =>
        usePacingChartData({
          year: 2024,
          goals: [{ id: "1", value: 3660, label: "Easy" }], // Requires 10/day
          distanceData: [{ x: "2024-01-01T00:00:00Z", y: 25 }],
          showFullYear: true,
          sport: "cycling",
        })
      );

      // maxActualPace = 25
      // finalMax should be around 28.75 (certainly > 25)
      expect(result.current.naturalYMax).toBeGreaterThan(25);
      expect(result.current.naturalYMax).toBeCloseTo(28.75, 1);
    });

    it("should determine if danger zone should be shown", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(typeof result.current.shouldShowDangerZone).toBe("boolean");
    });
  });

  describe("edge cases", () => {
    it("should handle empty distance data", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData: [],
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.mergedData.length).toBeGreaterThanOrEqual(0);
      expect(result.current.currentValues.actual).toBe(0);
    });

    it("should handle empty goals array", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals: [],
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.pacingGoals).toHaveLength(0);
      expect(result.current.currentValues.goals).toHaveLength(0);
    });

    it("should handle single data point", () => {
      const { result } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData: [{ x: "2024-06-15T00:00:00Z", y: 1500 }],
          showFullYear: true,
          sport: "cycling",
        })
      );

      expect(result.current.mergedData.length).toBeGreaterThan(0);
    });

    it("should handle different sports", () => {
      const { result: cyclingResult } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "cycling",
        })
      );

      const { result: runningResult } = renderHook(() =>
        usePacingChartData({
          year,
          goals,
          distanceData,
          showFullYear: true,
          sport: "running",
        })
      );

      // Different sports may have different danger thresholds
      expect(cyclingResult.current.dangerThreshold).not.toBe(runningResult.current.dangerThreshold);
    });
  });
});
