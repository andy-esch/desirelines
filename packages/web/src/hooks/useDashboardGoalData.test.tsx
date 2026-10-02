import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboardGoalData } from "./useDashboardGoalData";
import * as useAuthModule from "./useAuth";
import * as useVisibleSportsModule from "./useVisibleSports";
import * as useSportConfigModule from "./useSportConfig";
import * as usePreferencesModule from "./usePreferences";
import type { Preferences } from "../services/userConfigService";
import * as demoDataModule from "../utils/demoDataGenerator";
import type { SportConfig } from "../api/activities";
import type React from "react";
import { TestServiceProvider } from "../contexts/ServiceContext";
import { UserConfigProvider } from "../contexts/UserConfigProvider";
import { UserConfigService } from "../services/userConfigService";
import { MockAuthService } from "../services/auth/MockAuthService";
import * as activitiesApi from "../api/activities";
import { ACCOUNT_USER, accountServices, storedGoal } from "../test/fixtures/userConfig";
import { getUserSettings, goalMetersToDisplay } from "../utils/units";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useVisibleSports");
vi.mock("./useSportConfig");
vi.mock("./usePreferences");

describe("useDashboardGoalData", () => {
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

  let queryClient: QueryClient;

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <TestServiceProvider>
        <QueryClientProvider client={queryClient}>
          <UserConfigProvider>{children}</UserConfigProvider>
        </QueryClientProvider>
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

    vi.spyOn(usePreferencesModule, "useUnitSettings").mockReturnValue(getUserSettings(null));
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

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });
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

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading true when sport config is loading", () => {
      vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
        sportConfig: null,
        isLoading: true,
        error: null,
        retry: vi.fn(),
      });

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading false when all dependencies are loaded (demo mode)", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe("demo mode", () => {
    it("returns sportData for all visible sports", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      const sports = result.current.sportData.map((s) => s.sport);
      expect(sports).toEqual(["cycling", "running", "yoga"]);
    });

    it("includes display names from sport config", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      const names = result.current.sportData.map((s) => s.displayName);
      expect(names).toEqual(["Cycling", "Running", "Yoga"]);
    });

    it("assigns spectrum colors that are valid RGB strings", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      result.current.sportData.forEach((sport) => {
        expect(sport.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      });
    });

    it("correctly identifies distance vs time sports", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      const cycling = result.current.sportData.find((s) => s.sport === "cycling");
      const yoga = result.current.sportData.find((s) => s.sport === "yoga");

      expect(cycling?.metricType).toBe("distance");
      expect(cycling?.metricUnit).toBe("mi"); // default US units
      expect(yoga?.metricType).toBe("time");
      expect(yoga?.metricUnit).toBe("hrs"); // time sport shows hours
    });

    it("uses demo goals for target values", async () => {
      // Spy on demo goal generation to verify it's called
      const generateDemoGoalsSpy = vi.spyOn(demoDataModule, "generateDemoGoals");

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      // Demo goals should be called for each sport
      expect(generateDemoGoalsSpy).toHaveBeenCalled();

      // All sports should have a target goal
      result.current.sportData.forEach((sport) => {
        expect(sport.targetGoal).toBeGreaterThan(0);
      });
    });

    it("returns current YTD values from demo metrics", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      // All sports should have some current value (demo generates data)
      result.current.sportData.forEach((sport) => {
        expect(sport.currentValue).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("yearContext", () => {
    it("returns yearContext with current year", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.yearContext.year).toBe(new Date().getFullYear());
    });

    it("yearContext includes daysElapsed and daysRemaining", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.yearContext.daysElapsed).toBeGreaterThan(0);
      expect(result.current.yearContext.daysRemaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe("error handling", () => {
    it("returns null error when everything loads successfully", async () => {
      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
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

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(2);
      });

      const sports = result.current.sportData.map((s) => s.sport);
      expect(sports).toEqual(["cycling", "yoga"]);
    });

    it("handles empty visible sports", async () => {
      vi.spyOn(useVisibleSportsModule, "useVisibleSports").mockReturnValue({
        visibleSports: [],
        setVisibleSports: vi.fn(),
        isLoading: false,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
        error: null,
      });

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.sportData).toEqual([]);
    });
  });

  describe("unit preferences", () => {
    it("uses kilometers when user preference is set", async () => {
      vi.spyOn(usePreferencesModule, "useUnitSettings").mockReturnValue(
        getUserSettings({ distanceUnit: "kilometers" } as Preferences)
      );

      const { result } = renderHook(() => useDashboardGoalData(), { wrapper });

      await waitFor(() => {
        expect(result.current.sportData.length).toBe(3);
      });

      const cycling = result.current.sportData.find((s) => s.sport === "cycling");
      expect(cycling?.metricUnit).toBe("km");
    });
  });

  describe("signed in", () => {
    const year = new Date().getFullYear();

    function renderSignedIn(
      goalsBySport: Parameters<typeof accountServices>[1],
      prepare?: (db: ReturnType<typeof accountServices>["databaseService"]) => void
    ) {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: ACCOUNT_USER,
        loading: false,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
      vi.spyOn(activitiesApi, "fetchMultiSportMetrics").mockResolvedValue({
        cycling: [{ date: `${year}-03-01`, distance: 1_000_000 }],
        running: [{ date: `${year}-03-01`, distance: 500_000 }],
        yoga: [{ date: `${year}-03-01`, time: 600 }],
      });
      const services = accountServices(year, goalsBySport);
      prepare?.(services.databaseService);
      const rendered = renderHook(() => useDashboardGoalData(), {
        wrapper: ({ children }) => (
          <TestServiceProvider {...services}>
            <QueryClientProvider client={queryClient}>
              <UserConfigProvider>{children}</UserConfigProvider>
            </QueryClientProvider>
          </TestServiceProvider>
        ),
      });
      return { ...rendered, db: services.databaseService };
    }

    it("shows a goal saved elsewhere at once, with no reload or read of its own", async () => {
      // The sport page's save lands in the account's document; the store's one listener
      // brings it here. The dashboard used to hold its own copy, with no listener.
      const { result, db } = renderSignedIn({
        cycling: [storedGoal("target", 4_000_000, "Target")],
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const reads = vi.spyOn(db, "getDocument");

      await act(() =>
        new UserConfigService(undefined, "v1", {
          authService: new MockAuthService(ACCOUNT_USER),
          databaseService: db,
        }).updateConfigSection(
          "goals",
          { goals: [storedGoal("target", 5_000_000, "Target")], storageVersion: 2 },
          year,
          "running"
        )
      );

      await waitFor(() =>
        expect(result.current.sportData.find((s) => s.sport === "running")!.hasGoal).toBe(true)
      );
      const running = result.current.sportData.find((s) => s.sport === "running")!;
      expect(running.targetGoal).toBeCloseTo(goalMetersToDisplay(5_000_000, "miles"), 6);
      expect(reads).not.toHaveBeenCalled();
    });

    it("reports goals that couldn't be loaded as an error, not as no goal", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = renderSignedIn({}, (db) =>
        vi.spyOn(db, "subscribeToDocument").mockImplementation((_path, _onData, onError) => {
          onError?.(new Error("permission-denied"));
          return () => {};
        })
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.error).toBeInstanceOf(Error);
      // The listener stopped on the error; fetching again can't bring the goals back.
      expect(result.current.retry).toBeUndefined();
    });

    it("fetches the year's totals again when they failed", async () => {
      vi.spyOn(activitiesApi, "fetchMultiSportMetrics").mockRejectedValueOnce(new Error("timeout"));
      const { result } = renderSignedIn({});
      await waitFor(() => expect(result.current.error?.message).toBe("timeout"));

      act(() => result.current.retry!());

      await waitFor(() => expect(result.current.error).toBeNull());
      expect(result.current.retry).toBeUndefined();
      const cycling = result.current.sportData.find((s) => s.sport === "cycling")!;
      expect(cycling.currentValue).toBeGreaterThan(0);
    });

    it("measures a sport with saved goals against them", async () => {
      const { result } = renderSignedIn({
        cycling: [storedGoal("base", 3_000_000, "Base"), storedGoal("target", 4_000_000, "Target")],
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const cycling = result.current.sportData.find((s) => s.sport === "cycling")!;
      expect(cycling.hasGoal).toBe(true);
      expect(cycling.targetGoal).toBeCloseTo(goalMetersToDisplay(4_000_000, "miles"), 6);
      expect(cycling.impactGoal).toBeCloseTo(goalMetersToDisplay(3_000_000, "miles"), 6);
      expect(cycling.impactGoalLabel).toBe("Base");
    });

    it("gives a sport without saved goals no goal, not a default to measure against", async () => {
      const { result } = renderSignedIn({ cycling: [storedGoal("target", 4_000_000, "Target")] });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      for (const sport of ["running", "yoga"]) {
        const data = result.current.sportData.find((s) => s.sport === sport)!;
        expect(data.currentValue).toBeGreaterThan(0);
        expect(data).toMatchObject({
          hasGoal: false,
          targetGoal: 0,
          impactGoal: 0,
          impactGoalLabel: "",
        });
      }
    });
  });
});
