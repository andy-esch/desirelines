/**
 * Firebase initialization and configuration
 *
 * CRITICAL: This file uses eager initialization (module-load time) which is the
 * recommended pattern for Firebase v9+ modular SDK. Both Auth and Firestore must
 * be initialized from the SAME app instance for authentication to work properly.
 *
 * Firebase configuration is loaded from src/lib/config.ts with validation.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getConfig } from "./config";

// Get validated configuration
const config = getConfig();

// Initialize Firebase app (single instance for entire application)
export const app: FirebaseApp = initializeApp(config.firebase);

// eslint-disable-next-line no-console
console.log(`✓ Firebase initialized (project: ${config.firebase.projectId})`);

// CRITICAL: Initialize Auth BEFORE Firestore
// The Firebase SDK requires Auth to be initialized first so that Firestore
// can automatically attach authentication tokens to requests for Security Rules
export const auth: Auth = getAuth(app);

// DEBUG: Log auth instance details
console.log('🔐 Auth initialized:', {
  app: auth.app.name,
  currentUser: auth.currentUser?.uid || 'none',
});

// Initialize Firestore using the SAME app instance as Auth
// This ensures Firestore can access the authentication state
export const db: Firestore = getFirestore(app);

// DEBUG: Verify both services use same app
console.log('🔥 Firestore initialized:', {
  app: db.app.name,
  sameAppAsAuth: db.app === auth.app,
});

// Promise that resolves when initial auth state is determined
// CRITICAL: Firestore subscriptions MUST wait for this to avoid permission errors
let authReadyPromise: Promise<void> | undefined;
let authReadyResolved = false;

// Set up one-time listener for initial auth state
const unsubscribeAuthReady = onAuthStateChanged(auth, (user) => {
  if (!authReadyResolved) {
    authReadyResolved = true;
    console.log('🔓 Auth ready:', user ? `User: ${user.uid}` : 'No user');
    unsubscribeAuthReady(); // Only need first event
  }
});

authReadyPromise = new Promise<void>((resolve) => {
  const checkReady = () => {
    if (authReadyResolved) {
      resolve();
    } else {
      setTimeout(checkReady, 10);
    }
  };
  checkReady();
});

/**
 * Wait for Firebase Auth initial state to be determined
 * MUST be called before setting up Firestore subscriptions to avoid
 * "Missing or insufficient permissions" errors
 */
export async function waitForAuthReady(): Promise<void> {
  if (authReadyPromise) {
    await authReadyPromise;
  }
}

// Legacy function exports for backward compatibility
export function getFirebaseAuth(): Auth {
  return auth;
}

export function getFirebaseFirestore(): Firestore {
  return db;
}
