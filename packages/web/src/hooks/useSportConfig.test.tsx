import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSportConfig } from "./useSportConfig";

// Mock useAuth
let mockAuthState = { loading: false, user: null, error: null, signIn: vi.fn(), signOut: vi.fn() };
vi.mock("./useAuth", () => ({
  useAuth: () => mockAuthState,
}));

// Mock the API
const mockSportConfig = {
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
  },
};

vi.mock("../api/activities", () => ({
  fetchSportConfig: vi.fn(),
}));

import { fetchSportConfig } from "../api/activities";
const mockFetchSportConfig = vi.mocked(fetchSportConfig);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useSportConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = { loading: false, user: null, error: null, signIn: vi.fn(), signOut: vi.fn() };
  });

  it("returns null sportConfig while auth is loading", () => {
    mockAuthState = { ...mockAuthState, loading: true };

    const { result } = renderHook(() => useSportConfig(), {
      wrapper: createWrapper(),
    });

    expect(result.current.sportConfig).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(mockFetchSportConfig).not.toHaveBeenCalled();
  });

  it("fetches sport config when auth is ready", async () => {
    mockFetchSportConfig.mockResolvedValue(mockSportConfig);

    const { result } = renderHook(() => useSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sportConfig).toEqual(mockSportConfig);
    expect(result.current.error).toBeNull();
  });

  it("returns error when fetch fails", async () => {
    mockFetchSportConfig.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sportConfig).toBeNull();
    expect(result.current.error?.message).toBe("Network error");
  });

  it("provides a retry function", async () => {
    mockFetchSportConfig.mockResolvedValue(mockSportConfig);

    const { result } = renderHook(() => useSportConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.retry).toBe("function");
  });
});
