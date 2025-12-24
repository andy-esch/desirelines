/**
 * Centralized configuration module with runtime validation.
 *
 * This module provides type-safe access to all environment variables
 * with Zod validation to catch configuration errors early.
 *
 * Environment variables are validated once at startup and cached.
 * Invalid configuration throws clear error messages before the app starts.
 */

import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Firebase configuration schema
 * All Firebase client config values are public identifiers, not secrets.
 * Security is enforced by Firebase Security Rules and Authentication.
 */
const FirebaseConfigSchema = z.object({
  apiKey: z.string().min(1, "Firebase API Key is required"),
  authDomain: z.string().min(1, "Firebase Auth Domain is required"),
  projectId: z.string().min(1, "Firebase Project ID is required"),
  storageBucket: z.string().optional(),
  messagingSenderId: z.string().optional(),
  appId: z.string().optional(),
  measurementId: z.string().optional(),
  firestoreDatabase: z.string().optional(),
});

/**
 * Emulator configuration schema
 * Settings for connecting to local Firestore emulator during development.
 * Note: Auth emulator requires full Firebase Emulator Suite (Java-based).
 * The gcloud SDK emulators image only supports Firestore, so auth uses cloud.
 */
const EmulatorConfigSchema = z.object({
  enabled: z.boolean(),
  firestoreHost: z.string().optional(),
  firestorePort: z.number().optional(),
});

/**
 * Application configuration schema
 * Defines all environment variables the app needs to function.
 */
const AppConfigSchema = z.object({
  // Environment metadata
  isDevelopment: z.boolean(),
  isProduction: z.boolean(),

  // API configuration
  apiGatewayUrl: z.string().url().optional(),

  // Firebase configuration
  firebase: FirebaseConfigSchema,

  // Emulator configuration (local development only)
  emulators: EmulatorConfigSchema,
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type FirebaseConfig = z.infer<typeof FirebaseConfigSchema>;
export type EmulatorConfig = z.infer<typeof EmulatorConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Loads and validates application configuration from environment variables.
 *
 * @throws {Error} If configuration is invalid with detailed error messages
 * @returns Validated configuration object
 */
export function loadConfig(): AppConfig {
  // Parse emulator settings
  const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
  const firestorePort = import.meta.env.VITE_FIRESTORE_EMULATOR_PORT;

  // Load raw environment variables
  const raw = {
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
    apiGatewayUrl: import.meta.env.VITE_API_GATEWAY_URL,
    firebase: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    },
    emulators: {
      enabled: useEmulators,
      firestoreHost: import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1",
      firestorePort: firestorePort ? parseInt(firestorePort, 10) : 8089,
    },
  };

  try {
    const validated = AppConfigSchema.parse(raw);

    // Additional validation: Check for placeholder values
    const placeholderPatterns = ["YOUR_PROD", "YOUR-PROD", "XXXXX", "TODO", "REPLACE", "CHANGEME"];

    for (const [key, value] of Object.entries(validated.firebase)) {
      if (typeof value === "string") {
        for (const pattern of placeholderPatterns) {
          if (value.includes(pattern)) {
            throw new Error(
              `Firebase ${key} appears to be a placeholder value: "${value}". ` +
                `Please replace with actual ${validated.isProduction ? "production" : "development"} credentials.`
            );
          }
        }
      }
    }

    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Format Zod validation errors into a readable message
      const issues = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return `  • ${path}: ${issue.message}`;
        })
        .join("\n");

      const errorMessage =
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Configuration Validation Failed\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `The following configuration errors were found:\n\n` +
        `${issues}\n\n` +
        `Please check your environment configuration files:\n` +
        `  • .env.{mode} (template with defaults)\n` +
        `  • .env.{mode}.local (your credentials)\n\n` +
        `See README.md for setup instructions.\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      throw new Error(errorMessage);
    }
    // Re-throw non-Zod errors
    throw error;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let configInstance: AppConfig | null = null;

/**
 * Gets the validated application configuration.
 * Configuration is loaded and validated once, then cached.
 *
 * @returns Validated configuration object
 * @throws {Error} If configuration is invalid
 */
export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();

    // Log configuration summary in development only (without sensitive values)
    if (configInstance.isDevelopment) {
      /* eslint-disable no-console */
      console.log("✓ Configuration loaded successfully");
      console.log(`  Environment: ${configInstance.isProduction ? "production" : "development"}`);
      console.log(`  Firebase project: ${configInstance.firebase.projectId}`);
      console.log(`  API Gateway: ${configInstance.apiGatewayUrl || "not configured"}`);
      if (configInstance.emulators.enabled) {
        console.log(
          `  Emulators: enabled (Firestore: ${configInstance.emulators.firestoreHost}:${configInstance.emulators.firestorePort})`
        );
      }
      /* eslint-enable no-console */
    }
  }

  return configInstance;
}

/**
 * Resets the configuration cache. Useful for testing.
 * @internal
 */
export function resetConfig(): void {
  configInstance = null;
}
