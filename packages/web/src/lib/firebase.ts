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
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getConfig } from "./config";

// Get validated configuration
const config = getConfig();

// Initialize Firebase app (single instance for entire application)
export const app: FirebaseApp = initializeApp(config.firebase);

// CRITICAL: Initialize Auth BEFORE Firestore
// The Firebase SDK requires Auth to be initialized first so that Firestore
// can automatically attach authentication tokens to requests for Security Rules
export const auth: Auth = getAuth(app);

// Initialize Firestore using the SAME app instance as Auth
// This ensures Firestore can access the authentication state
// Note: Emulator only supports (default) database, not named databases
const databaseId = config.emulators.enabled
  ? "(default)"
  : config.firebase.firestoreDatabase || "desirelines-user-configs";
export const db: Firestore = getFirestore(app, databaseId);

// Connect to Firebase emulators in development mode
if (config.emulators.enabled) {
  /* eslint-disable no-console */
  const { firestoreHost, firestorePort } = config.emulators;

  // Connect Firestore emulator
  // Note: Auth emulator requires full Firebase Emulator Suite (not available in gcloud SDK image)
  // When using gcloud emulators, auth continues to use cloud Firebase
  if (firestoreHost && firestorePort) {
    try {
      connectFirestoreEmulator(db, firestoreHost, firestorePort);
      console.log(`🔥 Firestore emulator connected: ${firestoreHost}:${firestorePort} (database: ${databaseId})`);
    } catch {
      console.warn(`⚠️ Firestore emulator not available at ${firestoreHost}:${firestorePort}`);
    }
  }
  /* eslint-enable no-console */
}

// Promise that resolves when initial auth state is determined
// CRITICAL: Firestore subscriptions MUST wait for this to avoid permission errors
let authReadyResolved = false;
let unsubscribeAuthReady: (() => void) | undefined;

// Set up one-time listener for initial auth state
// eslint-disable-next-line prefer-const -- Cannot use const due to callback accessing it before initialization
unsubscribeAuthReady = onAuthStateChanged(auth, (_user) => {
  if (!authReadyResolved) {
    authReadyResolved = true;
    if (unsubscribeAuthReady) {
      unsubscribeAuthReady(); // Only need first event
    }
  }
});

const authReadyPromise = new Promise<void>((resolve) => {
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
