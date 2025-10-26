/**
 * Authentication hook (stub for Stage 2)
 * Returns null user until Firebase Auth is implemented in Stage 3
 *
 * This allows smart mode logic to work:
 * - No user (null) → Show fixtures
 * - With user → Show backend data
 */

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthState {
  user: User | null;
  loading: boolean;
}

/**
 * Hook for accessing authentication state
 *
 * @returns Auth state with user and loading status
 *
 * @example
 * ```tsx
 * const { user, loading } = useAuth();
 *
 * if (loading) return <Spinner />;
 * if (!user) {
 *   // Show demo data (fixtures)
 * } else {
 *   // Show personal data from backend
 * }
 * ```
 */
export function useAuth(): AuthState {
  // Stage 2: Stub implementation (always returns null user)
  // Stage 3: Will be replaced with Firebase Auth
  return {
    user: null,
    loading: false,
  };
}
