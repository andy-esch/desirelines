import { describe, it, expect } from "vitest";
import {
  calculateDesireLine,
  calculateCurrentAverageLine,
  estimateYearEndDistance,
  generateDefaultGoals,
  calculateActualPacing,
  calculateDynamicPacingGoal,
  validateGoals,
  type Goals,
} from "./goalCalculations";
import type { DistanceEntry } from "../types/activity";

describe("calculateDesireLine", () => {
  it("generates straight line from 0 to target", () => {
    // 365 miles over 365 days = 1 mile per day
    const line = calculateDesireLine(365, 2025, new Date("2025-01-03"));

    expect(line).toHaveLength(3);
    expect(line[0].x).toBe("2025-01-01");
    expect(line[0].y).toBeCloseTo(1, 1); // Day 1: 1 mile
    expect(line[1].y).toBeCloseTo(2, 1); // Day 2: 2 miles
    expect(line[2].y).toBeCloseTo(3, 1); // Day 3: 3 miles
  });

  it("stops at maxDate", () => {
    const line = calculateDesireLine(3650, 2025, new Date("2025-01-05"));
    expect(line).toHaveLength(5);
    expect(line[4].x).toBe("2025-01-05");
  });

  it("scales proportionally for full year", () => {
    const line = calculateDesireLine(1000, 2025, new Date("2025-12-31"));
    const lastEntry = line[line.length - 1];
    // Last day should be close to 1000 miles
    expect(lastEntry.y).toBeCloseTo(1000, 0);
  });

  it("handles 0 target distance", () => {
    const line = calculateDesireLine(0, 2025, new Date("2025-01-10"));
    expect(line).toHaveLength(10);
    expect(line[0].y).toBe(0);
    expect(line[9].y).toBe(0);
  });
});

describe("calculateCurrentAverageLine", () => {
  it("returns empty array for no data", () => {
    const line = calculateCurrentAverageLine([], 2025, new Date());
    expect(line).toEqual([]);
  });

  it("projects current pace to end of year", () => {
    const distanceTraveled = [
      { x: "2025-01-01", y: 10 },
      { x: "2025-01-02", y: 20 },
    ];
    // Average: 10 miles/day (20 miles in 2 days)
    // Projected: 10 * 365 = 3650 miles

    const line = calculateCurrentAverageLine(distanceTraveled, 2025, new Date("2025-01-02"));

    expect(line.length).toBeGreaterThan(0);
    // Day 1 should be (3650 * 1 / 365) ≈ 10 miles
    expect(line[0].y).toBeCloseTo(10, 0);
    // Day 2 should be (3650 * 2 / 365) ≈ 20 miles
    expect(line[1].y).toBeCloseTo(20, 0);
  });

  it("handles single day of data", () => {
    const distanceTraveled = [{ x: "2025-01-01", y: 15 }];
    // 15 miles in 1 day = 15 miles/day
    // Projected: 15 * 365 = 5475 miles

    const line = calculateCurrentAverageLine(distanceTraveled, 2025, new Date("2025-01-01"));

    expect(line).toHaveLength(1);
    expect(line[0].y).toBeCloseTo(15, 0);
  });
});

describe("estimateYearEndDistance", () => {
  it("projects current pace to year end", () => {
    const distanceTraveled = [
      { x: "2025-01-01", y: 10 },
      { x: "2025-01-02", y: 20 },
    ];
    // 10 miles/day * 365 days = 3650 miles
    const result = estimateYearEndDistance(distanceTraveled, 2025);
    expect(result).toBeCloseTo(3650, 0);
  });

  it("returns 0 for empty data", () => {
    expect(estimateYearEndDistance([], 2025)).toBe(0);
  });

  it("handles single day of data", () => {
    const distanceTraveled = [{ x: "2025-01-01", y: 15 }];
    // 15 miles/day * 365 days = 5475 miles
    const result = estimateYearEndDistance(distanceTraveled, 2025);
    expect(result).toBeCloseTo(5475, 0);
  });
});

describe("generateDefaultGoals", () => {
  it("generates 3 goals with 100-mile granularity", () => {
    const goals = generateDefaultGoals(2650);
    // 2650 rounds UP to 2700 (Math.ceil(2650 / 100) * 100)
    expect(goals).toHaveLength(3);
    expect(goals[0]).toEqual({ id: '1', value: 2600, label: 'Conservative' });
    expect(goals[1]).toEqual({ id: '2', value: 2700, label: 'Target' });
    expect(goals[2]).toEqual({ id: '3', value: 2800, label: 'Stretch' });
  });

  it("handles exact multiples of 100", () => {
    const goals = generateDefaultGoals(2500);
    expect(goals[0]?.value).toBe(2400);
    expect(goals[1]?.value).toBe(2500);
    expect(goals[2]?.value).toBe(2600);
  });

  it("supports custom granularity", () => {
    const goals = generateDefaultGoals(2650, 1000);
    // Rounds up to 3000
    expect(goals[0]?.value).toBe(2000);
    expect(goals[1]?.value).toBe(3000);
    expect(goals[2]?.value).toBe(4000);
  });

  it("does not go below 0 for conservative goal", () => {
    const goals = generateDefaultGoals(50);
    // Rounds up to 100, conservative = 0
    expect(goals[0]?.value).toBe(0);
    expect(goals[1]?.value).toBe(100);
    expect(goals[2]?.value).toBe(200);
  });

  it("returns Goals type with id and label", () => {
    const goals = generateDefaultGoals(1000);
    goals.forEach(goal => {
      expect(goal).toHaveProperty('id');
      expect(goal).toHaveProperty('value');
      expect(goal).toHaveProperty('label');
    });
  });
});

