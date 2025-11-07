/**
 * Firebase initialization and configuration
 *
 * This file initializes Firebase services used by the application.
 * Provides Auth and Firestore services.
 *
 * Firebase configuration is loaded from src/lib/config.ts with validation.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getConfig } from "./config";

// Initialize Firebase (singleton pattern - lazy initialization)
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;

export function initializeFirebase(): FirebaseApp {
  // Check if already initialized
  const existingApps = getApps();

  if (existingApps.length > 0) {
    // App already exists, use it
    app = existingApps[0];
  } else {
    // Get validated configuration
    const config = getConfig();

    // Initialize new app with validated config
    app = initializeApp(config.firebase);
    console.log(`✓ Firebase initialized (project: ${config.firebase.projectId})`);
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

export function getFirebaseFirestore(): Firestore {
  if (!firestore) {
    // Initialize Firebase if not already done
    initializeFirebase();
    firestore = getFirestore();
  }

  return firestore;
}

// Convenience exports for common usage
export const db = getFirebaseFirestore();
