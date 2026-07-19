import { describe, it, expect } from "vitest";
import { formatActivityDate } from "./formatActivityDate";

describe("formatActivityDate", () => {
  it("formats month + day (no year) by default", () => {
    expect(formatActivityDate("2026-05-01T08:00:00")).toBe("May 1");
  });

  it("includes the year when asked", () => {
    expect(formatActivityDate("2026-05-01", { year: true })).toBe("May 1, 2026");
  });

  it("does not shift across timezones (parses Y-M-D parts, not a Date string)", () => {
    // A UTC-midnight parse would roll back a day in negative-offset zones; the
    // part-based parse keeps Jan 1 as Jan 1 regardless.
    expect(formatActivityDate("2026-01-01")).toBe("Jan 1");
  });

  it("keeps the calendar day for a small-hours Z-stamped start (the real API shape)", () => {
    // start_date_local arrives as wall-clock stamped with a misleading `Z`. Rendering
    // `new Date("2026-03-16T00:30:00Z")` in a UTC-negative zone (the suite is pinned to
    // one) would show Mar 15; slicing the Y-M-D keeps it Mar 16.
    expect(formatActivityDate("2026-03-16T00:30:00Z", { year: true })).toBe("Mar 16, 2026");
  });

  it("falls back to the raw date portion on malformed input", () => {
    expect(formatActivityDate("garbagey-input")).toBe("garbagey-i");
  });
});
