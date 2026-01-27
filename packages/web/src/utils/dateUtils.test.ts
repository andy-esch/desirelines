import { describe, it, expect } from "vitest";
import {
  toLocalDateString,
  parseLocalDate,
  parseLocalDateStrict,
  getTodayString,
  addDays,
  isSameDay,
  formatDisplayDate,
  generateDateRange,
} from "./dateUtils";

describe("toLocalDateString", () => {
  it("formats a date as YYYY-MM-DD", () => {
    const date = new Date(2026, 0, 15); // Jan 15, 2026
    expect(toLocalDateString(date)).toBe("2026-01-15");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(toLocalDateString(date)).toBe("2026-01-05");

    const date2 = new Date(2026, 8, 9); // Sep 9, 2026
    expect(toLocalDateString(date2)).toBe("2026-09-09");
  });

  it("handles end of year", () => {
    const date = new Date(2026, 11, 31); // Dec 31, 2026
    expect(toLocalDateString(date)).toBe("2026-12-31");
  });

  it("handles beginning of year", () => {
    const date = new Date(2026, 0, 1); // Jan 1, 2026
    expect(toLocalDateString(date)).toBe("2026-01-01");
  });

  it("ignores time component", () => {
    const morning = new Date(2026, 0, 15, 6, 30);
    const evening = new Date(2026, 0, 15, 23, 59);
    expect(toLocalDateString(morning)).toBe("2026-01-15");
    expect(toLocalDateString(evening)).toBe("2026-01-15");
  });
});

describe("parseLocalDate", () => {
  it("parses valid YYYY-MM-DD string", () => {
    const result = parseLocalDate("2026-01-15");
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(0); // January
    expect(result!.getDate()).toBe(15);
  });

  it("creates date at local midnight", () => {
    const result = parseLocalDate("2026-01-15");
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getSeconds()).toBe(0);
  });

  it("returns null for invalid format", () => {
    expect(parseLocalDate("2026/01/15")).toBeNull();
    expect(parseLocalDate("01-15-2026")).toBeNull();
    expect(parseLocalDate("2026-1-15")).toBeNull();
    expect(parseLocalDate("2026-01-5")).toBeNull();
    expect(parseLocalDate("invalid")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
  });

  it("returns null for invalid month", () => {
    expect(parseLocalDate("2026-13-15")).toBeNull();
    expect(parseLocalDate("2026-00-15")).toBeNull();
  });

  it("returns null for invalid day", () => {
    expect(parseLocalDate("2026-01-32")).toBeNull();
    expect(parseLocalDate("2026-01-00")).toBeNull();
  });

  it("returns null for impossible dates like Feb 30", () => {
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-02-29")).toBeNull(); // 2026 is not a leap year
  });

  it("handles leap year correctly", () => {
    expect(parseLocalDate("2024-02-29")).not.toBeNull(); // 2024 is a leap year
    expect(parseLocalDate("2024-02-29")!.getDate()).toBe(29);
  });

  it("roundtrips with toLocalDateString", () => {
    const original = new Date(2026, 5, 20); // June 20, 2026
    const dateStr = toLocalDateString(original);
    const parsed = parseLocalDate(dateStr);
    expect(parsed).not.toBeNull();
    expect(toLocalDateString(parsed!)).toBe(dateStr);
  });
});

describe("parseLocalDateStrict", () => {
  it("returns Date for valid input", () => {
    const result = parseLocalDateStrict("2026-01-15");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(15);
  });

  it("throws for invalid input", () => {
    expect(() => parseLocalDateStrict("invalid")).toThrow(
      'Invalid date string: "invalid". Expected YYYY-MM-DD format.'
    );
  });

  it("throws for invalid date like Feb 30", () => {
    expect(() => parseLocalDateStrict("2026-02-30")).toThrow();
  });
});

