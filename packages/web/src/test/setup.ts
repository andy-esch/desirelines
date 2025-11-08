/**
 * Vitest test setup file
 *
 * This file runs before all tests to configure the testing environment.
 * It sets up jest-dom matchers for better DOM assertions.
 */

import "@testing-library/jest-dom";

// Mock Firebase to avoid initialization errors in tests
// Tests should mock Firebase services as needed
import { vi } from "vitest";

// Mock the config module to return test values
// Note: apiGatewayUrl is undefined by default to match test expectations
// Individual tests can override this mock if they need a specific URL
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(() => ({
    isDevelopment: false,
    isProduction: false,
    useFixtures: true,
    apiGatewayUrl: undefined, // No URL by default - tests expect localhost fallback
    firebase: {
      apiKey: "test-api-key-for-vitest",
      authDomain: "test-project.firebaseapp.com",
      projectId: "test-project",
      storageBucket: "test-project.firebasestorage.app",
      messagingSenderId: "123456789012",
      appId: "1:123456789012:web:test",
      measurementId: "G-TEST",
    },
  })),
  getConfig: vi.fn(() => ({
    isDevelopment: false,
    isProduction: false,
    useFixtures: true,
    apiGatewayUrl: undefined, // No URL by default - tests expect localhost fallback
    firebase: {
      apiKey: "test-api-key-for-vitest",
      authDomain: "test-project.firebaseapp.com",
      projectId: "test-project",
      storageBucket: "test-project.firebasestorage.app",
      messagingSenderId: "123456789012",
      appId: "1:123456789012:web:test",
      measurementId: "G-TEST",
    },
  })),
}));
