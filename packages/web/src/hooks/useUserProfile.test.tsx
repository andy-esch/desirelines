/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserProfile } from "./useUserProfile";
import { UserProfileService } from "../services/userProfileService";
import { TestServiceProvider } from "../contexts/ServiceContext";

// Mock UserProfileService
vi.mock("../services/userProfileService", () => {
  const MockUserProfileService = vi.fn();
  MockUserProfileService.prototype.getProfile = vi.fn();
  MockUserProfileService.prototype.subscribeToProfile = vi.fn(() => vi.fn());
  return { UserProfileService: MockUserProfileService };
});

// Mock useAuth with dynamic return value
let mockAuthState: { user: any; loading: boolean } = { user: null, loading: false };

vi.mock("./useAuth", () => ({
  useAuth: () => mockAuthState,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <TestServiceProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TestServiceProvider>
  );
};

describe("useUserProfile", () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceInstance = UserProfileService.prototype;
    // Default to unauthenticated
    mockAuthState = { user: null, loading: false };
  });

  it("should return Guest displayName when no user is logged in", async () => {
    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    expect(result.current.displayName).toBe("Guest");
    expect(result.current.profile).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockServiceInstance.getProfile).not.toHaveBeenCalled();
  });

  it("should return Athlete displayName when authenticated but profile is missing", async () => {
    mockAuthState = { user: { uid: "123" }, loading: false };
    mockServiceInstance.getProfile.mockResolvedValue(null);

    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.displayName).toBe("Athlete");
    expect(result.current.profile).toBeNull();
  });

  it("should format displayName correctly with first and last name", async () => {
    mockAuthState = { user: { uid: "123" }, loading: false };
    const mockProfile = {
      strava_athlete_id: 123,
      first_name: "Andy",
      last_name: "Esch",
    };
    mockServiceInstance.getProfile.mockResolvedValue(mockProfile);

    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.displayName).toBe("Andy Esch");
    });

    expect(result.current.profile).toEqual(mockProfile);
  });

  it("should format displayName correctly with only first name", async () => {
    mockAuthState = { user: { uid: "123" }, loading: false };
    const mockProfile = {
      strava_athlete_id: 123,
      first_name: "Andy",
      last_name: null,
    };
    mockServiceInstance.getProfile.mockResolvedValue(mockProfile);

    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.displayName).toBe("Andy");
    });
  });

  it("should show loading when auth is loading", async () => {
    mockAuthState = { user: null, loading: true };

    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
  });

  it("should show loading when profile query is loading", async () => {
    mockAuthState = { user: { uid: "123" }, loading: false };
    // Create a promise that doesn't resolve immediately
    let resolveProfile: any;
    const profilePromise = new Promise((resolve) => {
      resolveProfile = resolve;
    });
    mockServiceInstance.getProfile.mockReturnValue(profilePromise);

    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);

    // Clean up
    resolveProfile(null);
  });

  it("should return error when profile fetch fails", async () => {
    mockAuthState = { user: { uid: "123" }, loading: false };
    const error = new Error("Firestore failure");
    mockServiceInstance.getProfile.mockRejectedValue(error);

    const { result } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(error);
  });

  it("should unsubscribe on unmount", async () => {
    mockAuthState = { user: { uid: "123" }, loading: false };
    const unsubscribeMock = vi.fn();
    mockServiceInstance.subscribeToProfile.mockReturnValue(unsubscribeMock);
    mockServiceInstance.getProfile.mockResolvedValue({});

    const { unmount } = renderHook(() => useUserProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockServiceInstance.subscribeToProfile).toHaveBeenCalled());

    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });
});
