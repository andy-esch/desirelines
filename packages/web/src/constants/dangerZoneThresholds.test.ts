import { describe, it, expect } from "vitest";
import { DANGER_ZONE_THRESHOLDS, getDangerThreshold } from "./dangerZoneThresholds";

describe("DANGER_ZONE_THRESHOLDS", () => {
  it("defines thresholds for all known sports", () => {
    expect(DANGER_ZONE_THRESHOLDS).toHaveProperty("cycling");
    expect(DANGER_ZONE_THRESHOLDS).toHaveProperty("running");
    expect(DANGER_ZONE_THRESHOLDS).toHaveProperty("yoga");
  });

  it("has correct threshold values", () => {
    expect(DANGER_ZONE_THRESHOLDS.cycling).toBe(20); // miles/day
    expect(DANGER_ZONE_THRESHOLDS.running).toBe(10); // miles/day
    expect(DANGER_ZONE_THRESHOLDS.yoga).toBe(120); // minutes/day
  });
});

describe("getDangerThreshold", () => {
  it("returns correct threshold for cycling", () => {
    expect(getDangerThreshold("cycling")).toBe(20);
  });

  it("returns correct threshold for running", () => {
    expect(getDangerThreshold("running")).toBe(10);
  });

  it("returns correct threshold for yoga", () => {
    expect(getDangerThreshold("yoga")).toBe(120);
  });

  it("returns default threshold (20) for unknown sport", () => {
    expect(getDangerThreshold("swimming")).toBe(20);
    expect(getDangerThreshold("hiking")).toBe(20);
    expect(getDangerThreshold("")).toBe(20);
  });

  it("handles case-sensitive sport names", () => {
    // Should only match exact case
    expect(getDangerThreshold("Cycling")).toBe(20); // default, not matched
    expect(getDangerThreshold("RUNNING")).toBe(20); // default, not matched
  });
});
