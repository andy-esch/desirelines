/**
 * Authentication service interface
 *
 * Abstracts authentication provider (Firebase, etc.) from application code.
 * Implementations handle provider-specific details while exposing a clean API.
 */

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
}

export interface AuthService {
  /**
   * Get currently authenticated user
   */
  getCurrentUser(): User | null;

  /**
   * Sign in with the configured provider (e.g., Google)
   */
  signIn(): Promise<void>;

  /**
   * Sign out current user
   */
  signOut(): Promise<void>;

  /**
   * Subscribe to auth state changes
   * @returns Unsubscribe function
   */
  onAuthStateChanged(callback: (user: User | null) => void): () => void;

  /**
   * Get ID token for current user (for API authentication).
   * Returns undefined if not authenticated.
   *
   * @param forceRefresh - When true, bypasses the token cache and requests a
   *   new token from the auth provider. Used by the 401 response interceptor
   *   to recover from stale tokens.
   */
  getIdToken(forceRefresh?: boolean): Promise<string | undefined>;

  /**
   * Wait for auth initialization to complete
   * Must be called before making authenticated API requests
   */
  waitForAuthReady(): Promise<void>;
}
