/**
 * Authentication hook using Firebase Auth
 *
 * Provides authentication state and handles sign in/out
 * - No user (null) → Unauthenticated mode (localStorage for config)
 * - With user → Authenticated mode (Firestore for config, API with auth token)
 */

import { useState, useEffect } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  type User as FirebaseUser,
} from "firebase/auth";
import { getFirebaseAuth } from "../lib/firebase";

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}

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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();

    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        // User is signed in
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
        });
      } else {
        // User is signed out
        setUser(null);
      }
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();

    try {
      setError(null); // Clear previous errors
      await signInWithPopup(auth, provider);
      // User state will be updated by onAuthStateChanged
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sign in failed");
      console.error("Sign in error:", error);
      setError(error);
      throw error;
    }
  };

  const signOut = async () => {
    const auth = getFirebaseAuth();

    try {
      setError(null); // Clear previous errors
      await firebaseSignOut(auth);
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
