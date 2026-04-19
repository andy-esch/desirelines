import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Unmock the config module for these tests - we want to test the real implementation
vi.unmock("./config");

describe("config", () => {
  // Dynamically import to get the real module after unmocking
  let loadConfig: typeof import("./config").loadConfig;
  let resetConfig: typeof import("./config").resetConfig;
  let isValidApiGatewayUrl: typeof import("./config").isValidApiGatewayUrl;

  beforeEach(async () => {
    // Stub required Firebase env vars (CI doesn't have these)
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");

    // Import the real module
    const configModule = await import("./config");
    loadConfig = configModule.loadConfig;
    resetConfig = configModule.resetConfig;
    isValidApiGatewayUrl = configModule.isValidApiGatewayUrl;
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
      expect(config.emulators.authHost).toBeDefined();
      expect(config.emulators.authPort).toBeDefined();
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

    it("should set default Auth emulator host and port", () => {
      const config = loadConfig();

      expect(config.emulators.authHost).toBe("127.0.0.1");
      expect(config.emulators.authPort).toBe(9099);
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

    it("should use custom Auth port when specified", () => {
      vi.stubEnv("VITE_AUTH_EMULATOR_PORT", "9199");
      resetConfig();

      const config = loadConfig();

      expect(config.emulators.authPort).toBe(9199);
    });

    it("should use custom Auth host when specified", () => {
      vi.stubEnv("VITE_AUTH_EMULATOR_HOST", "192.168.1.100");
      resetConfig();

      const config = loadConfig();

      expect(config.emulators.authHost).toBe("192.168.1.100");
    });
  });

  // ---------------------------------------------------------------------------
  // isValidApiGatewayUrl — unit tests for the extracted validator
  //
  // This is the security-adjacent validator that decides which values are
  // accepted for VITE_API_GATEWAY_URL. A permissive bug masks misconfiguration
  // until runtime; a restrictive bug crashes the SPA on boot (as happened when
  // z.string().url() rejected the relative path "/api" in production).
  // ---------------------------------------------------------------------------

  describe("isValidApiGatewayUrl", () => {
    // -- Same-origin relative paths (Firebase Hosting proxy mode) -------------

    it("accepts /api (production Firebase Hosting proxy)", () => {
      expect(isValidApiGatewayUrl("/api")).toBe(true);
    });

    it("accepts /api/v1 (explicit subpath variant)", () => {
      expect(isValidApiGatewayUrl("/api/v1")).toBe(true);
    });

    it("accepts /longer/nested/path", () => {
      expect(isValidApiGatewayUrl("/longer/nested/path")).toBe(true);
    });

    // -- Absolute HTTP(S) URLs ------------------------------------------------

    it("accepts http://localhost:8084 (local dev)", () => {
      expect(isValidApiGatewayUrl("http://localhost:8084")).toBe(true);
    });

    it("accepts http://localhost:8084/ (trailing slash)", () => {
      expect(isValidApiGatewayUrl("http://localhost:8084/")).toBe(true);
    });

    it("accepts https://api.example.com", () => {
      expect(isValidApiGatewayUrl("https://api.example.com")).toBe(true);
    });

    it("accepts https://api-gateway-abc123.run.app (Cloud Run rollback)", () => {
      expect(isValidApiGatewayUrl("https://api-gateway-abc123.run.app")).toBe(true);
    });

    // -- Bare slash: rejected because ${val}/v1 produces //v1 -----------------
    // A bare "/" would produce "//v1" when the axios client appends "/v1",
    // creating a protocol-relative URL that leaks auth tokens to host "v1".

    it("rejects / (bare slash produces //v1 — protocol-relative URL)", () => {
      expect(isValidApiGatewayUrl("/")).toBe(false);
    });

    // -- Protocol-relative URLs: rejected to prevent auth token leakage -------
    // These start with "/" so they pass startsWith("/"), but they target a
    // different host. The browser resolves them against the current scheme,
    // silently sending requests (with auth headers) to a third party.

    it("rejects //example.com/api (protocol-relative, different host)", () => {
      expect(isValidApiGatewayUrl("//example.com/api")).toBe(false);
    });

    it("rejects //attacker.com (protocol-relative, different host)", () => {
      expect(isValidApiGatewayUrl("//attacker.com")).toBe(false);
    });

    // -- Non-HTTP schemes: syntactically valid but not usable -----------------
    // These parse with new URL() but would fail at the axios transport layer.
    // Rejecting at boot gives a clear error instead of a confusing runtime failure.

    it("rejects file:///etc/passwd (non-HTTP scheme)", () => {
      expect(isValidApiGatewayUrl("file:///etc/passwd")).toBe(false);
    });

    it("rejects javascript:alert(1) (non-HTTP scheme)", () => {
      expect(isValidApiGatewayUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects ftp://server/path (non-HTTP scheme)", () => {
      expect(isValidApiGatewayUrl("ftp://server/path")).toBe(false);
    });

    // -- Strings that are neither valid paths nor valid URLs -------------------

    it("rejects empty string", () => {
      expect(isValidApiGatewayUrl("")).toBe(false);
    });

    it('rejects "api" (missing leading slash, not a URL)', () => {
      expect(isValidApiGatewayUrl("api")).toBe(false);
    });

    it('rejects "api/v1" (relative path without leading slash)', () => {
      expect(isValidApiGatewayUrl("api/v1")).toBe(false);
    });

    it('rejects "localhost:8084" (no scheme — new URL() throws)', () => {
      expect(isValidApiGatewayUrl("localhost:8084")).toBe(false);
    });

    it('rejects "not a url at all" (arbitrary garbage)', () => {
      expect(isValidApiGatewayUrl("not a url at all")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // apiGatewayUrl validation — integration tests through loadConfig()
  //
  // These verify the Zod schema wiring end-to-end: the .refine() closure calls
  // isValidApiGatewayUrl, the .optional() allows undefined, and the error
  // formatter produces a message containing both the field name and the custom
  // refinement message. Testing through loadConfig() catches integration issues
  // that unit-testing the helper alone would miss (e.g. the schema not calling
  // the helper, the error format changing, the optional() being removed).
  // ---------------------------------------------------------------------------

  describe("apiGatewayUrl validation", () => {
    /** Substring from the custom refinement error message. */
    const REFINEMENT_MSG = "Must be an http(s) URL";

    // -- Valid values: loadConfig() succeeds and returns the value unchanged ---

    describe("valid values", () => {
      it.each([
        { input: "/api", desc: "Firebase Hosting proxy mode (prod)" },
        { input: "/api/v1", desc: "explicit subpath variant" },
        { input: "http://localhost:8084", desc: "local dev" },
        { input: "http://localhost:8084/", desc: "local dev with trailing slash" },
        { input: "https://api.example.com", desc: "absolute HTTPS URL" },
        { input: "https://api-gateway-abc123.run.app", desc: "Cloud Run URL (rollback)" },
      ])("accepts $input ($desc)", ({ input }) => {
        vi.stubEnv("VITE_API_GATEWAY_URL", input);
        resetConfig();

        const config = loadConfig();
        expect(config.apiGatewayUrl).toBe(input);
      });

      it("accepts undefined (optional field — env var not set)", () => {
        // Ensure the env var is NOT set by unstubbing everything, then
        // re-stubbing only the required Firebase fields.
        vi.unstubAllEnvs();
        vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
        vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
        vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");
        resetConfig();

        const config = loadConfig();
        expect(config.apiGatewayUrl).toBeUndefined();
      });
    });

    // -- Invalid values: loadConfig() throws with the refinement message ------
    //
    // Each case asserts three things:
    // 1. loadConfig() throws (the value is rejected)
    // 2. The error message contains "apiGatewayUrl" (identifies the failing field)
    // 3. The error message contains the refinement message (confirms the refine()
    //    is what rejected it, not some other validator)

    describe("invalid values", () => {
      it.each([
        { input: "", desc: "empty string" },
        { input: "/", desc: "bare slash (//v1 protocol-relative risk)" },
        { input: "api", desc: "missing leading slash, not a URL" },
        { input: "api/v1", desc: "relative path without leading slash" },
        { input: "localhost:8084", desc: "no scheme — not parseable as URL" },
        { input: "not a url at all", desc: "arbitrary garbage" },
        { input: "//example.com/api", desc: "protocol-relative (different host)" },
        { input: "//attacker.com", desc: "protocol-relative (attacker host)" },
        { input: "file:///etc/passwd", desc: "non-HTTP scheme (file:)" },
        { input: "javascript:alert(1)", desc: "non-HTTP scheme (javascript:)" },
        { input: "ftp://server/path", desc: "non-HTTP scheme (ftp:)" },
      ])("rejects $input ($desc)", ({ input }) => {
        vi.stubEnv("VITE_API_GATEWAY_URL", input);
        resetConfig();

        expect(() => loadConfig()).toThrow();

        try {
          loadConfig();
        } catch (e) {
          const msg = (e as Error).message;
          expect(msg).toContain("apiGatewayUrl");
          expect(msg).toContain(REFINEMENT_MSG);
        }
      });
    });
  });
});
