import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuth } from "./useAuth";
import { TestAuthProvider } from "../contexts/AuthContext";
import type { User } from "../services/auth/AuthService";

describe("useAuth", () => {
  it("throws when used outside AuthProvider", () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");
  });

  it("returns auth state from AuthProvider", () => {
    const user: User = {
      uid: "u1",
      email: "a@b.com",
      displayName: "Test",
      photoURL: null,
    };

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <TestAuthProvider user={user} loading={false}>
          {children}
        </TestAuthProvider>
      ),
    });

    expect(result.current.user).toEqual(user);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns loading state", () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <TestAuthProvider loading={true}>{children}</TestAuthProvider>,
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("returns null user when unauthenticated", () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <TestAuthProvider>{children}</TestAuthProvider>,
    });

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
