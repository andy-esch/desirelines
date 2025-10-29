/**
 * Application configuration
 * Uses Vite environment variables (import.meta.env.VITE_*)
 */

// Fixture mode: Use local fixture data instead of backend API
export const USE_FIXTURE_DATA = import.meta.env.VITE_USE_FIXTURES === "true";

// API Gateway URL (for backend mode)
export const API_BASE_URL = import.meta.env.VITE_API_GATEWAY_URL || "";

// Log config on load (helps debugging)
if (import.meta.env.DEV) {
  console.log("Config:", {
    USE_FIXTURE_DATA,
    API_BASE_URL,
    MODE: import.meta.env.MODE,
  });
}
