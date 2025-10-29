/**
 * Firebase initialization and configuration
 *
 * This file initializes Firebase services used by the application.
 * Currently only uses Authentication, but structured to easily add
 * Firestore, Storage, etc. in the future.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Firebase configuration - loaded from environment variables
// These values are safe to commit - they're public identifiers
// Set in .env.development, .env.production, etc.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase (singleton pattern - lazy initialization)
let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function initializeFirebase(): FirebaseApp {
  // Check if already initialized
  const existingApps = getApps();

  if (existingApps.length > 0) {
    // App already exists, use it
    app = existingApps[0];
  } else {
    // Initialize new app
    app = initializeApp(firebaseConfig);
    console.log("Firebase initialized");
  }

  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    // Initialize Firebase if not already done
    initializeFirebase();
    auth = getAuth();
  }

  return auth;
}
