/**
 * Integration test setup for Firebase Emulator tests
 *
 * This file configures the Firebase SDK to connect to local emulators
 * instead of production Firebase services.
 *
 * IMPORTANT: This setup assumes Firebase emulators are running.
 * Use `npm run test:integration` which starts emulators automatically.
 */

import "@testing-library/jest-dom";
import { initializeApp, getApps, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { afterAll, beforeAll } from "vitest";

// Emulator configuration
const EMULATOR_CONFIG = {
  projectId: "demo-test-project", // Special Firebase emulator project ID
  apiKey: "fake-api-key", // Emulator doesn't validate API key
  authDomain: "localhost",
};

const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
};

// Clean up any existing Firebase instances
const existingApps = getApps();
existingApps.forEach((app) => deleteApp(app));

// Initialize test Firebase app IMMEDIATELY (before any imports)
const testApp = initializeApp(EMULATOR_CONFIG);
const testAuth = getAuth(testApp);
const testDb = getFirestore(testApp);

// Connect to emulators
try {
  connectAuthEmulator(testAuth, `http://127.0.0.1:${EMULATOR_PORTS.auth}`, {
    disableWarnings: true,
  });
} catch {
  // Emulator already connected (ignore error)
}

try {
  connectFirestoreEmulator(testDb, "127.0.0.1", EMULATOR_PORTS.firestore);
} catch {
  // Emulator already connected (ignore error)
}

beforeAll(() => {
  console.log("✓ Connected to Firebase emulators");
  console.log(`  Auth:      http://127.0.0.1:${EMULATOR_PORTS.auth}`);
  console.log(`  Firestore: http://127.0.0.1:${EMULATOR_PORTS.firestore}`);
  console.log(`  UI:        http://127.0.0.1:4000`);
});

afterAll(async () => {
  // Clean up Firebase instances
  if (testApp) {
    await deleteApp(testApp);
  }
});

// Export test instances for use in tests
export { testApp, testAuth, testDb };
