import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuthToken } from "./useAuthToken";
import * as useAuthModule from "./useAuth";

// Mock useAuth hook
vi.mock("./useAuth");

// Mock Firebase
vi.mock("../lib/firebase", () => ({
  getFirebaseAuth: vi.fn(() => ({
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue("mock-token-123"),
    },
  })),
}));

describe("useAuthToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined when user is not authenticated", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const { result } = renderHook(() => useAuthToken());
    const token = await result.current.getToken();

    expect(token).toBeUndefined();
  });

  it("returns token when user is authenticated", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test User" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const { result } = renderHook(() => useAuthToken());
    const token = await result.current.getToken();

    expect(token).toBe("mock-token-123");
  });

  it("memoizes getToken callback when user state doesn't change", () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test User" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      error: null,
    });

    const { result, rerender } = renderHook(() => useAuthToken());

    const firstCallback = result.current.getToken;
    rerender();
    const secondCallback = result.current.getToken;

    // Callback should remain stable when user hasn't changed
    expect(firstCallback).toBe(secondCallback);
  });
});
