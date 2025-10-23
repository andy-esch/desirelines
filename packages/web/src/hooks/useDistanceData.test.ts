import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDistanceData } from "./useDistanceData";
import * as activitiesApi from "../api/activities";
import type { RideBlobType } from "../types/activity";

// Mock the activities API
vi.mock("../api/activities");

describe("useDistanceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock current date to a known value for consistent testing
    // Use real timers for async/await to work properly
    vi.setSystemTime(new Date("2025-06-15"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("data fetching and extension", () => {
    it("should fetch data and extend to today for current year", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [
          { x: "2025-01-01", y: 100 },
          { x: "2025-01-15", y: 250 },
          { x: "2025-02-01", y: 400 },
        ],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2025));

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.distanceData).toEqual([]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have extended data from Feb 1 through June 15 (today)
      expect(result.current.distanceData.length).toBeGreaterThan(3);

      // First entries should match original data
      expect(result.current.distanceData[0]).toEqual({ x: "2025-01-01", y: 100 });
      expect(result.current.distanceData[1]).toEqual({ x: "2025-01-15", y: 250 });
      expect(result.current.distanceData[2]).toEqual({ x: "2025-02-01", y: 400 });

      // Last entry should be yesterday (June 14) - extension logic extends to yesterday (today's data incomplete)
      const lastEntry = result.current.distanceData[result.current.distanceData.length - 1];
      expect(lastEntry.x).toBe("2025-06-14");
      expect(lastEntry.y).toBe(400); // Carried forward from last activity

      expect(result.current.error).toBeNull();
    });

    it("should not extend past year for past years", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [
          { x: "2023-01-01", y: 100 },
          { x: "2023-06-15", y: 500 },
        ],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2023));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should extend to Dec 31, 2023, not to today (2025-06-15)
      const lastEntry = result.current.distanceData[result.current.distanceData.length - 1];
      expect(lastEntry.x).toBe("2023-12-31");
      expect(lastEntry.y).toBe(500);

      // Verify it didn't extend into 2024 or 2025
      const has2024Data = result.current.distanceData.some((entry) => entry.x.startsWith("2024"));
      const has2025Data = result.current.distanceData.some((entry) => entry.x.startsWith("2025"));
      expect(has2024Data).toBe(false);
      expect(has2025Data).toBe(false);
    });

    it("should not extend when data is already current", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [
          { x: "2025-01-01", y: 100 },
          { x: "2025-06-15", y: 500 }, // Already today
        ],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not add any entries
      expect(result.current.distanceData).toHaveLength(2);
      expect(result.current.distanceData[0]).toEqual({ x: "2025-01-01", y: 100 });
      expect(result.current.distanceData[1]).toEqual({ x: "2025-06-15", y: 500 });
    });

    it("should handle empty data", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.distanceData).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("should handle single data point and extend to today", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [{ x: "2025-01-01", y: 100 }],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have extended from Jan 1 to June 14 (yesterday)
      expect(result.current.distanceData.length).toBeGreaterThan(1);
      expect(result.current.distanceData[0]).toEqual({ x: "2025-01-01", y: 100 });

      const lastEntry = result.current.distanceData[result.current.distanceData.length - 1];
      expect(lastEntry.x).toBe("2025-06-14");
      expect(lastEntry.y).toBe(100); // Same distance carried forward
    });
  });

  describe("loading states", () => {
    it("should set isLoading to true initially, then false after fetch", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [{ x: "2025-01-01", y: 100 }],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2025));

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.distanceData).toEqual([]);
      expect(result.current.error).toBeNull();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.distanceData.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should set error when fetch fails", async () => {
      const mockError = new Error("Network error");
      vi.mocked(activitiesApi.fetchDistanceData).mockRejectedValue(mockError);

      const { result } = renderHook(() => useDistanceData(2025));

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toEqual(mockError);
      expect(result.current.distanceData).toEqual([]);
    });

    it("should not set error when request is aborted (AbortError)", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      vi.mocked(activitiesApi.fetchDistanceData).mockRejectedValue(abortError);

      const { result } = renderHook(() => useDistanceData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // AbortError should not be set as error (name check filters it out)
      expect(result.current.error).toBeNull();
      expect(result.current.distanceData).toEqual([]);
    });

    it("should handle non-Error objects and convert to Error", async () => {
      vi.mocked(activitiesApi.fetchDistanceData).mockRejectedValue("String error");

      const { result } = renderHook(() => useDistanceData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should convert to Error
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("String error");
    });
  });

  describe("AbortController cleanup", () => {
    it("should abort fetch on unmount", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [{ x: "2025-01-01", y: 100 }],
      };

      let capturedSignal: AbortSignal | undefined;
      vi.mocked(activitiesApi.fetchDistanceData).mockImplementation(async (_year, signal) => {
        capturedSignal = signal;
        return mockData;
      });

      const { unmount } = renderHook(() => useDistanceData(2025));

      // Unmount before fetch completes
      unmount();

      // Signal should be aborted
      expect(capturedSignal?.aborted).toBe(true);
    });

    it("should abort previous fetch when year changes", async () => {
      const mockData2023: RideBlobType = {
        distance_traveled: [{ x: "2023-01-01", y: 100 }],
      };
      const mockData2024: RideBlobType = {
        distance_traveled: [{ x: "2024-01-01", y: 200 }],
      };

      const capturedSignals: AbortSignal[] = [];
      vi.mocked(activitiesApi.fetchDistanceData).mockImplementation(async (year, signal) => {
        if (signal) {
          capturedSignals.push(signal);
        }
        return year === 2023 ? mockData2023 : mockData2024;
      });

      const { rerender } = renderHook(({ year }) => useDistanceData(year), {
        initialProps: { year: 2023 },
      });

      await waitFor(() => {
        expect(capturedSignals.length).toBe(1);
      });

      // Change year - should abort previous fetch
      rerender({ year: 2024 });

      await waitFor(() => {
        expect(capturedSignals.length).toBe(2);
      });

      // First signal should be aborted
      expect(capturedSignals[0].aborted).toBe(true);
      // Second signal should still be active (or completed)
      // We can't guarantee it's not aborted if the component unmounted
    });
  });

  describe("data extension edge cases", () => {
    it("should handle leap year correctly", async () => {
      // Set current date to a leap year
      vi.setSystemTime(new Date("2024-02-29T12:00:00Z"));

      const mockData: RideBlobType = {
        distance_traveled: [{ x: "2024-02-28", y: 100 }],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2024));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should include Feb 29 (leap day)
      const hasFeb29 = result.current.distanceData.some((entry) => entry.x === "2024-02-29");
      expect(hasFeb29).toBe(true);

      // Last entry should be Feb 29 (today)
      const lastEntry = result.current.distanceData[result.current.distanceData.length - 1];
      expect(lastEntry.x).toBe("2024-02-29");
    });

    it("should handle year boundary (Dec 31)", async () => {
      vi.setSystemTime(new Date("2024-12-31T12:00:00Z"));

      const mockData: RideBlobType = {
        distance_traveled: [{ x: "2024-12-29", y: 500 }],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2024));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should extend to Dec 31
      const lastEntry = result.current.distanceData[result.current.distanceData.length - 1];
      expect(lastEntry.x).toBe("2024-12-31");
      expect(lastEntry.y).toBe(500);
    });

    it("should handle data from future date gracefully", async () => {
      const mockData: RideBlobType = {
        distance_traveled: [
          { x: "2025-01-01", y: 100 },
          { x: "2025-12-31", y: 1000 }, // Future date beyond today (June 15)
        ],
      };

      vi.mocked(activitiesApi.fetchDistanceData).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDistanceData(2025));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not extend when last entry is in the future
      expect(result.current.distanceData).toHaveLength(2);
      expect(result.current.distanceData[1]).toEqual({ x: "2025-12-31", y: 1000 });
    });
  });

  describe("refetch on year change", () => {
    it("should fetch new data when year changes", async () => {
      const mockData2023: RideBlobType = {
        distance_traveled: [{ x: "2023-01-01", y: 100 }],
      };
      const mockData2024: RideBlobType = {
        distance_traveled: [{ x: "2024-01-01", y: 200 }],
      };

      vi.mocked(activitiesApi.fetchDistanceData)
        .mockResolvedValueOnce(mockData2023)
        .mockResolvedValueOnce(mockData2024);

      const { result, rerender } = renderHook(({ year }) => useDistanceData(year), {
        initialProps: { year: 2023 },
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.distanceData[0].x).toBe("2023-01-01");
      expect(activitiesApi.fetchDistanceData).toHaveBeenCalledWith(2023, expect.any(Object));

      // Change year
      rerender({ year: 2024 });

      await waitFor(() => {
        expect(result.current.distanceData[0].x).toBe("2024-01-01");
      });

      expect(activitiesApi.fetchDistanceData).toHaveBeenCalledWith(2024, expect.any(Object));
      expect(activitiesApi.fetchDistanceData).toHaveBeenCalledTimes(2);
    });
  });
});
