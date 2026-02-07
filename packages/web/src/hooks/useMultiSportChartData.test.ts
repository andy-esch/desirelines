/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiSportChartData } from "./useMultiSportChartData";
import * as useDailySportDataModule from "./useDailySportData";
import * as useVisibleSportsModule from "./useVisibleSports";
import * as useSportConfigModule from "./useSportConfig";
import type { SportConfig } from "../api/activities";

// Mock dependencies
vi.mock("./useDailySportData");
vi.mock("./useVisibleSports");
vi.mock("./useSportConfig");

describe("useMultiSportChartData", () => {
  const mockSportConfig: SportConfig = {
    version: "1.0.0",
    sport_categories: {
      cycling: {
        display_name: "Cycling",
        strava_types: ["Ride"],
        excluded_types: [],
        primary_metric: "distance_meters",
        metrics: ["distance_meters", "time_minutes"],
        has_distance: true,
        has_elevation: true,
      },
      running: {
        display_name: "Running",
        strava_types: ["Run"],
        excluded_types: [],
        primary_metric: "distance_meters",
        metrics: ["distance_meters", "time_minutes"],
        has_distance: true,
        has_elevation: true,
      },
      yoga: {
        display_name: "Yoga",
        strava_types: ["Yoga"],
        excluded_types: [],
        primary_metric: "time_minutes",
        metrics: ["time_minutes", "activities"],
        has_distance: false,
        has_elevation: false,
      },
      workout: {
        display_name: "Workout",
        strava_types: ["Workout"],
        excluded_types: [],
        primary_metric: "time_minutes",
        metrics: ["time_minutes", "activities"],
        has_distance: false,
        has_elevation: false,
      },
    },
  };

  // Sample data with activities on some days
  const mockDailyData = {
    cycling: {
      "2026-01-20": { distanceMeters: 50000, timeMinutes: 120, activities: 1 },
      "2026-01-22": { distanceMeters: 30000, timeMinutes: 90, activities: 1 },
    },
    running: {
      "2026-01-21": { distanceMeters: 10000, timeMinutes: 60, activities: 1 },
    },
    yoga: {
      "2026-01-20": { timeMinutes: 45, activities: 1 },
      "2026-01-23": { timeMinutes: 30, activities: 1 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
      sportConfig: mockSportConfig,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
      visibleSports: ["cycling", "running", "yoga"],
      setVisibleSports: vi.fn(),
      isLoading: false,
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
      error: null,
    });

    vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
      data: mockDailyData,
      isLoading: false,
      error: null,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loading states", () => {
    it("returns isLoading true when preferences are loading", () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: [],
        setVisibleSports: vi.fn(),
        isLoading: true,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading true when sport config is loading", () => {
      vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
        sportConfig: null,
        isLoading: true,
        error: null,
        retry: vi.fn(),
      });

      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading true when data is loading", () => {
      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: {},
        isLoading: true,
        error: null,
      } as any);

      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading false when all dependencies are loaded", () => {
      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("validSports filtering", () => {
    it("filters visible sports to only those in config", () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: ["cycling", "unknown_sport", "yoga"],
        setVisibleSports: vi.fn(),
        isLoading: false,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.validSports).toEqual(["cycling", "yoga"]);
    });
  });

  describe("sportMeta", () => {
    it("includes correct display names from config", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      const names = result.current.sportMeta.map((m) => m.displayName);
      expect(names).toEqual(["Cycling", "Running", "Yoga"]);
    });

    it("includes isDistanceSport flag based on primary metric", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      const cycling = result.current.sportMeta.find((m) => m.sport === "cycling");
      const yoga = result.current.sportMeta.find((m) => m.sport === "yoga");

      expect(cycling?.isDistanceSport).toBe(true);
      expect(yoga?.isDistanceSport).toBe(false);
    });

    it("includes isTimeSport flag based on primary metric", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      const cycling = result.current.sportMeta.find((m) => m.sport === "cycling");
      const yoga = result.current.sportMeta.find((m) => m.sport === "yoga");

      expect(cycling?.isTimeSport).toBe(false);
      expect(yoga?.isTimeSport).toBe(true);
    });

    it("assigns spectrum colors that are valid RGB strings", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      result.current.sportMeta.forEach((meta) => {
        expect(meta.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
        expect(meta.textColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      });
    });

    it("assigns different colors to different sports", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      const colors = result.current.sportMeta.map((m) => m.color);
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBe(colors.length);
    });

    it("text colors are darker than main colors", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      result.current.sportMeta.forEach((meta) => {
        // Parse RGB values
        const mainMatch = meta.color.match(/rgb\((\d+), (\d+), (\d+)\)/);
        const textMatch = meta.textColor.match(/rgb\((\d+), (\d+), (\d+)\)/);

        if (mainMatch && textMatch) {
          const mainSum = parseInt(mainMatch[1]) + parseInt(mainMatch[2]) + parseInt(mainMatch[3]);
          const textSum = parseInt(textMatch[1]) + parseInt(textMatch[2]) + parseInt(textMatch[3]);
          // Text color should be darker (lower sum of RGB values)
          expect(textSum).toBeLessThanOrEqual(mainSum);
        }
      });
    });
  });

  describe("spectrum colors edge cases", () => {
    it("handles single sport (no interpolation needed)", () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: ["cycling"],
        setVisibleSports: vi.fn(),
        isLoading: false,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      const { result } = renderHook(() => useMultiSportChartData());

      expect(result.current.sportMeta.length).toBe(1);
      expect(result.current.sportMeta[0].color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });

    it("handles many sports (full spectrum interpolation)", () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: ["cycling", "running", "yoga", "workout"],
        setVisibleSports: vi.fn(),
        isLoading: false,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: { ...mockDailyData, workout: {} },
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useMultiSportChartData());

      expect(result.current.sportMeta.length).toBe(4);
      // First should be magenta-ish, last should be orange-ish
      const firstColor = result.current.sportMeta[0].color;
      const lastColor = result.current.sportMeta[3].color;
      expect(firstColor).not.toBe(lastColor);
    });
  });

  describe("unifiedChartData", () => {
    it("includes all dates in the range (dense array)", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      // Should have entries for each day in the 2-week range
      expect(result.current.unifiedChartData.length).toBeGreaterThan(0);
      // All entries should have a date
      result.current.unifiedChartData.forEach((entry) => {
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it("includes normalized values for each sport", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      if (result.current.unifiedChartData.length > 0) {
        const entry = result.current.unifiedChartData[0];
        // Should have keys for each sport
        expect("cycling" in entry).toBe(true);
        expect("running" in entry).toBe(true);
        expect("yoga" in entry).toBe(true);
      }
    });

    it("includes raw values with _raw suffix for tooltip", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      if (result.current.unifiedChartData.length > 0) {
        const entry = result.current.unifiedChartData[0];
        // Should have raw value keys
        expect("cycling_raw" in entry).toBe(true);
        expect("running_raw" in entry).toBe(true);
        expect("yoga_raw" in entry).toBe(true);
      }
    });

    it("normalized values are between 0 and 1", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      result.current.unifiedChartData.forEach((entry) => {
        ["cycling", "running", "yoga"].forEach((sport) => {
          const value = entry[sport] as number;
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        });
      });
    });

    it("stacks sports in vertical lanes (values don't overlap)", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      if (result.current.unifiedChartData.length > 0) {
        // With 3 sports, each lane is ~0.33 height
        // Sports should be in different vertical ranges
        const entry = result.current.unifiedChartData[0];
        const cyclingVal = entry.cycling as number;
        const runningVal = entry.running as number;
        const yogaVal = entry.yoga as number;

        // They should be in different thirds of the 0-1 range
        // (exact values depend on lane calculation)
        const values = [cyclingVal, runningVal, yogaVal].sort((a, b) => a - b);
        // Adjacent values should have some separation
        // With 3 sports, min gap is ~0.067 (1/3 height * 20% padding), so we check > 0.05
        expect(values[1] - values[0]).toBeGreaterThan(0.05);
        expect(values[2] - values[1]).toBeGreaterThan(0.05);
      }
    });
  });

  describe("sparklineData", () => {
    it("includes rawData for each sport", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      result.current.sparklineData.forEach((sportData) => {
        expect(sportData.rawData).toBeDefined();
        expect(Array.isArray(sportData.rawData)).toBe(true);
      });
    });

    it("rawData contains actual metric values (not normalized)", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      const cyclingData = result.current.sparklineData.find((s) => s.sport === "cycling");
      // Find the entry for 2026-01-20 which has 50000 meters
      const jan20Entry = cyclingData?.rawData.find((d) => d.date === "2026-01-20");
      if (jan20Entry) {
        // Raw value should be the distance in meters
        expect(jan20Entry.value).toBe(50000);
      }
    });

    it("normalized data maps to 0-1 range", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      result.current.sparklineData.forEach((sportData) => {
        sportData.data.forEach((entry) => {
          expect(entry.value).toBeGreaterThanOrEqual(0);
          expect(entry.value).toBeLessThanOrEqual(1);
        });
      });
    });
  });

  describe("hasAnyData", () => {
    it("returns true when there is activity data", () => {
      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.hasAnyData).toBe(true);
    });

    it("returns false when all sports have empty data", () => {
      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.hasAnyData).toBe(false);
    });
  });

  describe("timeRange state", () => {
    it("defaults to 2weeks", () => {
      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.timeRange).toBe("2weeks");
    });

    it("can be changed via setTimeRange", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      act(() => {
        result.current.setTimeRange("4weeks");
      });

      expect(result.current.timeRange).toBe("4weeks");
    });
  });

  describe("layout calculations", () => {
    it("returns sparklineContainerHeight based on sport count", () => {
      const { result } = renderHook(() => useMultiSportChartData());
      // With 3 sports, should be at least MIN_SPORTS_FOR_HEIGHT * ROW_HEIGHT
      expect(result.current.sparklineContainerHeight).toBeGreaterThan(100);
    });

    it("returns activityPageSize based on sport count", () => {
      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.activityPageSize).toBeGreaterThanOrEqual(4);
      expect(result.current.activityPageSize).toBeLessThanOrEqual(7);
    });

    it("exports layout constants", () => {
      const { result } = renderHook(() => useMultiSportChartData());
      expect(result.current.MAX_SPORTS_DISPLAY).toBe(8);
      expect(result.current.SPARKLINE_ROW_HEIGHT).toBe(36);
      expect(result.current.SPARKLINE_XAXIS_HEIGHT).toBe(12);
    });
  });

  describe("lastActivityYear", () => {
    it("determines year from most recent activity date", () => {
      const { result } = renderHook(() => useMultiSportChartData());

      const cyclingMeta = result.current.sportMeta.find((m) => m.sport === "cycling");
      // Mock data has activities in 2026
      expect(cyclingMeta?.lastActivityYear).toBe(2026);
    });

    it("falls back to current year when no activity data", () => {
      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useMultiSportChartData());
      const currentYear = new Date().getFullYear();

      result.current.sportMeta.forEach((meta) => {
        expect(meta.lastActivityYear).toBe(currentYear);
      });
    });
  });
});
