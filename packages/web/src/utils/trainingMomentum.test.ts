import { describe, it, expect } from "vitest";
import {
  filterActualActivityData,
  calculateDailyPaces,
  calculateLinearRegression,
  calculateTrainingMomentum,
  getMomentumLevel,
} from "./trainingMomentum";
import type { DistanceEntry } from "../types/activity";

describe("filterActualActivityData", () => {
  it("filters out extended flat-line data", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 110 },
      { x: "2025-01-03", y: 110 }, // Extended data
      { x: "2025-01-04", y: 110 }, // Extended data
      { x: "2025-01-05", y: 120 },
    ];

    const result = filterActualActivityData(data);

    expect(result).toEqual([
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 110 },
      { x: "2025-01-05", y: 120 },
    ]);
  });

  it("returns all data when no flat-line periods", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 110 },
      { x: "2025-01-03", y: 120 },
    ];

    const result = filterActualActivityData(data);

    expect(result).toEqual(data);
  });

  it("handles empty array", () => {
    const result = filterActualActivityData([]);
    expect(result).toEqual([]);
  });

  it("handles single entry", () => {
    const data: DistanceEntry[] = [{ x: "2025-01-01", y: 100 }];
    const result = filterActualActivityData(data);
    expect(result).toEqual(data);
  });

  it("includes first point even if same as second", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 100 }, // Same as first
      { x: "2025-01-03", y: 110 },
    ];

    const result = filterActualActivityData(data);

    expect(result).toEqual([
      { x: "2025-01-01", y: 100 }, // First point included
      { x: "2025-01-03", y: 110 },
    ]);
  });
});

describe("calculateDailyPaces", () => {
  it("calculates pace between consecutive days", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 110 }, // +10 miles in 1 day = 10 mi/day
      { x: "2025-01-03", y: 125 }, // +15 miles in 1 day = 15 mi/day
    ];

    const result = calculateDailyPaces(data);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(10.0, 1);
    expect(result[1]).toBeCloseTo(15.0, 1);
  });

  it("handles gaps in dates correctly", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-03", y: 120 }, // +20 miles in 2 days = 10 mi/day
    ];

    const result = calculateDailyPaces(data);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(10.0, 1);
  });

  it("returns empty array for single entry", () => {
    const data: DistanceEntry[] = [{ x: "2025-01-01", y: 100 }];
    const result = calculateDailyPaces(data);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty data", () => {
    const result = calculateDailyPaces([]);
    expect(result).toEqual([]);
  });

  it("skips entries with zero or negative time diff", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-02", y: 100 },
      { x: "2025-01-01", y: 110 }, // Date went backwards
      { x: "2025-01-03", y: 120 },
    ];

    const result = calculateDailyPaces(data);

    // Only valid transitions should be included
    expect(result.length).toBeLessThan(2);
  });
});

describe("calculateLinearRegression", () => {
  it("calculates positive slope for increasing values", () => {
    const values = [1, 2, 3, 4, 5];
    const result = calculateLinearRegression(values);

    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(1.0, 1);
  });

  it("calculates negative slope for decreasing values", () => {
    const values = [5, 4, 3, 2, 1];
    const result = calculateLinearRegression(values);

    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(-1.0, 1);
  });

  it("calculates zero slope for constant values", () => {
    const values = [5, 5, 5, 5, 5];
    const result = calculateLinearRegression(values);

    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(0.0, 1);
  });

  it("calculates correct slope for real-world pace data", () => {
    // Pace increasing from 8 to 12 mi/day over 5 days
    const values = [8.0, 9.0, 10.0, 11.0, 12.0];
    const result = calculateLinearRegression(values);

    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(1.0, 1); // +1 mi/day per day
  });

  it("returns null for insufficient data", () => {
    expect(calculateLinearRegression([])).toBeNull();
    expect(calculateLinearRegression([1])).toBeNull();
  });

  it("handles minimum data points (2)", () => {
    const values = [1, 2];
    const result = calculateLinearRegression(values);

    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(1.0, 1);
  });
});

