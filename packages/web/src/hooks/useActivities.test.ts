import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActivities } from "./useActivities";
import * as useAuthModule from "./useAuth";
import * as useAuthTokenModule from "./useAuthToken";
import * as activitiesApi from "../api/activities";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useAuthToken");
vi.mock("../api/activities");

describe("useActivities", () => {
  const mockActivities = [
    {
      id: 123456789,
      name: "Morning Ride",
      type: "Ride",
      sport: "cycling",
      startDateLocal: "2025-12-28T08:30:00",
      distanceMeters: 45000,
      movingTimeSeconds: 5400,
      elevationMeters: 450,
    },
    {
      id: 123456790,
      name: "Evening Run",
      type: "Run",
      sport: "running",
      startDateLocal: "2025-12-27T18:00:00",
      distanceMeters: 8000,
      movingTimeSeconds: 2400,
      elevationMeters: 50,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state", () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useActivities({ limit: 20 }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.activities).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it("fetches activities when auth is ready", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchActivities").mockResolvedValue({
      activities: mockActivities,
      hasMore: true,
      nextCursor: "cursor-123",
    });

    const { result } = renderHook(() =>
      useActivities({ from: "2025-12-01", to: "2025-12-31", limit: 20 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.activities).toEqual(mockActivities);
    expect(result.current.hasMore).toBe(true);
    expect(activitiesApi.fetchActivities).toHaveBeenCalledWith(
      { from: "2025-12-01", to: "2025-12-31", limit: 20, cursor: undefined },
      expect.any(AbortSignal),
      "mock-token"
    );
  });

  it("handles empty results", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchActivities").mockResolvedValue({
      activities: [],
      hasMore: false,
    });

    const { result } = renderHook(() => useActivities({ limit: 20 }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.activities).toEqual([]);
    expect(result.current.hasMore).toBe(false);
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

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchActivities").mockRejectedValue(error);

    const { result } = renderHook(() => useActivities({ limit: 20 }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.activities).toEqual([]);
  });

  it("ignores cancelled request errors", async () => {
    const cancelError = new Error("Request cancelled");

    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchActivities").mockRejectedValue(cancelError);

    const { result } = renderHook(() => useActivities({ limit: 20 }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
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

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    const fetchSpy = vi
      .spyOn(activitiesApi, "fetchActivities")
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        activities: mockActivities,
        hasMore: false,
      });

    const { result } = renderHook(() => useActivities({ limit: 20 }));

    await waitFor(() => {
      expect(result.current.error).toEqual(error);
    });

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.activities).toHaveLength(2);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("resets activities when filter changes", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    const cyclingActivities = [mockActivities[0]];
    const runningActivities = [mockActivities[1]];

    vi.spyOn(activitiesApi, "fetchActivities")
      .mockResolvedValueOnce({ activities: cyclingActivities, hasMore: false })
      .mockResolvedValueOnce({ activities: runningActivities, hasMore: false });

    const { result, rerender } = renderHook(({ sport }) => useActivities({ sport, limit: 20 }), {
      initialProps: { sport: "cycling" },
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.activities).toEqual(cyclingActivities);

    rerender({ sport: "running" });

    await waitFor(() => {
      expect(result.current.activities).toEqual(runningActivities);
    });
  });

  it("filters by sport", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchActivities").mockResolvedValue({
      activities: [mockActivities[0]],
      hasMore: false,
    });

    const { result } = renderHook(() => useActivities({ sport: "cycling", limit: 20 }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(activitiesApi.fetchActivities).toHaveBeenCalledWith(
      expect.objectContaining({ sport: "cycling" }),
      expect.any(AbortSignal),
      "mock-token"
    );
  });

  it("filters by date range", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    vi.spyOn(useAuthTokenModule, "useAuthToken").mockReturnValue({
      getToken: vi.fn().mockResolvedValue("mock-token"),
    });

    vi.spyOn(activitiesApi, "fetchActivities").mockResolvedValue({
      activities: mockActivities,
      hasMore: false,
    });

    const { result } = renderHook(() =>
      useActivities({ from: "2025-12-01", to: "2025-12-31", limit: 20 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(activitiesApi.fetchActivities).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2025-12-01", to: "2025-12-31" }),
      expect.any(AbortSignal),
      "mock-token"
    );
  });
});
