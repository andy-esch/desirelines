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

  it("covers a whole calendar year", () => {
    expect(getCalendarRange(2024)).toMatchObject({ from: "2024-01-01", to: "2024-12-31" });
  });
});
