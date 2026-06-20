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
    maxWorkers: 1,
    // Coverage is written to a separate directory so the integration run can be
    // uploaded to Codecov under its own flag without clobbering the unit-test
    // lcov report (see the web-integration upload in .github/workflows/ci.yml).
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage-integration",
      exclude: [
        "node_modules/",
        "src/test/setup.ts",
        "src/test/integration-setup.ts",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.integration.test.{ts,tsx}",
        "vite.config.ts",
        "vitest.integration.config.ts",
        // Exclude generated protobuf code - machine-generated, tested via usage
        "src/types/generated/**",
      ],
    },
  },
});
