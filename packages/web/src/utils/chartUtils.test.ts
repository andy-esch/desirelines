/**
 * Unit tests for chart utility functions.
 *
 * These tests verify the pure functions used for data transformation
 * in chart components. Each function is tested in isolation with
 * comprehensive edge cases.
 */

import { describe, it, expect } from "vitest";
import { getMetricValue, toDailyArray, getTimeRangeCutoff, normalizeToRange } from "./chartUtils";
import type { SportConfig } from "../api/activities";

// Mock sport config for testing
const mockSportConfig: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters"],
      hasDistance: true,
      hasElevation: true,
    },
    running: {
      displayName: "Running",
      stravaTypes: ["Run"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes"],
      hasDistance: true,
      hasElevation: true,
    },
    yoga: {
      displayName: "Yoga",
      stravaTypes: ["Yoga"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes"],
      hasDistance: false,
      hasElevation: false,
    },
  },
};

describe("chartUtils", () => {
  describe("getMetricValue", () => {
    it("returns distance for distance-based sports", () => {
      const activity = {
        distanceMeters: 5000,
        timeMinutes: 30,
        activities: 1,
        activityIds: [1],
      };

      expect(getMetricValue(activity, "cycling", mockSportConfig)).toBe(5000);
      expect(getMetricValue(activity, "running", mockSportConfig)).toBe(5000);
    });

    it("returns time for time-based sports", () => {
      const activity = {
        distanceMeters: 0,
        timeMinutes: 60,
        activities: 1,
        activityIds: [1],
      };

      expect(getMetricValue(activity, "yoga", mockSportConfig)).toBe(60);
    });

    it("returns 0 when distanceMeters is undefined for distance sport", () => {
      const activity = {
        timeMinutes: 30,
        activities: 1,
        activityIds: [1],
      };

      expect(getMetricValue(activity, "cycling", mockSportConfig)).toBe(0);
    });

    it("returns 0 when timeMinutes is undefined for time sport", () => {
      const activity = {
        distanceMeters: 5000,
        activities: 1,
        activityIds: [1],
      };

      expect(getMetricValue(activity, "yoga", mockSportConfig)).toBe(0);
    });

    it("handles null sport config (defaults to distance)", () => {
      const activity = {
        distanceMeters: 5000,
        timeMinutes: 30,
        activities: 1,
        activityIds: [1],
      };

      // With null config, defaults to distance metric
      expect(getMetricValue(activity, "cycling", null)).toBe(5000);
      expect(getMetricValue(activity, "unknown_sport", null)).toBe(5000);
    });

    it("handles unknown sport (defaults to distance)", () => {
      const activity = {
        distanceMeters: 3000,
        timeMinutes: 20,
        activities: 1,
        activityIds: [1],
      };

      expect(getMetricValue(activity, "unknown_sport", mockSportConfig)).toBe(3000);
    });
  });

  describe("toDailyArray", () => {
    it("converts map to sorted array", () => {
      const data = {
        "2026-01-03": { distanceMeters: 5000, timeMinutes: 30, activities: 1, activityIds: [3] },
        "2026-01-01": { distanceMeters: 3000, timeMinutes: 20, activities: 1, activityIds: [1] },
        "2026-01-02": { distanceMeters: 4000, timeMinutes: 25, activities: 1, activityIds: [2] },
      };

      const result = toDailyArray(data, "cycling", mockSportConfig);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: "2026-01-01", value: 3000 });
      expect(result[1]).toEqual({ date: "2026-01-02", value: 4000 });
      expect(result[2]).toEqual({ date: "2026-01-03", value: 5000 });
    });

    it("returns empty array for empty data", () => {
      const result = toDailyArray({}, "cycling", mockSportConfig);
      expect(result).toEqual([]);
    });

    it("uses correct metric based on sport", () => {
      const data = {
        "2026-01-01": { distanceMeters: 0, timeMinutes: 60, activities: 1, activityIds: [1] },
      };

      // Yoga is time-based
      const yogaResult = toDailyArray(data, "yoga", mockSportConfig);
      expect(yogaResult[0]!.value).toBe(60);

      // Cycling is distance-based
      const cyclingResult = toDailyArray(data, "cycling", mockSportConfig);
      expect(cyclingResult[0]!.value).toBe(0);
    });

    it("handles single entry", () => {
      const data = {
        "2026-01-15": { distanceMeters: 10000, timeMinutes: 60, activities: 1, activityIds: [1] },
      };

      const result = toDailyArray(data, "running", mockSportConfig);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ date: "2026-01-15", value: 10000 });
    });

    it("maintains date string format", () => {
      const data = {
        "2026-12-31": { distanceMeters: 1000, activities: 1, activityIds: [1] },
        "2026-01-01": { distanceMeters: 2000, activities: 1, activityIds: [2] },
      };

      const result = toDailyArray(data, "cycling", mockSportConfig);

      // String comparison sorts correctly for ISO date format
      expect(result[0]!.date).toBe("2026-01-01");
      expect(result[1]!.date).toBe("2026-12-31");
    });

    describe("with dateRange parameter (dense array)", () => {
      it("fills missing dates with zeros", () => {
        const data = {
          "2026-01-01": { distanceMeters: 3000, activities: 1, activityIds: [1] },
          "2026-01-03": { distanceMeters: 5000, activities: 1, activityIds: [2] },
        };

        const result = toDailyArray(data, "cycling", mockSportConfig, {
          from: "2026-01-01",
          to: "2026-01-03",
        });

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ date: "2026-01-01", value: 3000 });
        expect(result[1]).toEqual({ date: "2026-01-02", value: 0 }); // Filled with zero
        expect(result[2]).toEqual({ date: "2026-01-03", value: 5000 });
      });

      it("generates all zeros for empty data with date range", () => {
        const result = toDailyArray({}, "cycling", mockSportConfig, {
          from: "2026-01-01",
          to: "2026-01-03",
        });

        expect(result).toHaveLength(3);
        expect(result.every((d) => d.value === 0)).toBe(true);
        expect(result[0]!.date).toBe("2026-01-01");
        expect(result[2]!.date).toBe("2026-01-03");
      });

      it("generates single-day range", () => {
        const data = {
          "2026-01-15": { distanceMeters: 10000, activities: 1, activityIds: [1] },
        };

        const result = toDailyArray(data, "cycling", mockSportConfig, {
          from: "2026-01-15",
          to: "2026-01-15",
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ date: "2026-01-15", value: 10000 });
      });

      it("uses correct metric for time-based sports", () => {
        const data = {
          "2026-01-01": { distanceMeters: 0, timeMinutes: 60, activities: 1, activityIds: [1] },
          "2026-01-03": { distanceMeters: 0, timeMinutes: 90, activities: 1, activityIds: [2] },
        };

        const result = toDailyArray(data, "yoga", mockSportConfig, {
          from: "2026-01-01",
          to: "2026-01-03",
        });

        expect(result).toHaveLength(3);
        expect(result[0]!.value).toBe(60);
        expect(result[1]!.value).toBe(0); // Missing day
        expect(result[2]!.value).toBe(90);
      });

      it("handles two-week range typical of sparklines", () => {
        const data = {
          "2026-01-01": { distanceMeters: 5000, activities: 1, activityIds: [1] },
          "2026-01-07": { distanceMeters: 8000, activities: 1, activityIds: [2] },
          "2026-01-14": { distanceMeters: 6000, activities: 1, activityIds: [3] },
        };

        const result = toDailyArray(data, "cycling", mockSportConfig, {
          from: "2026-01-01",
          to: "2026-01-14",
        });

        expect(result).toHaveLength(14);
        expect(result[0]!.value).toBe(5000); // Jan 1
        expect(result[1]!.value).toBe(0); // Jan 2 (no activity)
        expect(result[6]!.value).toBe(8000); // Jan 7
        expect(result[13]!.value).toBe(6000); // Jan 14
      });
    });
  });

  describe("getTimeRangeCutoff", () => {
    // Use a fixed reference date for consistent tests
    const refDate = new Date("2026-01-15T12:00:00");

    it("calculates 2 weeks cutoff correctly", () => {
      const cutoff = getTimeRangeCutoff(refDate, "2weeks");
      expect(cutoff.getFullYear()).toBe(2026);
      expect(cutoff.getMonth()).toBe(0); // January
      expect(cutoff.getDate()).toBe(1); // 15 - 14 = 1
    });

    it("calculates 4 weeks cutoff correctly", () => {
      const cutoff = getTimeRangeCutoff(refDate, "4weeks");
      expect(cutoff.getFullYear()).toBe(2025);
      expect(cutoff.getMonth()).toBe(11); // December
      expect(cutoff.getDate()).toBe(18); // 15 - 28 = -13, wraps to Dec 18
    });

    it("calculates 2 months cutoff correctly", () => {
      const cutoff = getTimeRangeCutoff(refDate, "2months");
      expect(cutoff.getFullYear()).toBe(2025);
      expect(cutoff.getMonth()).toBe(10); // November (Jan - 2 = Nov)
      expect(cutoff.getDate()).toBe(15); // Same day of month
    });

    it("calculates 6 months cutoff correctly", () => {
      const cutoff = getTimeRangeCutoff(refDate, "6months");
      expect(cutoff.getFullYear()).toBe(2025);
      expect(cutoff.getMonth()).toBe(6); // July (Jan - 6 = July)
      expect(cutoff.getDate()).toBe(15); // Same day of month
    });

    it("calculates YTD cutoff correctly", () => {
      const cutoff = getTimeRangeCutoff(refDate, "ytd");
      expect(cutoff.getFullYear()).toBe(2026);
      expect(cutoff.getMonth()).toBe(0); // January
      expect(cutoff.getDate()).toBe(1); // First day
      expect(cutoff.getHours()).toBe(0);
      expect(cutoff.getMinutes()).toBe(0);
      expect(cutoff.getSeconds()).toBe(0);
      expect(cutoff.getMilliseconds()).toBe(0);
    });

    it("does not mutate the input date", () => {
      const originalDate = new Date("2026-01-15T12:00:00");
      const originalTime = originalDate.getTime();

      getTimeRangeCutoff(originalDate, "2weeks");

      // Original date should be unchanged
      expect(originalDate.getTime()).toBe(originalTime);
    });

    it("handles year boundary for 2 weeks", () => {
      // Jan 5 - 14 days should go to December
      const nearYearStart = new Date("2026-01-05T12:00:00");
      const cutoff = getTimeRangeCutoff(nearYearStart, "2weeks");

      expect(cutoff.getFullYear()).toBe(2025);
      expect(cutoff.getMonth()).toBe(11); // December
      expect(cutoff.getDate()).toBe(22); // Dec 22
    });

    it("handles month boundary for 2 months", () => {
      // March 31 - 2 months should handle Feb having fewer days
      const endOfMarch = new Date("2026-03-31T12:00:00");
      const cutoff = getTimeRangeCutoff(endOfMarch, "2months");

      // JavaScript Date handles this by rolling to next month
      // Mar 31 - 2 months = Jan 31
      expect(cutoff.getFullYear()).toBe(2026);
      expect(cutoff.getMonth()).toBe(0); // January
      expect(cutoff.getDate()).toBe(31);
    });
  });

  describe("normalizeToRange", () => {
    it("normalizes values to 0-1 range", () => {
      const data = [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 200 },
        { date: "2026-01-03", value: 150 },
      ];

      const result = normalizeToRange(data);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: "2026-01-01", value: 0 }); // min
      expect(result[1]).toEqual({ date: "2026-01-02", value: 1 }); // max
      expect(result[2]).toEqual({ date: "2026-01-03", value: 0.5 }); // middle
    });

    it("returns empty array for empty input", () => {
      const result = normalizeToRange([]);
      expect(result).toEqual([]);
    });

    it("returns 0.5 for all same values", () => {
      const data = [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 100 },
        { date: "2026-01-03", value: 100 },
      ];

      const result = normalizeToRange(data);

      expect(result).toHaveLength(3);
      expect(result[0]!.value).toBe(0.5);
      expect(result[1]!.value).toBe(0.5);
      expect(result[2]!.value).toBe(0.5);
    });

    it("handles single value (returns 0.5)", () => {
      const data = [{ date: "2026-01-01", value: 42 }];

      const result = normalizeToRange(data);

      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe(0.5);
    });

    it("preserves date values", () => {
      const data = [
        { date: "2026-01-01", value: 10 },
        { date: "2026-01-02", value: 20 },
      ];

      const result = normalizeToRange(data);

      expect(result[0]!.date).toBe("2026-01-01");
      expect(result[1]!.date).toBe("2026-01-02");
    });

    it("handles zero values correctly", () => {
      const data = [
        { date: "2026-01-01", value: 0 },
        { date: "2026-01-02", value: 100 },
      ];

      const result = normalizeToRange(data);

      expect(result[0]!.value).toBe(0); // 0 is min
      expect(result[1]!.value).toBe(1); // 100 is max
    });

    it("handles negative values correctly", () => {
      const data = [
        { date: "2026-01-01", value: -50 },
        { date: "2026-01-02", value: 50 },
        { date: "2026-01-03", value: 0 },
      ];

      const result = normalizeToRange(data);

      expect(result[0]!.value).toBe(0); // -50 is min
      expect(result[1]!.value).toBe(1); // 50 is max
      expect(result[2]!.value).toBe(0.5); // 0 is middle
    });

    it("handles large value ranges", () => {
      const data = [
        { date: "2026-01-01", value: 1 },
        { date: "2026-01-02", value: 1000000 },
      ];

      const result = normalizeToRange(data);

      expect(result[0]!.value).toBe(0);
      expect(result[1]!.value).toBe(1);
    });

    it("handles very small differences", () => {
      const data = [
        { date: "2026-01-01", value: 100.001 },
        { date: "2026-01-02", value: 100.002 },
      ];

      const result = normalizeToRange(data);

      expect(result[0]!.value).toBe(0);
      expect(result[1]!.value).toBe(1);
    });

    it("does not mutate input array", () => {
      const data = [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 200 },
      ];
      const originalData = JSON.stringify(data);

      normalizeToRange(data);

      expect(JSON.stringify(data)).toBe(originalData);
    });
  });
});
