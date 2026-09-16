import { describe, it, expect } from "vitest";
import { getIsoWeek, getMonthShareOfYear } from "./yearClock";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("getIsoWeek", () => {
  it.each([
    [utc(2026, 9, 13), 37], // a Sunday stays in the week that began Monday
    [utc(2026, 9, 14), 38],
    [utc(2026, 1, 1), 1], // Thursday: week 1
    [utc(2027, 1, 1), 53], // Friday: still the last week of 2026
    [utc(2024, 12, 30), 1], // Monday in the week holding 2025's first Thursday
  ])("numbers %s as week %i", (date, week) => {
    expect(getIsoWeek(date)).toBe(week);
  });
});

describe("getMonthShareOfYear", () => {
  it("counts whole months plus the day's share of the current month", () => {
    expect(getMonthShareOfYear(utc(2026, 9, 15))).toBeCloseTo((8 + 15 / 30) / 12);
  });

  it("fills the year on Dec 31", () => {
    expect(getMonthShareOfYear(utc(2026, 12, 31))).toBe(1);
  });

  it("uses February's length in leap years", () => {
    expect(getMonthShareOfYear(utc(2028, 2, 29))).toBeCloseTo(2 / 12);
  });
});
