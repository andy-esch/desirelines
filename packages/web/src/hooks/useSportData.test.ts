import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSportData } from "./useSportData";
import * as useAuthModule from "./useAuth";
import * as useSportConfigModule from "./useSportConfig";
import * as useUserConfigModule from "./useUserConfig";
import * as activitiesApi from "../api/activities";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useSportConfig");
vi.mock("./useUserConfig");
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
    sportCategories: {
      cycling: {
        displayName: "Cycling",
        stravaTypes: ["Ride"],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: ["distance_meters"],
        hasDistance: true,
        hasElevation: true,
      },
      running: {
        displayName: "Running",
        stravaTypes: ["Run"],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: ["distance_meters"],
        hasDistance: true,
        hasElevation: true,
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
    // Default: preferences with timezone
    vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
      data: { timezone: "America/New_York" },
      loading: false,
      error: null,
      updateData: vi.fn(),
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
    } as unknown as ReturnType<typeof useUserConfigModule.useUserConfig>);
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

  it("does not call the API when unauthenticated", async () => {
    // The metrics endpoint is auth-only: the client interceptor logs
    // "Request will proceed without auth token and likely receive 401" when there
    // is no user, so firing here could only ever 401. Unauthenticated visitors are
    // served by the separate /demo/$sport routes instead.
    //
    // This previously asserted the opposite — that the call *was* made — which
    // encoded the bug rather than the intent (audit 2026-07-18-frontend-refinements H1).
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockResolvedValue([
      { date: "2025-01-01", distance: 50 },
    ]);

    const { result } = renderHook(() => useSportData(2025, "cycling"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(activitiesApi.fetchSportMetrics).not.toHaveBeenCalled();
    expect(result.current.metrics).toBeNull();
    // Sport config is public and still loads — only the per-user metrics are gated.
    expect(result.current.sportConfig).toEqual(mockConfig);
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
    expect(activitiesApi.fetchSportMetrics).toHaveBeenCalledWith({
      year: 2025,
      sport: "cycling",
      tz: "America/New_York",
      signal: expect.any(AbortSignal),
    });
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

    // Authenticated: the metrics query is auth-gated, so an unauthenticated setup
    // would test nothing here. This test is about the year key, not about auth.
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
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

    // Authenticated: the metrics query is auth-gated, so an unauthenticated setup
    // would test nothing here. This test is about the sport key, not about auth.
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
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
