import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAllActivities } from "./useAllActivities";
import * as useAuthModule from "./useAuth";
import * as activitiesApi from "../api/activities";
import type { ActivitySummary, ActivityListResponse } from "../api/activities";

// useAllActivities pulls only getSessionDemoActivities from useActivities; stub it so
// demo mode is deterministic (no sessionStorage / generator dependency).
const { DEMO } = vi.hoisted(() => ({
  DEMO: [
    {
      id: "demo-1",
      name: "Demo Ride",
      sport: "cycling",
      startDateLocal: "2026-05-10T08:00:00",
      distanceMeters: 1000,
      movingTimeSeconds: 600,
      hasRoute: false,
    },
  ] as ActivitySummary[],
}));

vi.mock("./useAuth");
vi.mock("../api/activities");
vi.mock("./useActivities", () => ({ getSessionDemoActivities: () => DEMO }));

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const signedIn = () =>
  vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
    user: { uid: "user-123", email: "test@example.com", displayName: "Test" },
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    error: null,
  });

const signedOut = (loading: boolean) =>
  vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
    user: null,
    loading,
    signIn: vi.fn(),
    signOut: vi.fn(),
    error: null,
  });

const act1 = (id: string): ActivitySummary =>
  ({
    id,
    name: id,
    sport: "cycling",
    startDateLocal: "2026-05-10T08:00:00",
    distanceMeters: 1000,
    movingTimeSeconds: 600,
    hasRoute: true,
  }) as ActivitySummary;

const page = (activities: ActivitySummary[], nextCursor?: string): ActivityListResponse => ({
  activities,
  nextCursor,
  hasMore: Boolean(nextCursor),
});

describe("useAllActivities", () => {
  beforeEach(() => vi.resetAllMocks());

  it("stays loading with no data while auth resolves", () => {
    signedOut(true);
    const { result } = renderHook(() => useAllActivities({}), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.activities).toEqual([]);
  });

  it("returns the generated demo set in one shot when signed out, without fetching", () => {
    signedOut(false);
    const fetchSpy = vi.spyOn(activitiesApi, "fetchActivities");
    const { result } = renderHook(() => useAllActivities({}), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activities).toEqual(DEMO);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("auto-pages to completion and concatenates every page", async () => {
    signedIn();
    vi.spyOn(activitiesApi, "fetchActivities")
      .mockResolvedValueOnce(page([act1("a1")], "cursor-2"))
      .mockResolvedValueOnce(page([act1("a2")])); // no cursor → done

    const { result } = renderHook(
      () => useAllActivities({ from: "2026-01-01", to: "2026-07-15" }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activities).toEqual([act1("a1"), act1("a2")]);
    expect(activitiesApi.fetchActivities).toHaveBeenCalledTimes(2);
    // Page size is the API max (100); the second call carries the first page's cursor.
    expect(activitiesApi.fetchActivities).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ limit: 100, cursor: undefined }),
      expect.any(AbortSignal)
    );
    expect(activitiesApi.fetchActivities).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 100, cursor: "cursor-2" }),
      expect.any(AbortSignal)
    );
  });

  it("treats an empty-string nextCursor as the end, not a live cursor (no loop)", async () => {
    signedIn();
    // "" must NOT drive another page — without the `|| undefined` guard this loops forever.
    const fetchSpy = vi
      .spyOn(activitiesApi, "fetchActivities")
      .mockResolvedValue(page([act1("a1")], ""));

    const { result } = renderHook(() => useAllActivities({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activities).toEqual([act1("a1")]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops paging and surfaces the error (not a perpetual spinner) when a page fails", async () => {
    signedIn();
    const boom = new Error("page 2 failed");
    vi.spyOn(activitiesApi, "fetchActivities")
      .mockResolvedValueOnce(page([act1("a1")], "cursor-2"))
      .mockRejectedValueOnce(boom);

    const { result } = renderHook(() => useAllActivities({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.isLoading).toBe(false); // error is not masked as loading (H2)
    expect(result.current.error).toEqual(boom);
    // Bounded: the failed page does not re-trigger the auto-page effect in a loop.
    expect(activitiesApi.fetchActivities).toHaveBeenCalledTimes(2);
  });

  it("retry re-runs the query and clears the error", async () => {
    signedIn();
    const boom = new Error("network");
    vi.spyOn(activitiesApi, "fetchActivities")
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(page([act1("a1")]));

    const { result } = renderHook(() => useAllActivities({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.error).toEqual(boom));

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.activities).toEqual([act1("a1")]);
    });
  });
});
