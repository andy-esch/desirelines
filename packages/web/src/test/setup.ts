/**
 * Vitest test setup file
 *
 * This file runs before all tests to configure the testing environment.
 * It sets up jest-dom matchers for better DOM assertions.
 */

import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";

// --- jsdom polyfills for Base UI (Floating UI / pointer) components ---
// jsdom lacks ResizeObserver (Floating UI positioning needs it), scrollIntoView,
// and pointer-capture methods that Base UI's Menu/Select/Popover use — without
// these, popups never mount/position in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
// jsdom has no matchMedia; our media-query hooks (useIsMobile, useReducedMotion)
// call it. Default to "no match" (desktop / no-preference) with the event-listener
// interface they subscribe to. Tests can override window.matchMedia as needed.
if (typeof window.matchMedia === "undefined") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Mock Firebase to avoid initialization errors in tests
// Tests should mock Firebase services as needed
import { vi, beforeEach, afterEach } from "vitest";

// Suppress TanStack Router's internal act() warnings in tests.
// These are false positives: Transitioner, MatchImpl, and MatchesInner update
// state asynchronously after router.load(), but tests already await the load.
const originalConsoleError = console.error;
console.error = (...args: Parameters<typeof console.error>) => {
  if (typeof args[0] === "string" && args[0].includes("was not wrapped in act(")) {
    return;
  }
  originalConsoleError(...args);
};

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

globalThis.localStorage = new LocalStorageMock();

// Clear localStorage before each test
beforeEach(() => {
  globalThis.localStorage.clear();
});

// Cleanup after each test to prevent memory leaks
// This unmounts React components and cleans up JSDOM
afterEach(() => {
  cleanup();
  // Clear any pending timers
  vi.clearAllTimers();
});

// Mock the config module to return test values
// Individual tests can override this mock if they need a specific URL
const mockConfig = {
  isDevelopment: false,
  isProduction: false,
  useFixtures: true,
  apiGatewayUrl: "https://test-api-gateway.example.com",
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

// Note: The polling loop in src/lib/firebase.ts (waitForAuthReady) can keep
// Node.js alive. However, test files that use Firebase mock firebase/auth's
// onAuthStateChanged to immediately call the callback, which resolves the
// authReadyResolved flag and stops the polling.
//
// The teardownTimeout in vite.config.ts provides a safety net if any test
// doesn't properly mock Firebase.
