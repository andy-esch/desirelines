import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSportData } from "./useSportData";
import * as useAuthModule from "./useAuth";
import * as useAuthTokenModule from "./useAuthToken";
import * as activitiesApi from "../api/activities";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useAuthToken");
vi.mock("../api/activities");
vi.mock("../config", () => ({
  USE_FIXTURE_DATA: true,
}));
vi.mock("../data/fixtures", () => ({
  FIXTURE_SPORT_METRICS: {
    cycling: {
      2025: [
        { date: "2025-01-01", distance: 10 },
        { date: "2025-01-02", distance: 20 },
      ],
    },
  },
  FIXTURE_SPORT_CONFIG: {
    version: "1.0",
    sport_categories: {
      cycling: {
        display_name: "Cycling",
        strava_types: ["Ride"],
        excluded_types: [],
        primary_metric: "distance_meters",
        metrics: ["distance_meters"],
        has_distance: true,
        has_elevation: true,
      },
    },
  },
}));

describe("useSportData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state", () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    const { result } = renderHook(() => useSportData(2025, "cycling"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.metrics).toBeNull();
    expect(result.current.sportConfig).toBeNull();
  });

  it("loads fixture data when user is not authenticated", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    const { result } = renderHook(() => useSportData(2025, "cycling"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.metrics).toHaveLength(2);
    expect(result.current.sportConfig).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it("fetches from API when user is authenticated", async () => {
    const mockMetrics = [{ date: "2025-01-01", distance: 50 }];
    const mockConfig = {
      version: "1.0",
      sport_categories: {
        cycling: {
          display_name: "Cycling",
          strava_types: ["Ride"],
          excluded_types: [],
          primary_metric: "distance_meters",
          metrics: ["distance_meters"],
          has_distance: true,
          has_elevation: true,
        },
      },
    };

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockResolvedValue(mockMetrics);
    vi.spyOn(activitiesApi, "fetchSportConfig").mockResolvedValue(mockConfig);

    const { result } = renderHook(() => useSportData(2025, "cycling"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.metrics).toEqual(mockMetrics);
    expect(result.current.sportConfig).toEqual(mockConfig);
    expect(activitiesApi.fetchSportMetrics).toHaveBeenCalledWith(
      2025,
      "cycling",
      expect.any(AbortSignal),
      "mock-token"
    );
  });

  it("handles API errors gracefully", async () => {
    const error = new Error("Network error");

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockRejectedValue(error);

    const { result } = renderHook(() => useSportData(2025, "cycling"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(error);
  });

  it("ignores cancelled request errors", async () => {
    const cancelError = new Error("Request cancelled");

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchSportMetrics").mockRejectedValue(cancelError);

    const { result } = renderHook(() => useSportData(2025, "cycling"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should not set error for cancelled requests
    expect(result.current.error).toBeNull();
  });

  it("provides retry functionality", async () => {
    const error = new Error("Network error");

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    const fetchSpy = vi
      .spyOn(activitiesApi, "fetchSportMetrics")
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([{ date: "2025-01-01", distance: 100 }]);

    vi.spyOn(activitiesApi, "fetchSportConfig").mockResolvedValue({
      version: "1.0",
      sport_categories: {
        cycling: {
          display_name: "Cycling",
          strava_types: ["Ride"],
          excluded_types: [],
          primary_metric: "distance_meters",
          metrics: ["distance_meters"],
          has_distance: true,
          has_elevation: true,
        },
      },
    });

    const { result } = renderHook(() => useSportData(2025, "cycling"));

    // Wait for first error
    await waitFor(() => {
      expect(result.current.error).toEqual(error);
    });

    // Retry
    result.current.retry();

    // Wait for successful retry
    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.metrics).toHaveLength(1);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refetches when year changes", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    const { result, rerender } = renderHook(({ year, sport }) => useSportData(year, sport), {
      initialProps: { year: 2025, sport: "cycling" },
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstMetrics = result.current.metrics;

    // Change year
    rerender({ year: 2024, sport: "cycling" });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should trigger refetch (metrics will be empty for 2024 in fixture)
    expect(result.current.metrics).not.toBe(firstMetrics);
  });

  it("refetches when sport changes", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    const { result, rerender } = renderHook(({ year, sport }) => useSportData(year, sport), {
      initialProps: { year: 2025, sport: "cycling" },
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Change sport
    rerender({ year: 2025, sport: "running" });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should have triggered refetch
    expect(result.current.isLoading).toBe(false);
  });
});