describe("calculateTrainingMomentum", () => {
  it("returns null for empty data", () => {
    const result = calculateTrainingMomentum([], 10.0);
    expect(result).toBeNull();
  });

  it("returns null for insufficient data points", () => {
    const data: DistanceEntry[] = [{ x: "2025-01-01", y: 100 }];
    const result = calculateTrainingMomentum(data, 10.0);
    expect(result).toBeNull();
  });

  it("returns null when average pace is zero", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 0 },
    ];
    const result = calculateTrainingMomentum(data, 0);
    expect(result).toBeNull();
  });

  it("filters out extended data before calculating momentum", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 110 },
      { x: "2025-01-03", y: 110 }, // Extended
      { x: "2025-01-04", y: 110 }, // Extended
      { x: "2025-01-05", y: 110 }, // Extended
      { x: "2025-01-06", y: 120 },
      { x: "2025-01-07", y: 130 },
    ];

    const result = calculateTrainingMomentum(data, 10.0);

    // Should use only actual activity days (Jan 1, 2, 6, 7)
    expect(result).not.toBeNull();
  });

  it("calculates positive momentum for increasing pace", () => {
    // Pace ramping up from 8 to 12 mi/day
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 8 },
      { x: "2025-01-03", y: 17 },
      { x: "2025-01-04", y: 27 },
      { x: "2025-01-05", y: 38 },
      { x: "2025-01-06", y: 50 },
    ];

    const averagePace = 10.0;
    const result = calculateTrainingMomentum(data, averagePace);

    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0); // Positive momentum
  });

  it("calculates negative momentum for declining pace", () => {
    // Pace declining from 12 to 8 mi/day
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 12 },
      { x: "2025-01-03", y: 23 },
      { x: "2025-01-04", y: 33 },
      { x: "2025-01-05", y: 42 },
      { x: "2025-01-06", y: 50 },
    ];

    const averagePace = 10.0;
    const result = calculateTrainingMomentum(data, averagePace);

    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0); // Negative momentum
  });

  it("calculates near-zero momentum for steady pace", () => {
    // Consistent 10 mi/day pace
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 10 },
      { x: "2025-01-03", y: 20 },
      { x: "2025-01-04", y: 30 },
      { x: "2025-01-05", y: 40 },
      { x: "2025-01-06", y: 50 },
    ];

    const averagePace = 10.0;
    const result = calculateTrainingMomentum(data, averagePace);

    expect(result).not.toBeNull();
    expect(Math.abs(result!)).toBeLessThan(1.0); // Near zero
  });

  it("respects lookback days parameter", () => {
    const data: DistanceEntry[] = Array.from({ length: 30 }, (_, i) => ({
      x: `2025-01-${String(i + 1).padStart(2, "0")}`,
      y: i * 10,
    }));

    const resultDefault = calculateTrainingMomentum(data, 10.0); // 14 days default
    const resultShort = calculateTrainingMomentum(data, 10.0, 7); // 7 days

    expect(resultDefault).not.toBeNull();
    expect(resultShort).not.toBeNull();
    // Results may differ slightly due to different lookback windows
  });

  it("returns null when all filtered data is flat-line", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 100 },
      { x: "2025-01-03", y: 100 },
      { x: "2025-01-04", y: 100 },
    ];

    const result = calculateTrainingMomentum(data, 10.0);
    expect(result).toBeNull(); // No actual activity = no momentum
  });
});

describe("getMomentumLevel", () => {
  it("returns null when momentum is null", () => {
    expect(getMomentumLevel(null, false)).toBeNull();
  });

  it("returns 'stale' when data is stale regardless of momentum", () => {
    expect(getMomentumLevel(10.0, true)).toBe("stale");
    expect(getMomentumLevel(-10.0, true)).toBe("stale");
    expect(getMomentumLevel(0, true)).toBe("stale");
  });

  it("categorizes significantly-up correctly (>5% per week)", () => {
    expect(getMomentumLevel(6.0, false)).toBe("significantly-up");
    expect(getMomentumLevel(10.0, false)).toBe("significantly-up");
  });

  it("categorizes up correctly (1-5% per week)", () => {
    expect(getMomentumLevel(1.1, false)).toBe("up");
    expect(getMomentumLevel(3.0, false)).toBe("up");
    expect(getMomentumLevel(4.9, false)).toBe("up");
  });

  it("categorizes steady correctly (-1% to +1% per week)", () => {
    expect(getMomentumLevel(-0.9, false)).toBe("steady");
    expect(getMomentumLevel(0, false)).toBe("steady");
    expect(getMomentumLevel(0.9, false)).toBe("steady");
    expect(getMomentumLevel(-1.0, false)).toBe("steady"); // Boundary
    expect(getMomentumLevel(1.0, false)).toBe("steady"); // Boundary
  });

  it("categorizes down correctly (-5% to -1% per week)", () => {
    expect(getMomentumLevel(-1.1, false)).toBe("down");
    expect(getMomentumLevel(-3.0, false)).toBe("down");
    expect(getMomentumLevel(-4.9, false)).toBe("down");
  });

  it("categorizes significantly-down correctly (<-5% per week)", () => {
    expect(getMomentumLevel(-5.1, false)).toBe("significantly-down");
    expect(getMomentumLevel(-10.0, false)).toBe("significantly-down");
  });

  it("handles boundary values correctly", () => {
    expect(getMomentumLevel(5.0, false)).toBe("up"); // Exactly 5% is not "significantly-up"
    expect(getMomentumLevel(5.1, false)).toBe("significantly-up");

    expect(getMomentumLevel(-5.0, false)).toBe("down"); // Exactly -5% is not "significantly-down"
    expect(getMomentumLevel(-5.1, false)).toBe("significantly-down");
  });
});
