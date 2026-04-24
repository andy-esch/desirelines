/**
 * Mock implementation of AuthService for testing
 *
 * Provides controllable auth state without Firebase dependencies.
 * Use setCurrentUser() to simulate auth state changes in tests.
 */

import type { AuthService, User } from "./AuthService";

export class MockAuthService implements AuthService {
  private currentUser: User | null = null;
  private listeners: Set<(user: User | null) => void> = new Set();
  private authReady = true;

  constructor(initialUser: User | null = null) {
    this.currentUser = initialUser;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  signIn(): Promise<void> {
    this.currentUser = {
      uid: "test-user-123",
      email: "test@example.com",
      displayName: "Test User",
      photoURL: null,
    };
    this.notifyListeners();
    return Promise.resolve();
  }

  signInWithToken(_customToken: string): Promise<void> {
    this.currentUser = {
      uid: "test-user-123",
      email: null,
      displayName: "Test User",
      photoURL: null,
    };
    this.notifyListeners();
    return Promise.resolve();
  }

  signOut(): Promise<void> {
    this.currentUser = null;
    this.notifyListeners();
    return Promise.resolve();
  }

  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    this.listeners.add(callback);
    // Immediately call with current state (matches Firebase behavior)
    callback(this.currentUser);

    return () => {
      this.listeners.delete(callback);
    };
  }

  getIdToken(_forceRefresh?: boolean): Promise<string | undefined> {
    if (!this.currentUser) return Promise.resolve(undefined);
    return Promise.resolve(`mock-token-${this.currentUser.uid}`);
  }

  async waitForAuthReady(): Promise<void> {
    // Can be configured to delay for testing loading states
    if (!this.authReady) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.currentUser));
  }

  // ============================================
  // Test helper methods (not part of interface)
  // ============================================

  /**
   * Set the current user (triggers auth state change)
   */
  setCurrentUser(user: User | null): void {
    this.currentUser = user;
    this.notifyListeners();
  }

  /**
   * Set whether auth is ready (for testing loading states)
   */
  setAuthReady(ready: boolean): void {
    this.authReady = ready;
  }

  /**
   * Create a mock user with custom properties
   */
  static createMockUser(overrides: Partial<User> = {}): User {
    return {
      uid: "test-user-123",
      email: "test@example.com",
      displayName: "Test User",
      photoURL: null,
      ...overrides,
    };
  }
}
