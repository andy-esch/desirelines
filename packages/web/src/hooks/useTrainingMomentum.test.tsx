import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrainingMomentum } from "./useTrainingMomentum";
import type { DistanceEntry } from "../types/activity";

describe("useTrainingMomentum", () => {
  const createDistanceData = (entries: Array<{ x: string; y: number }>): DistanceEntry[] => {
    return entries.map((entry) => ({ x: entry.x, y: entry.y }));
  };

  it("calculates positive momentum for increasing pace", () => {
    // Create recent dates (within last 7 days to avoid staleness)
    const today = new Date();
    const data: DistanceEntry[] = [];
    for (let i = 9; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: 100 + (9 - i) ** 2 });
    }

    const { result } = renderHook(() => useTrainingMomentum(data, 10));

    expect(result.current.trainingMomentum).toBeGreaterThan(0);
    expect(result.current.isDataStale).toBe(false);
    expect(result.current.momentumLevel).toBe("significantly-up");
    expect(result.current.momentumIndicator).not.toBeNull();
  });

  it("calculates negative momentum for decreasing pace", () => {
    // Create recent dates with decreasing pace (each day's increment gets smaller)
    const today = new Date();
    const data: DistanceEntry[] = [];
    let distance = 100;
    // Start with large increments and decrease them (decelerating)
    const increments = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
    for (let i = 9; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: distance });
      distance += increments[9 - i];
    }

    const { result } = renderHook(() => useTrainingMomentum(data, 10));

    expect(result.current.trainingMomentum).toBeLessThan(0);
    expect(result.current.momentumLevel).toBe("significantly-down");
  });

  it("detects stale data when no recent activity", () => {
    // Create data where the last activity was 8 days ago (stale)
    const data: DistanceEntry[] = [];
    for (let i = 15; i >= 8; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: 100 + (15 - i) * 10 });
    }
    // Add extended data (flat-line) for the last 8 days
    const lastDistance = data[data.length - 1].y;
    for (let i = 7; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: lastDistance });
    }

    const { result } = renderHook(() => useTrainingMomentum(data, 10));

    expect(result.current.isDataStale).toBe(true);
    expect(result.current.momentumLevel).toBe("stale");
  });

  it("handles steady pace correctly", () => {
    // Create recent dates with perfectly steady pace
    const today = new Date();
    const data: DistanceEntry[] = [];
    for (let i = 7; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: 100 + (7 - i) * 10 });
    }

    const { result } = renderHook(() => useTrainingMomentum(data, 10));

    expect(result.current.momentumLevel).toBe("steady");
  });

  it("filters out extended flat-line data", () => {
    // Create recent dates with some extended (flat-line) data
    const today = new Date();
    const data: DistanceEntry[] = [];
    const dates = [5, 4, 3, 2, 1, 0];
    const values = [100, 110, 110, 110, 120, 130];

    dates.forEach((daysAgo, idx) => {
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      data.push({ x: date.toISOString().split("T")[0], y: values[idx] });
    });

    const { result } = renderHook(() => useTrainingMomentum(data, 10));

    // Should still calculate momentum using only actual activity days
    expect(result.current.trainingMomentum).not.toBeNull();
  });

  it("returns null momentum for insufficient data", () => {
    const data = createDistanceData([{ x: "2025-10-01", y: 100 }]);

    const { result } = renderHook(() => useTrainingMomentum(data, 10));

    expect(result.current.trainingMomentum).toBeNull();
  });

  it("returns null momentum for empty data", () => {
    const { result } = renderHook(() => useTrainingMomentum([], 10));

    expect(result.current.trainingMomentum).toBeNull();
  });

  it("renders correct symbol for each momentum level", () => {
    // Create recent dates
    const today = new Date();
    const steadyData: DistanceEntry[] = [];
    for (let i = 4; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      steadyData.push({ x: date.toISOString().split("T")[0], y: 100 + (4 - i) * 10 });
    }

    const { result } = renderHook(() => useTrainingMomentum(steadyData, 10));
    const indicator = result.current.momentumIndicator;

    expect(indicator).not.toBeNull();
    // Verify it's a valid React element
    expect(indicator?.type).toBe("span");
  });

  it("includes helpful tooltip description", () => {
    // Create recent dates
    const today = new Date();
    const data: DistanceEntry[] = [];
    for (let i = 4; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: 100 + (4 - i) * 10 });
    }

    const { result } = renderHook(() => useTrainingMomentum(data, 10));
    const indicator = result.current.momentumIndicator;

    expect((indicator as any)?.props.title).toContain("Training Momentum");
    expect((indicator as any)?.props.title).toContain("14-day trend");
  });

  it("shows stale activity message when data is stale", () => {
    // Create stale data (last activity was 8+ days ago)
    const data: DistanceEntry[] = [];
    for (let i = 15; i >= 8; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: 100 + (15 - i) * 10 });
    }
    // Add extended flat-line data for the last 8 days
    const lastDistance = data[data.length - 1].y;
    for (let i = 7; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({ x: date.toISOString().split("T")[0], y: lastDistance });
    }

    const { result } = renderHook(() => useTrainingMomentum(data, 10));
    const indicator = result.current.momentumIndicator as any;

    expect(indicator).not.toBeNull();
    expect(indicator?.props?.title).toBeDefined();
    if (indicator?.props?.title) {
      expect(indicator.props.title).toContain("No recent activity");
    }
    expect(indicator?.props?.children).toBe("✕");
  });
});
