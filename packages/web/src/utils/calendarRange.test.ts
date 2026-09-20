import { describe, it, expect, vi, afterEach } from "vitest";
import { getCalendarRange } from "./calendarRange";

describe("getCalendarRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("covers the trailing 12 months, starting the day after this date last year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0, 0));
    const { from, to } = getCalendarRange("trailing12");
    expect(from).toBe("2025-09-16");
    expect(to).toBe("2026-09-15");
  });

  it("starts the day after Feb 28 when today is a leap day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2028, 1, 29, 10, 0, 0));
    // A year back from Feb 29 rolls to Mar 1, which is already the day after Feb 28.
    expect(getCalendarRange("trailing12")).toMatchObject({ from: "2027-03-01", to: "2028-02-29" });
  });

  it("includes the leap day when the year before it had one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2029, 1, 28, 10, 0, 0));
    expect(getCalendarRange("trailing12")).toMatchObject({ from: "2028-02-29", to: "2029-02-28" });
  });

  it("covers a whole calendar year", () => {
    expect(getCalendarRange(2024)).toMatchObject({ from: "2024-01-01", to: "2024-12-31" });
  });
});
