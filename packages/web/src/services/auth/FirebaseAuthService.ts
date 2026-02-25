/**
 * Firebase Auth implementation of AuthService
 *
 * Wraps Firebase Auth SDK to provide a clean interface for the application.
 * All Firebase-specific code is contained here.
 */

import {
  signInWithCustomToken,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth, waitForAuthReady as firebaseWaitForAuthReady } from "../../lib/firebase";
import type { AuthService, User } from "./AuthService";

/**
 * Convert Firebase User to our User interface
 */
function toUser(firebaseUser: FirebaseUser): User {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
  };
}

export class FirebaseAuthService implements AuthService {
  getCurrentUser(): User | null {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return null;
    return toUser(firebaseUser);
  }

  async signIn(): Promise<void> {
    // Full page redirect to API gateway OAuth endpoint.
    // After Strava approval, the gateway redirects back to /auth/complete#token=...
    window.location.href = `${import.meta.env.VITE_API_GATEWAY_URL}/auth/strava`;
    // Page navigates away — return a never-resolving promise to prevent callers from proceeding.
    return new Promise(() => {});
  }

  async signInWithToken(customToken: string): Promise<void> {
    await signInWithCustomToken(auth, customToken);
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(auth);
  }

  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    return firebaseOnAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        callback(null);
        return;
      }
      callback(toUser(firebaseUser));
    });
  }

  /** {@inheritDoc AuthService.getIdToken} */
  async getIdToken(forceRefresh?: boolean): Promise<string | undefined> {
    const user = auth.currentUser;
    if (!user) return undefined;
    return await user.getIdToken(forceRefresh);
  }

  async waitForAuthReady(): Promise<void> {
    await firebaseWaitForAuthReady();
  }
}