describe("validateGoals", () => {
  it("validates correct goals", () => {
    const goals: Goals = [
      { id: '1', value: 1000 },
      { id: '2', value: 2000 },
      { id: '3', value: 3000 },
    ];
    const result = validateGoals(goals);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects empty goals array", () => {
    const result = validateGoals([]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('At least one goal required');
  });

  it("rejects more than 5 goals", () => {
    const goals: Goals = [
      { id: '1', value: 1000 },
      { id: '2', value: 2000 },
      { id: '3', value: 3000 },
      { id: '4', value: 4000 },
      { id: '5', value: 5000 },
      { id: '6', value: 6000 },
    ];
    const result = validateGoals(goals);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Maximum 5 goals allowed');
  });

  it("rejects duplicate goal values", () => {
    const goals: Goals = [
      { id: '1', value: 2000 },
      { id: '2', value: 2000 },
      { id: '3', value: 3000 },
    ];
    const result = validateGoals(goals);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('All goal values must be unique');
  });

  it("accepts 1-5 goals with unique values", () => {
    const oneGoal: Goals = [{ id: '1', value: 1000 }];
    expect(validateGoals(oneGoal).valid).toBe(true);

    const fiveGoals: Goals = [
      { id: '1', value: 1000 },
      { id: '2', value: 2000 },
      { id: '3', value: 3000 },
      { id: '4', value: 4000 },
      { id: '5', value: 5000 },
    ];
    expect(validateGoals(fiveGoals).valid).toBe(true);
  });
});

describe("calculateActualPacing", () => {
  it("calculates average pace over time", () => {
    const distanceData: DistanceEntry[] = [
      { x: "2024-01-01", y: 10 }, // Day 1: 10 miles, pace = 10/1 = 10
      { x: "2024-01-02", y: 25 }, // Day 2: 25 miles, pace = 25/2 = 12.5
      { x: "2024-01-03", y: 45 }, // Day 3: 45 miles, pace = 45/3 = 15
    ];

    const pacing = calculateActualPacing(distanceData, 2024, new Date("2024-01-03"));

    expect(pacing).toHaveLength(3);
    expect(pacing[0]).toEqual({ x: "2024-01-01", y: 10 });
    expect(pacing[1]).toEqual({ x: "2024-01-02", y: 12.5 });
    expect(pacing[2]).toEqual({ x: "2024-01-03", y: 15 });
  });

  it("respects maxDate cutoff", () => {
    const distanceData: DistanceEntry[] = [
      { x: "2024-01-01", y: 10 },
      { x: "2024-01-02", y: 25 },
      { x: "2024-01-03", y: 45 },
    ];

    const pacing = calculateActualPacing(distanceData, 2024, new Date("2024-01-02"));

    expect(pacing).toHaveLength(2);
  });

  it("handles empty distance data", () => {
    const pacing = calculateActualPacing([], 2024, new Date("2024-12-31"));
    expect(pacing).toEqual([]);
  });
});

describe("calculateDynamicPacingGoal", () => {
  it("calculates pace needed to reach goal", () => {
    const distanceData: DistanceEntry[] = [
      { x: "2024-01-01", y: 10 }, // 365 days remain, need 2490 more
      { x: "2024-01-02", y: 20 }, // 364 days remain, need 2480 more
    ];

    const pacing = calculateDynamicPacingGoal(distanceData, 2500, 2024, new Date("2024-01-02"));

    expect(pacing).toHaveLength(2);
    // Day 1: (2500 - 10) / (366 - 1) = 2490 / 365 ≈ 6.82
    expect(pacing[0]?.y).toBeCloseTo(6.82, 2);
    // Day 2: (2500 - 20) / (366 - 2) = 2480 / 364 ≈ 6.81
    expect(pacing[1]?.y).toBeCloseTo(6.81, 2);
  });

  it("returns 0 pace when goal is already achieved", () => {
    const distanceData: DistanceEntry[] = [
      { x: "2024-01-01", y: 2500 }, // Already at goal
      { x: "2024-01-02", y: 2600 }, // Exceeded goal
    ];

    const pacing = calculateDynamicPacingGoal(distanceData, 2500, 2024, new Date("2024-01-02"));

    expect(pacing[0]?.y).toBe(0);
    expect(pacing[1]?.y).toBe(0);
  });

  it("handles near end of year", () => {
    const distanceData: DistanceEntry[] = [
      { x: "2024-12-31", y: 2000 },
    ];

    const pacing = calculateDynamicPacingGoal(distanceData, 2500, 2024, new Date("2024-12-31"));

    expect(pacing[0]?.y).toBeGreaterThan(0);
  });

  it("handles leap year", () => {
    const distanceData: DistanceEntry[] = [
      { x: "2024-01-01", y: 0 },
    ];

    const pacing = calculateDynamicPacingGoal(distanceData, 3660, 2024, new Date("2024-01-01"));

    // 2024 is leap year (366 days), need 3660 miles
    // Day 1: (3660 - 0) / (366 - 1) = 3660 / 365 ≈ 10.027
    expect(pacing[0]?.y).toBeCloseTo(10.027, 2);
  });

  it("handles empty distance data", () => {
    const pacing = calculateDynamicPacingGoal([], 2500, 2024, new Date("2024-12-31"));
    expect(pacing).toEqual([]);
  });
});
