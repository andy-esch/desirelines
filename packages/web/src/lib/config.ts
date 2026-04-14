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
import { logger } from "./logger";

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
 * Settings for connecting to local Firebase emulators during development.
 * Both Auth and Firestore emulators are supported via Firebase Emulator Suite.
 */
const EmulatorConfigSchema = z.object({
  enabled: z.boolean(),
  authHost: z.string().optional(),
  authPort: z.number().optional(),
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

  // API configuration.
  // Accepts either an absolute URL (e.g. "http://localhost:8084" for local dev)
  // or a same-origin relative path (e.g. "/api" when routing through Firebase
  // Hosting rewrites to Cloud Run). The axios client appends "/v1" to this value.
  apiGatewayUrl: z
    .string()
    .refine(
      (val) => {
        if (val.startsWith("/")) return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      {
        message:
          "Must be an absolute URL (e.g. http://localhost:8084) or a same-origin path starting with '/' (e.g. /api)",
      }
    )
    .optional(),

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
  const authPort = import.meta.env.VITE_AUTH_EMULATOR_PORT;
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
      authHost: import.meta.env.VITE_AUTH_EMULATOR_HOST || "127.0.0.1",
      authPort: authPort ? parseInt(authPort, 10) : 9099,
      firestoreHost: import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1",
      firestorePort: firestorePort ? parseInt(firestorePort, 10) : 8089,
    },
  };

  try {
    const validated = AppConfigSchema.parse(raw);

    // Reject emulator config in production builds
    if (validated.isProduction && validated.emulators.enabled) {
      throw new Error(
        "Firebase emulators cannot be enabled in production builds. " +
          "Remove VITE_USE_FIREBASE_EMULATORS from your production environment."
      );
    }

    // Additional validation: Check for placeholder values
    const placeholderPatterns = ["YOUR_", "YOUR-", "XXXXX", "TODO", "REPLACE", "CHANGEME"];

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

      throw new Error(errorMessage, { cause: error });
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
      logger.info("Configuration loaded successfully");
      logger.info(`  Environment: ${configInstance.isProduction ? "production" : "development"}`);
      logger.info(`  Firebase project: ${configInstance.firebase.projectId}`);
      logger.info(`  API Gateway: ${configInstance.apiGatewayUrl || "not configured"}`);
      if (configInstance.emulators.enabled) {
        logger.info(
          `  Emulators: enabled (Auth: ${configInstance.emulators.authHost}:${configInstance.emulators.authPort}, ` +
            `Firestore: ${configInstance.emulators.firestoreHost}:${configInstance.emulators.firestorePort})`
        );
      }
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
