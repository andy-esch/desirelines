import { describe, it, expect } from "vitest";
import {
  processSportSparkline,
  mergeSparklineData,
  getSportMetadata,
  type ProcessedSportData,
} from "./multiSportChartUtils";
import type { SportConfig } from "./sportConfig";

describe("multiSportChartUtils", () => {
  const mockSportConfig: SportConfig = {
    version: "1.0.0",
    sportCategories: {
      cycling: {
        displayName: "Cycling",
        stravaTypes: ["Ride"],
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
        metrics: ["time_minutes", "activities"],
        hasDistance: false,
        hasElevation: false,
      },
    },
  };

  const range = { from: "2026-01-01", to: "2026-01-03" };

  describe("processSportSparkline", () => {
    it("normalizes daily data to 0-1 scale", () => {
      const sportData = {
        "2026-01-01": { distanceMeters: 1000, activities: 1, activityIds: [] },
        "2026-01-02": { distanceMeters: 2000, activities: 1, activityIds: [] },
        "2026-01-03": { distanceMeters: 1500, activities: 1, activityIds: [] },
      };

      const result = processSportSparkline("cycling", sportData, mockSportConfig, range, 2026);

      expect(result.sport).toBe("cycling");
      expect(result.data).toHaveLength(3);

      // Min (1000) -> 0
      // Max (2000) -> 1
      // Mid (1500) -> 0.5
      expect(result.data.find((d) => d.date === "2026-01-01")?.value).toBe(0);
      expect(result.data.find((d) => d.date === "2026-01-02")?.value).toBe(1);
      expect(result.data.find((d) => d.date === "2026-01-03")?.value).toBe(0.5);
    });

    it("handles time-based sports correctly", () => {
      const sportData = {
        "2026-01-01": { timeMinutes: 30, activities: 1, activityIds: [] },
        "2026-01-02": { timeMinutes: 60, activities: 1, activityIds: [] },
      };

      const result = processSportSparkline("yoga", sportData, mockSportConfig, range, 2026);

      // Should use timeMinutes as primary metric
      expect(result.rawData.find((d) => d.date === "2026-01-01")?.value).toBe(30);
      expect(result.rawData.find((d) => d.date === "2026-01-02")?.value).toBe(60);
    });
  });

  describe("mergeSparklineData", () => {
    it("stacks multiple sports into lanes without overlapping", () => {
      const cycling: ProcessedSportData = {
        sport: "cycling",
        displayName: "Cycling",
        data: [{ date: "2026-01-01", value: 1.0 }], // Top of its lane
        rawData: [{ date: "2026-01-01", value: 100 }],
        isDistanceSport: true,
        isTimeSport: false,
        lastActivityYear: 2026,
      };

      const yoga: ProcessedSportData = {
        sport: "yoga",
        displayName: "Yoga",
        data: [{ date: "2026-01-01", value: 0.0 }], // Bottom of its lane
        rawData: [{ date: "2026-01-01", value: 30 }],
        isDistanceSport: false,
        isTimeSport: true,
        lastActivityYear: 2026,
      };

      const merged = mergeSparklineData([cycling, yoga]);

      // With 2 sports:
      // Lane 0 (Yoga): [0.0, 0.5]
      // Lane 1 (Cycling): [0.5, 1.0]
      // Values are padded within lanes (80% data, 10% padding each side)

      const entry = merged[0];
      expect(entry.cycling).toBeGreaterThan(0.5);
      expect(entry.yoga).toBeLessThan(0.5);
      expect(entry.cycling_raw).toBe(100);
      expect(entry.yoga_raw).toBe(30);
    });
  });

  describe("getSportMetadata", () => {
    it("generates correct metadata with spectrum colors", () => {
      const data: ProcessedSportData[] = [
        {
          sport: "cycling",
          displayName: "Cycling",
          data: [],
          rawData: [],
          isDistanceSport: true,
          isTimeSport: false,
          lastActivityYear: 2026,
        },
        {
          sport: "yoga",
          displayName: "Yoga",
          data: [],
          rawData: [],
          isDistanceSport: false,
          isTimeSport: true,
          lastActivityYear: 2026,
        },
      ];

      const meta = getSportMetadata(data);

      expect(meta).toHaveLength(2);
      expect(meta[0].sport).toBe("cycling");
      expect(meta[0].color).toBeDefined();
      expect(meta[1].sport).toBe("yoga");
      expect(meta[1].color).not.toBe(meta[0].color);
    });
  });
});
