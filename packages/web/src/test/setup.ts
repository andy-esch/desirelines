/**
 * Vitest test setup file
 *
 * This file runs before all tests to configure the testing environment.
 * It sets up jest-dom matchers for better DOM assertions.
 */

import "@testing-library/jest-dom";

// Mock Firebase to avoid initialization errors in tests
// Tests should mock Firebase services as needed
import { vi, beforeEach } from "vitest";

// Setup localStorage mock for tests
class LocalStorageMock {
  private store: Record<string, string> = {};

  clear() {
    this.store = {};
  }

  getItem(key: string) {
    return this.store[key] || null;
  }

  setItem(key: string, value: string) {
    this.store[key] = value.toString();
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  get length() {
    return Object.keys(this.store).length;
  }

  key(index: number) {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

global.localStorage = new LocalStorageMock() as Storage;

// Clear localStorage before each test
beforeEach(() => {
  global.localStorage.clear();
});

// Mock the config module to return test values
// Note: apiGatewayUrl is undefined by default to match test expectations
// Individual tests can override this mock if they need a specific URL
const mockConfig = {
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
  emulators: {
    enabled: false,
    firestoreHost: "127.0.0.1",
    firestorePort: 8089,
  },
};

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getConfig: vi.fn(() => mockConfig),
}));
