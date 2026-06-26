import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRefreshMapData } from "./useRefreshMapData";
import { mapDatasetKey } from "./useMapDataset";
import { routeRegionsKey } from "./useRouteRegions";

let mockAuthState = {
  loading: false,
  user: null as { uid: string } | null,
  error: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("./useAuth", () => ({
  useAuth: () => mockAuthState,
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useRefreshMapData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      loading: false,
      user: { uid: "u1" },
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  });

  it("invalidates the dataset + regions queries for the current user", () => {
    const { queryClient, wrapper } = createHarness();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRefreshMapData(), { wrapper });
    act(() => result.current.refresh());

    expect(spy).toHaveBeenCalledWith({ queryKey: mapDatasetKey("u1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: routeRegionsKey("u1") });
  });

  it("scopes invalidation to the signed-in user's uid", () => {
    mockAuthState = { ...mockAuthState, user: { uid: "other" } };
    const { queryClient, wrapper } = createHarness();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRefreshMapData(), { wrapper });
    act(() => result.current.refresh());

    expect(spy).toHaveBeenCalledWith({ queryKey: mapDatasetKey("other") });
    expect(spy).toHaveBeenCalledWith({ queryKey: routeRegionsKey("other") });
  });

  it("reports not-refreshing when nothing is in flight", () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useRefreshMapData(), { wrapper });
    expect(result.current.isRefreshing).toBe(false);
  });
});
