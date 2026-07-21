import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useActivityBuckets } from "./useActivityBuckets";
import * as useAuthModule from "./useAuth";
import * as activitiesApi from "../api/activities";
import type { ActivityBucket, ActivitySummary } from "../api/activities";

// useActivityBuckets pulls only getSessionDemoActivities from useActivities;
// stub it so demo mode is deterministic (no sessionStorage / generator run).
const { DEMO } = vi.hoisted(() => ({
  DEMO: [
    {
      id: "demo-1",
      name: "Demo Ride",
      sport: "cycling",
      startDateLocal: "2026-05-10T08:00:00Z",
      distanceMeters: 1000,
      movingTimeSeconds: 600,
      hasRoute: true,
    },
    {
      id: "demo-2",
      name: "Demo Run",
      sport: "running",
      startDateLocal: "2026-05-11T08:00:00Z",
      distanceMeters: 5000,
      movingTimeSeconds: 1500,
      hasRoute: false,
    },
    {
      // Second running activity OUTSIDE the date-window fixtures below, so the
      // window assertion can't pass on the sport filter alone.
      id: "demo-3",
      name: "Demo Run Later",
      sport: "running",
      startDateLocal: "2026-06-01T08:00:00Z",
      distanceMeters: 7000,
      movingTimeSeconds: 2100,
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

const BUCKETS: ActivityBucket[] = [
  {
    month: "2026-05",
    sport: "cycling",
    geographic: true,
    count: 3,
    movingTimeSeconds: 5400,
    distanceMeters: 90000,
  },
];

describe("useActivityBuckets", () => {
  beforeEach(() => vi.resetAllMocks());

  it("stays loading with no buckets while auth resolves", () => {
    signedOut(true);
    const { result } = renderHook(() => useActivityBuckets({ sports: [] }), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.buckets).toEqual([]);
  });

  it("returns the server buckets from one query when signed in", async () => {
    signedIn();
    const fetchSpy = vi.spyOn(activitiesApi, "fetchActivitySummary").mockResolvedValue(BUCKETS);

    const { result } = renderHook(
      () => useActivityBuckets({ sports: ["cycling"], from: "2026-01-01", to: "2026-06-30" }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.buckets).toEqual(BUCKETS);
    expect(fetchSpy).toHaveBeenCalledWith(
      { sports: ["cycling"], from: "2026-01-01", to: "2026-06-30" },
      expect.any(AbortSignal)
    );
  });

  it("aggregates the filtered demo set client-side when signed out, without fetching", () => {
    signedOut(false);
    const fetchSpy = vi.spyOn(activitiesApi, "fetchActivitySummary");

    const { result } = renderHook(
      () => useActivityBuckets({ sports: ["running"], from: "2026-05-11", to: "2026-05-11" }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isLoading).toBe(false);
    // Both filters bite (sport drops the ride, the window drops the June run),
    // then the remaining run aggregates into its (month, sport, geo) bucket.
    expect(result.current.buckets).toEqual([
      {
        month: "2026-05",
        sport: "running",
        geographic: false,
        count: 1,
        movingTimeSeconds: 1500,
        distanceMeters: 5000,
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a fetch error with a working retry", async () => {
    signedIn();
    const fetchSpy = vi
      .spyOn(activitiesApi, "fetchActivitySummary")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(BUCKETS);

    const { result } = renderHook(() => useActivityBuckets({ sports: [] }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toEqual(new Error("Network error")));

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.buckets).toEqual(BUCKETS);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
