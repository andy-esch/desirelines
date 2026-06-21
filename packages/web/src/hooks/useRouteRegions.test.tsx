import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouteRegions } from "./useRouteRegions";

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

vi.mock("../api/map", () => ({
  fetchRouteRegions: vi.fn(),
}));

import { fetchRouteRegions } from "../api/map";
const mockFetch = vi.mocked(fetchRouteRegions);

const viewport = {
  regionId: "metro-nyc",
  name: "New York",
  kind: "metro",
  activityCount: 42,
  bbox: [-74.1, 40.6, -73.8, 40.9] as [number, number, number, number],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useRouteRegions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = { loading: false, user: null, error: null, signIn: vi.fn(), signOut: vi.fn() };
  });

  it("does not fetch while unauthenticated", () => {
    renderHook(() => useRouteRegions(), { wrapper: createWrapper() });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns safe defaults before data resolves", () => {
    mockAuthState = { ...mockAuthState, user: { uid: "u1" } };
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useRouteRegions(), { wrapper: createWrapper() });

    expect(result.current.regions).toEqual([]);
    expect(result.current.defaultViewport).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("fetches and exposes regions + defaultViewport once authenticated", async () => {
    mockAuthState = { ...mockAuthState, user: { uid: "u1" } };
    mockFetch.mockResolvedValue({ regions: [viewport], defaultViewport: viewport });

    const { result } = renderHook(() => useRouteRegions(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetch).toHaveBeenCalled();
    expect(result.current.regions).toEqual([viewport]);
    expect(result.current.defaultViewport).toEqual(viewport);
  });
});
