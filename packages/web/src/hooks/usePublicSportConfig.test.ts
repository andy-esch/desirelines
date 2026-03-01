import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import * as activitiesApi from "../api/activities";
import { usePublicSportConfig } from "./usePublicSportConfig";

// Mock the API module
vi.mock("../api/activities");

// Mock sport config response
const mockSportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride", "VirtualRide"],
      excludedTypes: ["EBikeRide"],
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
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("usePublicSportConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in loading state", async () => {
    vi.spyOn(activitiesApi, "fetchSportConfig").mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => usePublicSportConfig(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sportConfig).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches sport config successfully", async () => {
    vi.spyOn(activitiesApi, "fetchSportConfig").mockResolvedValue(mockSportConfig);

    const { result } = renderHook(() => usePublicSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sportConfig).toEqual(mockSportConfig);
    expect(result.current.error).toBeNull();
    expect(activitiesApi.fetchSportConfig).toHaveBeenCalledTimes(1);
  });

  it("handles fetch errors", async () => {
    const mockError = new Error("Network error");
    vi.spyOn(activitiesApi, "fetchSportConfig").mockRejectedValue(mockError);

    const { result } = renderHook(() => usePublicSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sportConfig).toBeNull();
    expect(result.current.error).toEqual(mockError);
  });

  it("does not refetch on re-render (cache hit)", async () => {
    vi.spyOn(activitiesApi, "fetchSportConfig").mockResolvedValue(mockSportConfig);

    const { result, rerender } = renderHook(() => usePublicSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    rerender();

    expect(result.current.sportConfig).toEqual(mockSportConfig);
    expect(activitiesApi.fetchSportConfig).toHaveBeenCalledTimes(1);
  });

  it("retry refetches after error", async () => {
    const mockError = new Error("First attempt failed");
    vi.spyOn(activitiesApi, "fetchSportConfig")
      .mockRejectedValueOnce(mockError)
      .mockResolvedValueOnce(mockSportConfig);

    const { result } = renderHook(() => usePublicSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(mockError);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.sportConfig).toEqual(mockSportConfig);
    });

    expect(result.current.error).toBeNull();
  });
});
