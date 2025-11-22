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
    });

    const { result } = renderHook(() => useAuthToken());
    const token = await result.current.getToken();

    expect(token).toBe("mock-token-123");
  });

  it("returns undefined when Firebase currentUser is null", async () => {
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test User" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    // Mock Firebase with null currentUser
    vi.doMock("../lib/firebase", () => ({
      getFirebaseAuth: vi.fn(() => ({
        currentUser: null,
      })),
    }));

    const { result } = renderHook(() => useAuthToken());
    const token = await result.current.getToken();

    // Should handle gracefully when Firebase auth state is inconsistent
    expect(token).toBeUndefined();
  });

  it("memoizes getToken callback based on user state", () => {
    const { result, rerender } = renderHook(() => useAuthToken());

    const firstCallback = result.current.getToken;
    rerender();
    const secondCallback = result.current.getToken;

    // Callback should remain stable
    expect(firstCallback).toBe(secondCallback);
  });

  it("updates getToken callback when user changes", async () => {
    const { result, rerender } = renderHook(() => useAuthToken());

    // Mock user signing in
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "test@example.com", displayName: "Test User" },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    rerender();

    const token = await result.current.getToken();
    expect(token).toBe("mock-token-123");
  });
});
