import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSportData } from "./useSportData";
import * as useAuthModule from "./useAuth";
import * as useSportConfigModule from "./useSportConfig";
import * as activitiesApi from "../api/activities";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useSportConfig");
vi.mock("../api/activities");

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe("useSportData", () => {
  const mockConfig = {
    version: "1.0",
    sport_categories: {
      cycling: {
        display_name: "Cycling",
        strava_types: ["Ride"],
        excluded_types: [],
        primary_metric: "distanceMeters",
        metrics: ["distanceMeters"],
        has_distance: true,
        has_elevation: true,
      },
      running: {
        display_name: "Running",
        strava_types: ["Run"],
        excluded_types: [],
        primary_metric: "distanceMeters",
        metrics: ["distanceMeters"],
        has_distance: true,
        has_elevation: true,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: sport config loaded
    vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
      sportConfig: mockConfig,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
  });

  it("starts in loading state", () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.metrics).toBeNull();
    expect(result.current.sportConfig).toEqual(mockConfig);
  });

  it("surfaces error from useSportConfig", () => {
    const configError = new Error("Failed to load config");
    vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
      sportConfig: null,
      isLoading: false,
      error: configError,
      retry: vi.fn(),
    });

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    expect(result.current.error).toBe(configError);
    expect(result.current.metrics).toBeNull();
    expect(result.current.sportConfig).toBeNull();
  });

  it("reports loading when sportConfig is loading", () => {
    vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
      sportConfig: null,
      isLoading: true,
      error: null,
      retry: vi.fn(),
    });

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sportConfig).toBeNull();
  });

  it("fetches from API when auth is ready (unauthenticated)", async () => {
    const mockMetrics = [{ date: "2025-01-01", distance: 50 }];

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockResolvedValue(mockMetrics);

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.metrics).toEqual(mockMetrics);
    expect(result.current.sportConfig).toEqual(mockConfig);
    expect(activitiesApi.fetchSportMetrics).toHaveBeenCalledWith(
      2025,
      "cycling",
      expect.any(AbortSignal)
    );
  });

  it("fetches from API when user is authenticated", async () => {
    const mockMetrics = [{ date: "2025-01-01", distance: 50 }];

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockResolvedValue(mockMetrics);

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.metrics).toEqual(mockMetrics);
    expect(result.current.sportConfig).toEqual(mockConfig);
    expect(activitiesApi.fetchSportMetrics).toHaveBeenCalledWith(
      2025,
      "cycling",
      expect.any(AbortSignal)
    );
  });

  it("handles API errors gracefully", async () => {
    const error = new Error("Network error");

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockRejectedValue(error);

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(error);
  });

  it("provides retry functionality", async () => {
    const error = new Error("Network error");

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const fetchSpy = vi
      .spyOn(activitiesApi, "fetchSportMetrics")
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([{ date: "2025-01-01", distance: 100 }]);

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    // Wait for first error
    await waitFor(() => {
      expect(result.current.error).toEqual(error);
    });

    // Retry - wrap in act to handle state updates
    await act(async () => {
      result.current.retry();
    });

    // Wait for successful retry
    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.metrics).toHaveLength(1);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refetches when year changes", async () => {
    const mockMetrics2025 = [{ date: "2025-01-01", distance: 100 }];
    const mockMetrics2024 = [{ date: "2024-01-01", distance: 200 }];

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const fetchMetricsSpy = vi
      .spyOn(activitiesApi, "fetchSportMetrics")
      .mockResolvedValueOnce(mockMetrics2025)
      .mockResolvedValueOnce(mockMetrics2024);

    const { result, rerender } = renderHook(({ year, sport }) => useSportData(year, sport), {
      initialProps: { year: 2025, sport: "cycling" },
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.metrics).toEqual(mockMetrics2025);

    // Change year
    rerender({ year: 2024, sport: "cycling" });

    await waitFor(() => {
      expect(result.current.metrics).toEqual(mockMetrics2024);
    });

    expect(fetchMetricsSpy).toHaveBeenCalledTimes(2);
  });

  it("refetches when sport changes", async () => {
    const mockCyclingMetrics = [{ date: "2025-01-01", distance: 100 }];
    const mockRunningMetrics = [{ date: "2025-01-01", distance: 50 }];

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const fetchMetricsSpy = vi
      .spyOn(activitiesApi, "fetchSportMetrics")
      .mockResolvedValueOnce(mockCyclingMetrics)
      .mockResolvedValueOnce(mockRunningMetrics);

    const { result, rerender } = renderHook(({ year, sport }) => useSportData(year, sport), {
      initialProps: { year: 2025, sport: "cycling" },
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.metrics).toEqual(mockCyclingMetrics);

    // Change sport
    rerender({ year: 2025, sport: "running" });

    await waitFor(() => {
      expect(result.current.metrics).toEqual(mockRunningMetrics);
    });

    expect(fetchMetricsSpy).toHaveBeenCalledTimes(2);
  });
});
