import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateYearStats,
  calculateAveragePace,
  daysBetween,
} from "./dateCalculations";

describe("calculateYearStats", () => {
  beforeEach(() => {
    // Mock current date to October 22, 2025
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates stats correctly for current year", () => {
    const stats = calculateYearStats(2025);

    expect(stats.startOfYear).toEqual(new Date(2025, 0, 1));
    expect(stats.endOfYear).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
    expect(stats.today).toEqual(new Date("2025-10-22T12:00:00Z"));

    // October 22 is day 295 of the year (31+28+31+30+31+30+31+31+30+22)
    expect(stats.daysElapsed).toBe(295);

    // From Oct 22 to Dec 31 23:59:59 = 71 days (9 in Oct + 30 in Nov + 31 in Dec + partial)
    expect(stats.daysRemaining).toBe(71);
  });

  it("calculates stats for past year", () => {
    const stats = calculateYearStats(2024);

    expect(stats.startOfYear).toEqual(new Date(2024, 0, 1));
    expect(stats.endOfYear).toEqual(new Date(2024, 11, 31, 23, 59, 59, 999));

    // Since we're mocked to Oct 22, 2025, a past year will show negative days remaining
    expect(stats.daysElapsed).toBeGreaterThan(365); // Past end of year
  });

  it("calculates stats for future year", () => {
    const stats = calculateYearStats(2026);

    expect(stats.startOfYear).toEqual(new Date(2026, 0, 1));
    expect(stats.endOfYear).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));

    // Future year will have negative days elapsed
    expect(stats.daysElapsed).toBeLessThan(0);
  });

  it("handles leap year correctly", () => {
    vi.setSystemTime(new Date("2024-03-01T12:00:00Z")); // 2024 is a leap year

    const stats = calculateYearStats(2024);

    // March 1 in leap year = 31 (Jan) + 29 (Feb) + 1 = 61 days
    expect(stats.daysElapsed).toBe(61);
  });

  it("calculates correct days at start of year", () => {
    vi.setSystemTime(new Date("2025-01-01T12:00:00")); // Local time, noon on Jan 1

    const stats = calculateYearStats(2025);

    expect(stats.daysElapsed).toBe(1); // Day 1
    expect(stats.daysRemaining).toBe(365); // From Jan 1 noon to Dec 31 23:59:59
  });

  it("calculates correct days at end of year", () => {
    vi.setSystemTime(new Date("2025-12-31T12:00:00")); // Local time, noon on Dec 31

    const stats = calculateYearStats(2025);

    expect(stats.daysElapsed).toBe(365); // All days elapsed
    expect(stats.daysRemaining).toBe(1); // Dec 31 00:00 to Dec 31 12:00 is still positive
  });
});

describe("calculateAveragePace", () => {
  beforeEach(() => {
    // Mock current date to October 22, 2025 (day 295)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates correct average pace", () => {
    const pace = calculateAveragePace(1500, 2025);

    // 1500 miles / 295 days = ~5.08 mi/day
    expect(pace).toBeCloseTo(5.08, 2);
  });

  it("returns zero pace for zero distance", () => {
    const pace = calculateAveragePace(0, 2025);
    expect(pace).toBe(0);
  });

  it("handles fractional distances correctly", () => {
    const pace = calculateAveragePace(123.45, 2025);

    // 123.45 / 295 = ~0.42 mi/day
    expect(pace).toBeCloseTo(0.42, 2);
  });

  it("returns zero for future year (negative days elapsed)", () => {
    const pace = calculateAveragePace(1000, 2026);

    // Future year = negative days elapsed, so pace should be 0
    expect(pace).toBe(0);
  });

  it("calculates high pace correctly", () => {
    const pace = calculateAveragePace(10000, 2025);

    // 10000 / 295 = ~33.9 mi/day
    expect(pace).toBeCloseTo(33.9, 1);
  });

  it("returns zero at start of year (day 1)", () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const pace = calculateAveragePace(0, 2025);
    expect(pace).toBe(0); // 0 / 1 = 0
  });

  it("calculates pace at start of year with distance", () => {
    vi.setSystemTime(new Date("2025-01-01T12:00:00Z"));

    const pace = calculateAveragePace(10, 2025);
    expect(pace).toBe(10); // 10 miles / 1 day = 10 mi/day
  });
});

describe("daysBetween", () => {
  it("calculates days between consecutive dates", () => {
    const from = new Date("2025-01-01");
    const to = new Date("2025-01-02");

    expect(daysBetween(from, to)).toBe(1);
  });

  it("calculates days between distant dates", () => {
    const from = new Date("2025-01-01");
    const to = new Date("2025-12-31");

    expect(daysBetween(from, to)).toBe(364); // Dec 31 is 364 days after Jan 1
  });

  it("returns zero for same date", () => {
    const date = new Date("2025-01-01");

    expect(daysBetween(date, date)).toBe(0);
  });

  it("returns negative for reversed dates", () => {
    const from = new Date("2025-01-10");
    const to = new Date("2025-01-05");

    expect(daysBetween(from, to)).toBe(-5);
  });

  it("handles dates with time components correctly", () => {
    const from = new Date("2025-01-01T08:00:00Z");
    const to = new Date("2025-01-02T20:00:00Z");

    // Should be 1 day (floors partial days)
    expect(daysBetween(from, to)).toBe(1);
  });

  it("calculates days across month boundaries", () => {
    const from = new Date("2025-01-28");
    const to = new Date("2025-02-03");

    expect(daysBetween(from, to)).toBe(6); // 3 days in Jan + 3 days in Feb
  });

  it("calculates days across year boundaries", () => {
    const from = new Date("2024-12-30");
    const to = new Date("2025-01-02");

    expect(daysBetween(from, to)).toBe(3); // 2 days in 2024 + 2 days in 2025
  });

  it("handles leap year correctly", () => {
    const from = new Date("2024-02-28");
    const to = new Date("2024-03-01");

    expect(daysBetween(from, to)).toBe(2); // Feb 28 -> Feb 29 -> Mar 1 = 2 days
  });

  it("handles non-leap year correctly", () => {
    const from = new Date("2025-02-28");
    const to = new Date("2025-03-01");

    expect(daysBetween(from, to)).toBe(1); // Feb 28 -> Mar 1 = 1 day
  });
});
