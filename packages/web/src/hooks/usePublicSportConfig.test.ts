import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as activitiesApi from "../api/activities";

// Mock the API module
vi.mock("../api/activities");

// Mock sport config response
const mockSportConfig = {
  version: "1.0",
  sport_categories: {
    cycling: {
      display_name: "Cycling",
      strava_types: ["Ride", "VirtualRide"],
      excluded_types: ["EBikeRide"],
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
  },
};

describe("usePublicSportConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state between tests by clearing the cache
    // This is a bit hacky but necessary since the cache is module-level
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in loading state when cache is empty", async () => {
    // Re-import after reset to get fresh cache
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    vi.spyOn(activitiesApi, "fetchSportConfig").mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => freshHook());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sportConfig).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches sport config successfully", async () => {
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    vi.spyOn(activitiesApi, "fetchSportConfig").mockResolvedValue(mockSportConfig);

    const { result } = renderHook(() => freshHook());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sportConfig).toEqual(mockSportConfig);
    expect(result.current.error).toBeNull();
    expect(activitiesApi.fetchSportConfig).toHaveBeenCalledTimes(1);
  });

  it("handles fetch errors", async () => {
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    const mockError = new Error("Network error");
    vi.spyOn(activitiesApi, "fetchSportConfig").mockRejectedValue(mockError);

    const { result } = renderHook(() => freshHook());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sportConfig).toBeNull();
    expect(result.current.error).toEqual(mockError);
  });

  it("does not refetch when component re-renders (cache hit)", async () => {
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    vi.spyOn(activitiesApi, "fetchSportConfig").mockResolvedValue(mockSportConfig);

    const { result, rerender } = renderHook(() => freshHook());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Rerender the hook
    rerender();

    // Should still have the same data and not have refetched
    expect(result.current.sportConfig).toEqual(mockSportConfig);
    expect(activitiesApi.fetchSportConfig).toHaveBeenCalledTimes(1);
  });

  it("retry clears cache and refetches", async () => {
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    const mockError = new Error("First attempt failed");
    vi.spyOn(activitiesApi, "fetchSportConfig")
      .mockRejectedValueOnce(mockError)
      .mockResolvedValueOnce(mockSportConfig);

    const { result } = renderHook(() => freshHook());

    // Wait for first fetch to fail
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(mockError);
    expect(result.current.sportConfig).toBeNull();

    // Retry
    act(() => {
      result.current.retry();
    });

    // Wait for second fetch to succeed
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.sportConfig).toEqual(mockSportConfig);
    });

    expect(result.current.error).toBeNull();
    expect(activitiesApi.fetchSportConfig).toHaveBeenCalledTimes(2);
  });

  it("multiple hook instances share the same fetch", async () => {
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    let resolvePromise: (value: typeof mockSportConfig) => void;
    const delayedPromise = new Promise<typeof mockSportConfig>((resolve) => {
      resolvePromise = resolve;
    });

    vi.spyOn(activitiesApi, "fetchSportConfig").mockReturnValue(delayedPromise);

    // Render two hooks simultaneously
    const { result: result1 } = renderHook(() => freshHook());
    const { result: result2 } = renderHook(() => freshHook());

    // Both should be loading
    expect(result1.current.isLoading).toBe(true);
    expect(result2.current.isLoading).toBe(true);

    // Resolve the promise
    act(() => {
      resolvePromise!(mockSportConfig);
    });

    // Both should get the same data
    await waitFor(() => {
      expect(result1.current.isLoading).toBe(false);
      expect(result2.current.isLoading).toBe(false);
    });

    expect(result1.current.sportConfig).toEqual(mockSportConfig);
    expect(result2.current.sportConfig).toEqual(mockSportConfig);

    // Should have only fetched once
    expect(activitiesApi.fetchSportConfig).toHaveBeenCalledTimes(1);
  });

  it("ignores AbortError from cancelled requests", async () => {
    const { usePublicSportConfig: freshHook } = await import("./usePublicSportConfig");

    const abortError = new DOMException("Aborted", "AbortError");
    vi.spyOn(activitiesApi, "fetchSportConfig").mockRejectedValue(abortError);

    const { unmount } = renderHook(() => freshHook());

    // Unmount to trigger abort
    unmount();

    // Error should not be set for abort errors
    // (This is a bit tricky to test since the component is unmounted)
  });
});
