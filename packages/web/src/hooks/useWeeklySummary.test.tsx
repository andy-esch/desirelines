import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWeeklySummary } from "./useWeeklySummary";
import * as useAuthModule from "./useAuth";
import * as useVisibleSportsModule from "./useVisibleSports";
import * as useSportConfigModule from "./useSportConfig";
import * as useUserConfigModule from "./useUserConfig";
import * as useDailySportDataModule from "./useDailySportData";
import type { SportConfig } from "../api/activities";
import type React from "react";
import { TestServiceProvider } from "../contexts/ServiceContext";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useVisibleSports");
vi.mock("./useSportConfig");
vi.mock("./useUserConfig");
vi.mock("./useDailySportData");

describe("useWeeklySummary", () => {
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
        metrics: ["time_minutes", "activities"],
        hasDistance: false,
        hasElevation: false,
      },
    },
  };

  // Sample daily data for this week
  const mockDailyData = {
    cycling: {
      "2026-02-03": { distanceMeters: 50000, timeMinutes: 120, activities: 1 },
      "2026-02-04": { distanceMeters: 30000, timeMinutes: 90, activities: 1 },
    },
    running: {
      "2026-02-03": { distanceMeters: 10000, timeMinutes: 60, activities: 1 },
    },
    yoga: {
      "2026-02-03": { timeMinutes: 45, activities: 1 },
      "2026-02-04": { timeMinutes: 30, activities: 1 },
      "2026-02-05": { timeMinutes: 60, activities: 2 },
    },
  };

  let queryClient: QueryClient;

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <TestServiceProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </TestServiceProvider>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Default mocks for demo mode (no user)
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

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

    vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      isFetching: false,
      saveConfig: vi.fn(),
      isSaving: false,
      saveError: null,
    } as any);

    vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
      data: mockDailyData,
      isLoading: false,
      error: null,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  describe("loading states", () => {
    it("returns isLoading true when auth is loading", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: null,
        loading: true,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading true when visible sports are loading", () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: [],
        setVisibleSports: vi.fn(),
        isLoading: true,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading true when daily data is loading", () => {
      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: {},
        isLoading: true,
        error: null,
      });

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading false when all dependencies are loaded", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe("weekly totals calculation", () => {
    it("returns sportTotals for all visible sports", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      const sports = result.current.sportTotals.map((s) => s.sport);
      expect(sports).toEqual(["cycling", "running", "yoga"]);
    });

    it("sums distance for distance sports (converted to display units)", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      const cycling = result.current.sportTotals.find((s) => s.sport === "cycling");
      // 50000 + 30000 = 80000 meters = ~49.7 miles
      expect(cycling?.weeklyTotal).toBeCloseTo(49.7, 0);
      expect(cycling?.metricType).toBe("distance");
    });

    it("sums time for time sports (converted to hours)", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      const yoga = result.current.sportTotals.find((s) => s.sport === "yoga");
      // 45 + 30 + 60 = 135 minutes = 2.25 hours
      expect(yoga?.weeklyTotal).toBeCloseTo(2.25, 1);
      expect(yoga?.metricType).toBe("time");
    });

    it("correctly identifies metric units", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      const cycling = result.current.sportTotals.find((s) => s.sport === "cycling");
      const yoga = result.current.sportTotals.find((s) => s.sport === "yoga");

      expect(cycling?.metricUnit).toBe("mi");
      expect(yoga?.metricUnit).toBe("hrs"); // time sport shows hours
    });
  });

  describe("weekly goal calculation", () => {
    it("calculates prorated weekly goal from yearly goal", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      // Weekly goal = yearlyGoal * 7 / daysInYear
      result.current.sportTotals.forEach((sport) => {
        expect(sport.weeklyGoal).toBeGreaterThan(0);
      });
    });

    it("calculates achievement percentage", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      result.current.sportTotals.forEach((sport) => {
        if (sport.weeklyGoal > 0) {
          const expectedPct = (sport.weeklyTotal / sport.weeklyGoal) * 100;
          expect(sport.achievementPct).toBeCloseTo(expectedPct, 1);
        }
      });
    });
  });

  describe("week label", () => {
    it("returns weekLabel with date range format", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Week label should be in format "Mon D – Mon D" (e.g., "Feb 3 – Feb 5")
      expect(result.current.weekLabel).toMatch(/^\w+ \d+ – \w+ \d+$/);
    });
  });

  describe("spectrum colors", () => {
    it("assigns spectrum colors that are valid RGB strings", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      result.current.sportTotals.forEach((sport) => {
        expect(sport.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      });
    });

    it("assigns different colors to different sports", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      const colors = result.current.sportTotals.map((s) => s.color);
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBe(colors.length);
    });
  });

  describe("error handling", () => {
    it("returns null error when everything loads successfully", async () => {
      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });

    it("returns error from daily data fetch", async () => {
      const mockError = new Error("Failed to fetch daily data");
      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: {},
        isLoading: false,
        error: mockError,
      });

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.error).toBe(mockError);
      });
    });
  });

  describe("sport filtering", () => {
    it("filters visible sports to only those in config", async () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: ["cycling", "unknown_sport", "yoga"],
        setVisibleSports: vi.fn(),
        isLoading: false,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(2);
      });

      const sports = result.current.sportTotals.map((s) => s.sport);
      expect(sports).toEqual(["cycling", "yoga"]);
    });
  });

  describe("empty data handling", () => {
    it("returns zero totals when no daily data exists", async () => {
      vi.spyOn(useDailySportDataModule, "useDailySportData").mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: false,
        error: null,
      });

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      result.current.sportTotals.forEach((sport) => {
        expect(sport.weeklyTotal).toBe(0);
      });
    });
  });

  describe("unit preferences", () => {
    it("uses kilometers when user preference is set", async () => {
      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { distanceUnit: "kilometers" },
        isLoading: false,
        error: null,
        isFetching: false,
        saveConfig: vi.fn(),
        isSaving: false,
        saveError: null,
      } as any);

      const { result } = renderHook(() => useWeeklySummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportTotals.length).toBe(3);
      });

      const cycling = result.current.sportTotals.find((s) => s.sport === "cycling");
      expect(cycling?.metricUnit).toBe("km");
      // 80000 meters = 80 km
      expect(cycling?.weeklyTotal).toBeCloseTo(80, 0);
    });
  });
});
