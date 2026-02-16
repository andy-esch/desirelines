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

  it("returns Infinity for unknown sport (disables danger zone)", () => {
    expect(getDangerThreshold("swimming")).toBe(Infinity);
    expect(getDangerThreshold("hiking")).toBe(Infinity);
    expect(getDangerThreshold("")).toBe(Infinity);
  });

  it("handles case-sensitive sport names", () => {
    // Should only match exact case — wrong case returns Infinity (no threshold)
    expect(getDangerThreshold("Cycling")).toBe(Infinity);
    expect(getDangerThreshold("RUNNING")).toBe(Infinity);
  });
});
