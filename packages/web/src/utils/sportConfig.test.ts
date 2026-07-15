import { describe, it, expect } from "vitest";
import type { SportConfig } from "../api/activities";
import {
  SPORT_COLORS,
  getSportDisplayName,
  getPrimaryMetric,
  isDistanceSport,
  getSportMetrics,
  filterValidSports,
} from "./sportConfig";

/** Minimal sport config fixture for testing */
const mockSportConfig: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      hasDistance: true,
      hasElevation: true,
    },
    yoga: {
      displayName: "Yoga",
      stravaTypes: ["Yoga"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes", "activities"],
      hasDistance: false,
      hasElevation: false,
    },
    running: {
      displayName: "Running",
      stravaTypes: ["Run"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "activities"],
      hasDistance: true,
      hasElevation: true,
    },
  },
};

describe("SPORT_COLORS", () => {
  it("has colors defined for all expected sports", () => {
    const expectedSports = [
      "cycling",
      "running",
      "swimming",
      "ebike",
      "hiking",
      "walking",
      "winter_sports",
      "watersports",
      "yoga",
      "workout",
      "climbing",
      "racket_sports",
      "team_sports",
      "golf",
      "skating",
      "wheelchair",
    ];

    for (const sport of expectedSports) {
      expect(SPORT_COLORS[sport]).toBeDefined();
      expect(SPORT_COLORS[sport]).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);
    }
  });

  it("has unique colors for each sport", () => {
    const colors = Object.values(SPORT_COLORS);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(colors.length);
  });
});

describe("getSportDisplayName", () => {
  it("returns display name from config when available", () => {
    expect(getSportDisplayName("cycling", mockSportConfig)).toBe("Cycling");
    expect(getSportDisplayName("yoga", mockSportConfig)).toBe("Yoga");
  });

  it("formats sport key as fallback when not in config", () => {
    expect(getSportDisplayName("unknown_sport", mockSportConfig)).toBe("Unknown Sport");
    expect(getSportDisplayName("winter_sports", mockSportConfig)).toBe("Winter Sports");
  });

  it("handles null config gracefully", () => {
    expect(getSportDisplayName("cycling", null)).toBe("Cycling");
    expect(getSportDisplayName("team_sports", null)).toBe("Team Sports");
  });
});

describe("getPrimaryMetric", () => {
  it("returns primary metric from config for known sports", () => {
    expect(getPrimaryMetric("cycling", mockSportConfig)).toBe("distance_meters");
    expect(getPrimaryMetric("yoga", mockSportConfig)).toBe("time_minutes");
  });

  it("returns distance_meters as fallback for unknown sports", () => {
    expect(getPrimaryMetric("unknown_sport", mockSportConfig)).toBe("distance_meters");
  });

  it("handles null config gracefully", () => {
    expect(getPrimaryMetric("cycling", null)).toBe("distance_meters");
  });

  it("ignores userPrefs parameter for now (reserved for future)", () => {
    const userPrefs = { cycling: "time_minutes" };
    // Currently ignores user prefs, returns server default
    expect(getPrimaryMetric("cycling", mockSportConfig, userPrefs)).toBe("distance_meters");
  });
});

describe("isDistanceSport", () => {
  it("returns true for distance-based sports", () => {
    expect(isDistanceSport("cycling", mockSportConfig)).toBe(true);
    expect(isDistanceSport("running", mockSportConfig)).toBe(true);
  });

  it("returns false for non-distance sports", () => {
    expect(isDistanceSport("yoga", mockSportConfig)).toBe(false);
  });

  it("returns true for unknown sports (defaults to distance)", () => {
    expect(isDistanceSport("unknown", mockSportConfig)).toBe(true);
  });
});

describe("getSportMetrics", () => {
  it("returns metrics array for known sports", () => {
    const cyclingMetrics = getSportMetrics("cycling", mockSportConfig);
    expect(cyclingMetrics).toContain("distance_meters");
    expect(cyclingMetrics).toContain("time_minutes");
    expect(cyclingMetrics).toContain("elevation_meters");
  });

  it("returns empty array for unknown sports", () => {
    expect(getSportMetrics("unknown", mockSportConfig)).toEqual([]);
  });

  it("handles null config gracefully", () => {
    expect(getSportMetrics("cycling", null)).toEqual([]);
  });
});

describe("filterValidSports", () => {
  it("filters out sports not in config", () => {
    const visible = ["cycling", "yoga", "unknown_sport"];
    const filtered = filterValidSports(visible, mockSportConfig);

    expect(filtered).toContain("cycling");
    expect(filtered).toContain("yoga");
    expect(filtered).not.toContain("unknown_sport");
  });

  it("preserves order of valid sports", () => {
    const visible = ["yoga", "cycling", "running"];
    const filtered = filterValidSports(visible, mockSportConfig);

    expect(filtered).toEqual(["yoga", "cycling", "running"]);
  });

  it("returns original array when config is null", () => {
    const visible = ["cycling", "unknown"];
    const filtered = filterValidSports(visible, null);

    expect(filtered).toEqual(visible);
  });

  it("handles empty arrays", () => {
    expect(filterValidSports([], mockSportConfig)).toEqual([]);
  });
});
