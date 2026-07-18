import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateDateRange, coerceTimeRange } from "./timeRange";

// Independent local-date oracle (plain Date, not the dateUtils helpers the function
// uses) so we aren't testing the implementation against itself.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("coerceTimeRange", () => {
  it("passes a valid range through", () => {
    expect(coerceTimeRange("4w", "ytd")).toBe("4w");
    expect(coerceTimeRange("all", "ytd")).toBe("all");
  });

  it("falls back for unknown, wrong-type, or missing values", () => {
    expect(coerceTimeRange("bogus", "ytd")).toBe("ytd");
    expect(coerceTimeRange(undefined, "4w")).toBe("4w");
    expect(coerceTimeRange(42, "2w")).toBe("2w");
  });
});

describe("calculateDateRange", () => {
  afterEach(() => vi.useRealTimers());

  const freeze = () => {
    vi.useFakeTimers();
    // Mid-morning, well clear of any date boundary, so the window is unambiguous.
    vi.setSystemTime(new Date(2026, 6, 15, 9, 30));
  };
  const daysAgo = (n: number) => {
    const d = new Date(2026, 6, 15);
    d.setDate(d.getDate() - n);
    return iso(d);
  };

  it("ends every bounded window at today (local)", () => {
    freeze();
    for (const r of ["2w", "4w", "2m", "6m", "ytd"] as const) {
      expect(calculateDateRange(r).to).toBe("2026-07-15");
    }
  });

  it("computes each preset's start relative to local today", () => {
    freeze();
    expect(calculateDateRange("2w").from).toBe(daysAgo(14));
    expect(calculateDateRange("4w").from).toBe(daysAgo(28));
    expect(calculateDateRange("2m").from).toBe(daysAgo(60));
    expect(calculateDateRange("6m").from).toBe(daysAgo(180));
    expect(calculateDateRange("ytd").from).toBe("2026-01-01");
  });

  it("returns an unbounded window for 'all'", () => {
    freeze();
    expect(calculateDateRange("all")).toEqual({});
  });
});
