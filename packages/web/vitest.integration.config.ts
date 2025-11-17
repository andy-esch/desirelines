import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vitest configuration for integration tests
 *
 * Integration tests use Firebase emulators and test real service interactions.
 * These tests are slower than unit tests and should be run separately.
 *
 * Usage:
 *   npm run test:integration        - Run integration tests with emulators
 *   npm run emulators              - Start emulators manually for debugging
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    // Only run files matching *.integration.test.ts(x)
    include: ["**/*.integration.test.{ts,tsx}"],
    // Longer timeout for integration tests (emulator startup, network calls)
    testTimeout: 10000,
    hookTimeout: 30000,
    setupFiles: "./src/test/integration-setup.ts",
    css: true,
    // Sequential execution for integration tests (avoid emulator conflicts)
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
