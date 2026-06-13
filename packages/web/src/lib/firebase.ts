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
import { getAuth, connectAuthEmulator, onAuthStateChanged, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getConfig } from "./config";
import { logger } from "./logger";

// Get validated configuration
const config = getConfig();

// Strip undefined values from optional Firebase config fields. Under
// exactOptionalPropertyTypes, FirebaseOptions disallows explicit `undefined` —
// omit the keys instead.
const firebaseOptions = Object.fromEntries(
  Object.entries(config.firebase).filter(([, v]) => v !== undefined)
);

// Initialize Firebase app (single instance for entire application)
const app: FirebaseApp = initializeApp(firebaseOptions);

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

// Connect to Firebase emulators (config validation prevents this in production)
if (config.emulators.enabled) {
  const { authHost, authPort, firestoreHost, firestorePort } = config.emulators;

  // Connect Auth emulator
  if (authHost && authPort) {
    try {
      connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
      logger.info(`Auth emulator connected: ${authHost}:${authPort}`);
    } catch {
      logger.warn(`Auth emulator not available at ${authHost}:${authPort}`);
    }
  }

  // Connect Firestore emulator
  if (firestoreHost && firestorePort) {
    try {
      connectFirestoreEmulator(db, firestoreHost, firestorePort);
      logger.info(
        `Firestore emulator connected: ${firestoreHost}:${firestorePort} (database: ${databaseId})`
      );
    } catch {
      logger.warn(`Firestore emulator not available at ${firestoreHost}:${firestorePort}`);
    }
  }
}

// Promise that resolves when initial auth state is determined
// CRITICAL: Firestore subscriptions MUST wait for this to avoid permission errors
const authReadyPromise = new Promise<void>((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, () => {
    resolve();
    unsubscribe();
  });
});

/**
 * Wait for Firebase Auth initial state to be determined
 * MUST be called before setting up Firestore subscriptions to avoid
 * "Missing or insufficient permissions" errors
 */
export async function waitForAuthReady(): Promise<void> {
  await authReadyPromise;
}
