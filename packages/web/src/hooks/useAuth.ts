/**
 * Authentication hook
 *
 * Consumes auth state from AuthContext (single shared subscription).
 * All components using this hook share the same auth state — no per-component
 * Firebase listeners.
 *
 * - No user (null) → Unauthenticated mode (localStorage for config)
 * - With user → Authenticated mode (Firestore for config, API with auth token)
 */

import { useContext } from "react";
import { AuthContext } from "../contexts/AuthContext";
import type { AuthState } from "../contexts/AuthContext";
import type { User } from "../services/auth/AuthService";

export type { User, AuthState };

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
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return auth;
}
