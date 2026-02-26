/**
 * Auth Context Provider
 *
 * Single source of truth for authentication state. Maintains one
 * onAuthStateChanged subscription instead of per-component subscriptions.
 *
 * - No user (null) → Unauthenticated mode (localStorage for config)
 * - With user → Authenticated mode (Firestore for config, API with auth token)
 */

import React, { createContext, useState, useEffect, useCallback, useMemo } from "react";
import { useAuthService } from "./ServiceContext";
import { useToast } from "./ToastContext";
import type { User } from "../services/auth/AuthService";
import { configureClientAuth } from "../api/client";

export type { User };

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

/**
 * Shallow-compare two User objects by value.
 * Firebase's onAuthStateChanged fires with a new object reference on every
 * callback (including token refreshes), even when the user hasn't changed.
 * Without this, every callback would propagate a new reference through context
 * and re-render all consumers.
 */
function usersEqual(a: User | null, b: User | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.uid === b.uid &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.photoURL === b.photoURL
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authService = useAuthService();
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Configure API client auth interceptor.
  // useEffect is sufficient here since configureClientAuth only registers an
  // axios interceptor (no DOM measurement). The interceptor itself waits for
  // auth readiness via waitForAuthReady(), so requests made before configuration
  // completes will be handled gracefully once the interceptor is registered.
  useEffect(() => {
    configureClientAuth(authService);
  }, [authService]);

  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((newUser) => {
      setUser((prev) => (usersEqual(prev, newUser) ? prev : newUser));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [authService]);

  const signIn = useCallback(async () => {
    try {
      setError(null);
      await authService.signIn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sign in failed");
      console.error("Sign in error:", error);
      setError(error);
      throw error;
    }
  }, [authService]);

  const signOut = useCallback(async () => {
    try {
      setError(null);
      await authService.signOut();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sign out failed");
      console.error("Sign out error:", error);
      setError(error);
      throw error;
    }
    showToast("Signed out");
  }, [authService, showToast]);

  const value = useMemo(
    () => ({ user, loading, error, signIn, signOut }),
    [user, loading, error, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Test auth provider - provides static auth state for tests.
 * Defaults to unauthenticated (user: null, loading: false).
 */
export function TestAuthProvider({
  children,
  user = null,
  loading = false,
  error = null,
  signIn,
  signOut,
}: {
  children: React.ReactNode;
  user?: User | null;
  loading?: boolean;
  error?: Error | null;
  signIn?: () => Promise<void>;
  signOut?: () => Promise<void>;
}) {
  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      signIn: signIn ?? (async () => {}),
      signOut: signOut ?? (async () => {}),
    }),
    [user, loading, error, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
