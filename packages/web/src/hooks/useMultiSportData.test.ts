import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMultiSportData } from "./useMultiSportData";

// Mock useAuth
vi.mock("./useAuth", () => ({
  useAuth: vi.fn(),
}));

// Mock useAuthToken - must return stable reference to avoid infinite loops
const mockGetToken = vi.fn().mockResolvedValue("mock-token");
vi.mock("./useAuthToken", () => ({
  useAuthToken: () => ({
    getToken: mockGetToken,
  }),
}));

// Mock fetchSportMetrics
vi.mock("../api/activities", () => ({
  fetchSportMetrics: vi.fn(),
}));

// Mock demoDataGenerator to return predictable data
vi.mock("../utils/demoDataGenerator", () => ({
  generateCoordinatedFillLevels: vi.fn(() => ({
    cycling: "full",
    running: "full",
    yoga: "full",
    hiking: "full",
    workout: "full",
  })),
  getSessionFillLevels: vi.fn(() => ({
    cycling: "full",
    running: "full",
    yoga: "full",
    hiking: "full",
    workout: "full",
  })),
  generateDemoMetrics: vi.fn((sport: string, year: number) => {
    // Only return data for year 2025
    if (year !== 2025) {
      return [];
    }
    const mockData: Record<
      string,
      { date: string; distance?: number; time: number; activities: number }[]
    > = {
      cycling: [{ date: "2025-01-01", distance: 10000, time: 60, activities: 1 }],
      running: [{ date: "2025-01-02", distance: 5000, time: 30, activities: 1 }],
      yoga: [{ date: "2025-01-03", time: 45, activities: 1 }],
      hiking: [{ date: "2025-01-04", distance: 8000, time: 120, activities: 1 }],
      workout: [{ date: "2025-01-05", time: 60, activities: 1 }],
    };
    return mockData[sport] || [];
  }),
}));

import { useAuth } from "./useAuth";
import { fetchSportMetrics } from "../api/activities";

const mockUseAuth = vi.mocked(useAuth);
const mockFetchSportMetrics = vi.mocked(fetchSportMetrics);

describe("useMultiSportData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("unauthenticated user", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
    });

    it("returns demo data for unauthenticated users", async () => {
      const { result } = renderHook(() => useMultiSportData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data.cycling).toEqual([
        { date: "2025-01-01", distance: 10000, time: 60, activities: 1 },
      ]);
      expect(result.current.data.running).toEqual([
        { date: "2025-01-02", distance: 5000, time: 30, activities: 1 },
      ]);
      expect(result.current.data.yoga).toEqual([{ date: "2025-01-03", time: 45, activities: 1 }]);
      expect(result.current.error).toBeNull();
    });

    it("returns empty arrays for year with no demo data", async () => {
      const { result } = renderHook(() => useMultiSportData(2020));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data.cycling).toEqual([]);
      expect(result.current.data.running).toEqual([]);
      expect(result.current.data.yoga).toEqual([]);
    });

    it("does not call API for unauthenticated users", async () => {
      const { result } = renderHook(() => useMultiSportData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockFetchSportMetrics).not.toHaveBeenCalled();
    });
  });

  describe("authenticated user", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: { uid: "123", displayName: "Test User", email: "test@example.com" },
        loading: false,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
    });

    it("fetches data from API for authenticated users", async () => {
      const cyclingData = [{ date: "2025-01-01", distance: 20000, time: 90, activities: 1 }];
      const runningData = [{ date: "2025-01-02", distance: 8000, time: 45, activities: 1 }];
      const yogaData = [{ date: "2025-01-03", time: 60, activities: 1 }];

      mockFetchSportMetrics
        .mockResolvedValueOnce(cyclingData)
        .mockResolvedValueOnce(runningData)
        .mockResolvedValueOnce(yogaData);

      const { result } = renderHook(() => useMultiSportData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockFetchSportMetrics).toHaveBeenCalledTimes(3);
      expect(result.current.data.cycling).toEqual(cyclingData);
      expect(result.current.data.running).toEqual(runningData);
      expect(result.current.data.yoga).toEqual(yogaData);
    });

    it("handles API errors gracefully", async () => {
      mockFetchSportMetrics.mockRejectedValue(new Error("API Error"));

      const { result } = renderHook(() => useMultiSportData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("API Error");
    });
  });

  describe("loading state", () => {
    it("returns loading true while auth is loading", async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: true,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      const { result } = renderHook(() => useMultiSportData(2025));

      expect(result.current.isLoading).toBe(true);
    });

    it("returns loading true while fetching data", async () => {
      mockUseAuth.mockReturnValue({
        user: { uid: "123", displayName: "Test User", email: "test@example.com" },
        loading: false,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      // Create a promise that we can control
      let resolvePromise: (value: unknown) => void;
      const controlledPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockFetchSportMetrics.mockReturnValue(controlledPromise as Promise<any>);

      const { result } = renderHook(() => useMultiSportData(2025));

      // Initially should be loading
      expect(result.current.isLoading).toBe(true);

      // Resolve the promise
      resolvePromise!([]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe("year changes", () => {
    it("refetches when year changes", async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      const { result, rerender } = renderHook(({ year }) => useMultiSportData(year), {
        initialProps: { year: 2025 },
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Change year
      rerender({ year: 2024 });

      // Should trigger new data load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });
});
