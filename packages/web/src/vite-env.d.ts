/// <reference types="vite/client" />

declare const __COMMIT_HASH__: string;

interface Window {
  DESIRELINES_VERSION: string;
}

/**
 * Type definitions for environment variables.
 * These are loaded from .env files and accessed via import.meta.env
 */
interface ImportMetaEnv {
  // Vite built-in variables
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;

  // Application configuration
  readonly VITE_API_GATEWAY_URL?: string;

  // Mapbox public access token for the /routes map (public, URL-restricted pk.*)
  readonly VITE_MAPBOX_TOKEN?: string;

  // Firebase configuration (production project)
  // These are public identifiers, not secrets
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;

  // Firebase emulator configuration (local development)
  readonly VITE_USE_FIREBASE_EMULATORS?: string;
  readonly VITE_AUTH_EMULATOR_HOST?: string;
  readonly VITE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_FIRESTORE_EMULATOR_HOST?: string;
  readonly VITE_FIRESTORE_EMULATOR_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
