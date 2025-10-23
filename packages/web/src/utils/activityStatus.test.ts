import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findLastActivityDate, isActivityDataStale, daysSinceLastActivity } from "./activityStatus";
import type { DistanceEntry } from "../types/activity";

describe("findLastActivityDate", () => {
  it("finds last activity when at end of data", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 10 },
      { x: "2025-01-03", y: 20 },
    ];

    const result = findLastActivityDate(data);

    expect(result).toEqual(new Date("2025-01-03"));
  });

  it("finds last activity when followed by extended data", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 10 },
      { x: "2025-01-03", y: 20 },
      { x: "2025-01-04", y: 20 }, // Extended
      { x: "2025-01-05", y: 20 }, // Extended
      { x: "2025-01-06", y: 20 }, // Extended
    ];

    const result = findLastActivityDate(data);

    expect(result).toEqual(new Date("2025-01-03"));
  });

  it("returns null for empty data", () => {
    const result = findLastActivityDate([]);

    expect(result).toBeNull();
  });

  it("returns null for single entry (no previous to compare)", () => {
    const data: DistanceEntry[] = [{ x: "2025-01-01", y: 100 }];

    const result = findLastActivityDate(data);

    expect(result).toBeNull();
  });

  it("returns null when all distances are identical", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 100 },
      { x: "2025-01-03", y: 100 },
    ];

    const result = findLastActivityDate(data);

    expect(result).toBeNull();
  });

  it("finds activity in middle of data", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-02", y: 10 },
      { x: "2025-01-03", y: 20 }, // Last activity
      { x: "2025-01-04", y: 20 },
      { x: "2025-01-05", y: 20 },
    ];

    const result = findLastActivityDate(data);

    expect(result).toEqual(new Date("2025-01-03"));
  });

  it("handles distance decreases (negative activity)", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100 },
      { x: "2025-01-02", y: 90 }, // Distance decreased
    ];

    const result = findLastActivityDate(data);

    // Distance changed = activity detected
    expect(result).toEqual(new Date("2025-01-02"));
  });

  it("handles fractional distance changes", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 100.0 },
      { x: "2025-01-02", y: 100.1 }, // Small change
      { x: "2025-01-03", y: 100.1 },
    ];

    const result = findLastActivityDate(data);

    expect(result).toEqual(new Date("2025-01-02"));
  });
});

describe("isActivityDataStale", () => {
  beforeEach(() => {
    // Mock current date to October 22, 2025
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for empty data", () => {
    expect(isActivityDataStale([])).toBe(true);
  });

  it("returns true when no activities found", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 100 },
      { x: "2025-10-02", y: 100 },
    ];

    expect(isActivityDataStale(data)).toBe(true);
  });

  it("returns false for recent activity (within 7 days)", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-20", y: 100 }, // 2 days ago
    ];

    expect(isActivityDataStale(data)).toBe(false);
  });

  it("returns false for activity exactly 7 days ago (boundary)", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-15", y: 100 }, // Exactly 7 days ago
    ];

    expect(isActivityDataStale(data)).toBe(false);
  });

  it("returns true for activity 8 days ago", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-14", y: 100 }, // 8 days ago
    ];

    expect(isActivityDataStale(data)).toBe(true);
  });

  it("returns true for very old activity", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-15", y: 100 }, // ~9 months ago
    ];

    expect(isActivityDataStale(data)).toBe(true);
  });

  it("ignores extended data at end when checking staleness", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-20", y: 100 }, // 2 days ago - actual activity
      { x: "2025-10-21", y: 100 }, // Extended
      { x: "2025-10-22", y: 100 }, // Extended (today)
    ];

    expect(isActivityDataStale(data)).toBe(false);
  });

  it("respects custom stale threshold", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-19", y: 100 }, // 3 days ago
    ];

    // With default threshold (7 days), should not be stale
    expect(isActivityDataStale(data)).toBe(false);

    // With custom threshold (2 days), should be stale
    expect(isActivityDataStale(data, 2)).toBe(true);
  });

  it("handles activity today", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-22", y: 100 }, // Today (0 days ago)
    ];

    expect(isActivityDataStale(data)).toBe(false);
  });

  it("handles activity yesterday", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-21", y: 100 }, // Yesterday (1 day ago)
    ];

    expect(isActivityDataStale(data)).toBe(false);
  });
});

describe("daysSinceLastActivity", () => {
  beforeEach(() => {
    // Mock current date to October 22, 2025
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for empty data", () => {
    expect(daysSinceLastActivity([])).toBeNull();
  });

  it("returns null when no activities found", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 100 },
      { x: "2025-10-02", y: 100 },
    ];

    expect(daysSinceLastActivity(data)).toBeNull();
  });

  it("calculates days since recent activity", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-20", y: 100 }, // 2 days ago
    ];

    expect(daysSinceLastActivity(data)).toBe(2);
  });

  it("returns 0 for activity today", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-22", y: 100 }, // Today
    ];

    expect(daysSinceLastActivity(data)).toBe(0);
  });

  it("calculates days for old activity", () => {
    const data: DistanceEntry[] = [
      { x: "2025-01-01", y: 0 },
      { x: "2025-01-15", y: 100 }, // 280 days ago
    ];

    const days = daysSinceLastActivity(data);
    expect(days).toBeGreaterThan(250); // Approximate check
  });

  it("ignores extended data at end", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-15", y: 100 }, // 7 days ago - last activity
      { x: "2025-10-16", y: 100 }, // Extended
      { x: "2025-10-22", y: 100 }, // Extended (today)
    ];

    expect(daysSinceLastActivity(data)).toBe(7);
  });

  it("handles single entry", () => {
    const data: DistanceEntry[] = [{ x: "2025-10-01", y: 100 }];

    expect(daysSinceLastActivity(data)).toBeNull();
  });

  it("returns 1 for activity yesterday", () => {
    const data: DistanceEntry[] = [
      { x: "2025-10-01", y: 0 },
      { x: "2025-10-21", y: 100 }, // Yesterday
    ];

    expect(daysSinceLastActivity(data)).toBe(1);
  });
});
