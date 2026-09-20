import { describe, it, expect } from "vitest";
import { getDaysInYear, getYearElapsedShare } from "./yearContext";

describe("getDaysInYear", () => {
  it.each([
    [2025, 365],
    [2026, 365],
    [2028, 366],
    [2000, 366],
    [1900, 365],
  ])("gives %i %i days", (year, days) => {
    expect(getDaysInYear(year)).toBe(days);
  });
});

describe("getYearElapsedShare", () => {
  it("divides by the year's length, counting today as elapsed", () => {
    // 258 / 365, not 258 / 366: daysElapsed and daysRemaining both count today, so
    // their sum is a day longer than the year.
    expect(getYearElapsedShare({ year: 2026, daysElapsed: 258 })).toBeCloseTo(258 / 365, 10);
    expect(getYearElapsedShare({ year: 2026, daysElapsed: 258 })).not.toBeCloseTo(258 / 366, 6);
  });

  it("counts the leap day", () => {
    expect(getYearElapsedShare({ year: 2028, daysElapsed: 183 })).toBeCloseTo(183 / 366, 10);
  });

  it("is 0 before the year starts and 1 once it is over", () => {
    expect(getYearElapsedShare({ year: 2026, daysElapsed: 0 })).toBe(0);
    expect(getYearElapsedShare({ year: 2026, daysElapsed: 365 })).toBe(1);
    // A past year's context reports every day elapsed; the share never exceeds 1.
    expect(getYearElapsedShare({ year: 2026, daysElapsed: 400 })).toBe(1);
  });
});
