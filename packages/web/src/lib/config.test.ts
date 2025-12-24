import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Unmock the config module for these tests - we want to test the real implementation
vi.unmock("./config");

describe("config", () => {
  // Dynamically import to get the real module after unmocking
  let loadConfig: typeof import("./config").loadConfig;
  let resetConfig: typeof import("./config").resetConfig;

  beforeEach(async () => {
    // Import the real module
    const configModule = await import("./config");
    loadConfig = configModule.loadConfig;
    resetConfig = configModule.resetConfig;
    // Reset config singleton before each test
    resetConfig();
  });

  afterEach(() => {
    // Reset for next test
    resetConfig();
    vi.unstubAllEnvs();
  });

  describe("loadConfig", () => {
    it("should load firebase configuration from environment", () => {
      const config = loadConfig();

      expect(config.firebase).toBeDefined();
      expect(config.firebase.projectId).toBeDefined();
    });

    it("should have emulators config with defaults", () => {
      const config = loadConfig();

      expect(config.emulators).toBeDefined();
      expect(typeof config.emulators.enabled).toBe("boolean");
      expect(config.emulators.firestoreHost).toBeDefined();
      expect(config.emulators.firestorePort).toBeDefined();
    });

    it("should disable emulators by default", () => {
      const config = loadConfig();

      expect(config.emulators.enabled).toBe(false);
    });

    it("should set default Firestore emulator host and port", () => {
      const config = loadConfig();

      expect(config.emulators.firestoreHost).toBe("127.0.0.1");
      expect(config.emulators.firestorePort).toBe(8089);
    });
  });

  describe("emulator configuration", () => {
    it("should enable emulators when VITE_USE_FIREBASE_EMULATORS is true", () => {
      // Mock the env var
      vi.stubEnv("VITE_USE_FIREBASE_EMULATORS", "true");
      resetConfig(); // Reset to pick up new env

      const config = loadConfig();

      expect(config.emulators.enabled).toBe(true);
    });

    it("should use custom Firestore port when specified", () => {
      vi.stubEnv("VITE_FIRESTORE_EMULATOR_PORT", "9999");
      resetConfig();

      const config = loadConfig();

      expect(config.emulators.firestorePort).toBe(9999);
    });

    it("should use custom Firestore host when specified", () => {
      vi.stubEnv("VITE_FIRESTORE_EMULATOR_HOST", "192.168.1.100");
      resetConfig();

      const config = loadConfig();

      expect(config.emulators.firestoreHost).toBe("192.168.1.100");
    });
  });
});