describe("getTodayString", () => {
  it("returns today's date in YYYY-MM-DD format", () => {
    const result = getTodayString();
    const now = new Date();

    // Should match today's date
    expect(result).toBe(toLocalDateString(now));
  });

  it("matches YYYY-MM-DD pattern", () => {
    const result = getTodayString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    const date = new Date(2026, 0, 15); // Jan 15
    const result = addDays(date, 7);
    expect(result.getDate()).toBe(22);
    expect(result.getMonth()).toBe(0);
  });

  it("subtracts with negative days", () => {
    const date = new Date(2026, 0, 15); // Jan 15
    const result = addDays(date, -7);
    expect(result.getDate()).toBe(8);
    expect(result.getMonth()).toBe(0);
  });

  it("handles month boundaries", () => {
    const date = new Date(2026, 0, 30); // Jan 30
    const result = addDays(date, 5);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(4);
  });

  it("handles year boundaries", () => {
    const date = new Date(2025, 11, 30); // Dec 30, 2025
    const result = addDays(date, 5);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(4);
  });

  it("does not mutate original date", () => {
    const date = new Date(2026, 0, 15);
    const originalTime = date.getTime();
    addDays(date, 7);
    expect(date.getTime()).toBe(originalTime);
  });

  it("handles zero days", () => {
    const date = new Date(2026, 0, 15);
    const result = addDays(date, 0);
    expect(toLocalDateString(result)).toBe(toLocalDateString(date));
  });
});

describe("isSameDay", () => {
  it("returns true for same calendar day", () => {
    const morning = new Date(2026, 0, 15, 8, 0);
    const evening = new Date(2026, 0, 15, 20, 0);
    expect(isSameDay(morning, evening)).toBe(true);
  });

  it("returns false for different days", () => {
    const day1 = new Date(2026, 0, 15);
    const day2 = new Date(2026, 0, 16);
    expect(isSameDay(day1, day2)).toBe(false);
  });

  it("returns false for same day different month", () => {
    const jan15 = new Date(2026, 0, 15);
    const feb15 = new Date(2026, 1, 15);
    expect(isSameDay(jan15, feb15)).toBe(false);
  });

  it("returns false for same day different year", () => {
    const y2025 = new Date(2025, 0, 15);
    const y2026 = new Date(2026, 0, 15);
    expect(isSameDay(y2025, y2026)).toBe(false);
  });

  it("handles midnight edge case", () => {
    const endOfDay = new Date(2026, 0, 15, 23, 59, 59);
    const startOfNext = new Date(2026, 0, 16, 0, 0, 0);
    expect(isSameDay(endOfDay, startOfNext)).toBe(false);
  });
});

describe("formatDisplayDate", () => {
  it("formats with default options (short month, numeric day)", () => {
    const date = new Date(2026, 0, 15);
    expect(formatDisplayDate(date)).toBe("Jan 15");
  });

  it("accepts custom format options", () => {
    const date = new Date(2026, 0, 15);
    const result = formatDisplayDate(date, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    expect(result).toContain("Jan");
    expect(result).toContain("15");
  });

  it("handles different months", () => {
    expect(formatDisplayDate(new Date(2026, 5, 20))).toBe("Jun 20");
    expect(formatDisplayDate(new Date(2026, 11, 25))).toBe("Dec 25");
  });
});

describe("generateDateRange", () => {
  it("generates all dates in range (inclusive)", () => {
    const result = generateDateRange("2026-01-01", "2026-01-05");
    expect(result).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });

  it("returns single date when from equals to", () => {
    const result = generateDateRange("2026-01-15", "2026-01-15");
    expect(result).toEqual(["2026-01-15"]);
  });

  it("returns empty array for invalid from date", () => {
    const result = generateDateRange("invalid", "2026-01-05");
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid to date", () => {
    const result = generateDateRange("2026-01-01", "invalid");
    expect(result).toEqual([]);
  });

  it("returns empty array when from is after to", () => {
    const result = generateDateRange("2026-01-10", "2026-01-05");
    expect(result).toEqual([]);
  });

  it("handles month boundaries", () => {
    const result = generateDateRange("2026-01-30", "2026-02-02");
    expect(result).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
  });

  it("handles year boundaries", () => {
    const result = generateDateRange("2025-12-30", "2026-01-02");
    expect(result).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });

  it("handles leap year February", () => {
    const result = generateDateRange("2024-02-28", "2024-03-01");
    expect(result).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  });

  it("handles two-week range (typical sparkline use case)", () => {
    const result = generateDateRange("2026-01-01", "2026-01-14");
    expect(result).toHaveLength(14);
    expect(result[0]).toBe("2026-01-01");
    expect(result[13]).toBe("2026-01-14");
  });
});
