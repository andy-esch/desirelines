/**
 * Authentication hook using AuthService
 *
 * Provides authentication state and handles sign in/out.
 * Uses the AuthService from ServiceContext for Firebase abstraction.
 *
 * - No user (null) → Unauthenticated mode (localStorage for config)
 * - With user → Authenticated mode (Firestore for config, API with auth token)
 */

import { useState, useEffect } from "react";
import { useAuthService } from "../contexts/ServiceContext";
import type { User } from "../services/auth/AuthService";

export type { User };

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Hook for accessing authentication state and actions
 *
 * @returns Auth state with user, loading status, and auth actions
 *
 * @example
 * ```tsx
 * const { user, loading, signIn, signOut } = useAuth();
 *
 * if (loading) return <Spinner />;
 * if (!user) {
 *   return <button onClick={signIn}>Sign In with Google</button>;
 * } else {
 *   return <button onClick={signOut}>Sign Out</button>;
 * }
 * ```
 */
export function useAuth(): AuthState {
  const authService = useAuthService();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Subscribe to auth state changes
    const unsubscribe = authService.onAuthStateChanged((user) => {
      setUser(user);
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [authService]);

  const signIn = async () => {
    try {
      setError(null);
      await authService.signIn();
      // User state will be updated by onAuthStateChanged
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sign in failed");
      console.error("Sign in error:", error);
      setError(error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      await authService.signOut();
      // User state will be updated by onAuthStateChanged
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sign out failed");
      console.error("Sign out error:", error);
      setError(error);
      throw error;
    }
  };

  return {
    user,
    loading,
    error,
    signIn,
    signOut,
  };
}
