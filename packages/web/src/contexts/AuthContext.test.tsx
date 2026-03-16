import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { useRef } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { AuthProvider, AuthContext, TestAuthProvider } from "./AuthContext";
import { TestServiceProvider } from "./ServiceContext";
import { ToastProvider } from "./ToastContext";
import { MockAuthService } from "../services/auth/MockAuthService";

// Mock the API client — AuthProvider calls configureClientAuth on mount
vi.mock("../api/client", () => ({
  configureClientAuth: vi.fn(),
}));

// Silence logger during tests
vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function useAuthContext() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("No AuthContext");
  return ctx;
}

describe("AuthProvider", () => {
  let mockAuthService: MockAuthService;

  function createWrapper(authService: MockAuthService) {
    return ({ children }: { children: React.ReactNode }) => (
      <TestServiceProvider authService={authService}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </TestServiceProvider>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService = new MockAuthService();
  });

  it("starts in loading state", () => {
    // Prevent immediate auth callback by using a service that doesn't auto-fire
    const lazyAuth = new MockAuthService();
    // Override onAuthStateChanged to not call back immediately
    lazyAuth.onAuthStateChanged = vi.fn().mockReturnValue(() => {});

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(lazyAuth),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("resolves to unauthenticated when no user", async () => {
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(mockAuthService),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("provides user when authenticated", async () => {
    const user = MockAuthService.createMockUser({ uid: "u1", displayName: "Alice" });
    mockAuthService = new MockAuthService(user);

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(mockAuthService),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(user);
  });

  it("signIn delegates to auth service", async () => {
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(mockAuthService),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn();
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.uid).toBe("test-user-123");
  });

  it("signOut clears the user", async () => {
    mockAuthService = new MockAuthService(MockAuthService.createMockUser());

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(mockAuthService),
    });

    await waitFor(() => expect(result.current.user).not.toBeNull());

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
  });

  it("sets error on signIn failure", async () => {
    mockAuthService.signIn = vi.fn().mockRejectedValue(new Error("Auth failed"));

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(mockAuthService),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // signIn re-throws — catch it so the test doesn't fail
    await act(async () => {
      try {
        await result.current.signIn();
      } catch {
        // expected
      }
    });

    expect(result.current.error?.message).toBe("Auth failed");
  });

  it("does not re-render when user reference changes but values are equal", async () => {
    const user1 = MockAuthService.createMockUser({ uid: "u1" });
    mockAuthService = new MockAuthService(user1);

    function CountingHook() {
      const renderCount = useRef(0);
      renderCount.current++;
      return { ...useAuthContext(), renderCount };
    }

    const { result } = renderHook(() => CountingHook(), {
      wrapper: createWrapper(mockAuthService),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const countAfterInit = result.current.renderCount.current;

    // Set a new object with the same values — should not cause re-render
    act(() => {
      mockAuthService.setCurrentUser({ ...user1 });
    });

    expect(result.current.renderCount.current).toBe(countAfterInit);
  });
});

describe("TestAuthProvider", () => {
  it("provides static auth state for tests", () => {
    const user = MockAuthService.createMockUser({ uid: "test-1" });
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: ({ children }) => (
        <TestAuthProvider user={user} loading={false}>
          {children}
        </TestAuthProvider>
      ),
    });

    expect(result.current.user).toEqual(user);
    expect(result.current.loading).toBe(false);
  });

  it("defaults to unauthenticated", () => {
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: ({ children }) => <TestAuthProvider>{children}</TestAuthProvider>,
    });

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
