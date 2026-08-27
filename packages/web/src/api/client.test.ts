import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { AuthService } from "../services/auth/AuthService";

// Mock dependencies before importing the module under test
vi.mock("../lib/config", () => ({
  getConfig: () => ({ apiGatewayUrl: "https://api.example.com" }),
}));

// Spy on logger so the X-Trace-Id interceptor tests can assert debug output.
// Other test blocks ignore it; the mocked logger silently absorbs unrelated
// calls instead of writing to the real console during tests.
vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Shared mock auth service — configureClientAuth only registers interceptors
// once (singleton guard), so the same mock instance is captured in the closure
// for the entire test suite.
const mockAuthService: AuthService = {
  getCurrentUser: vi.fn().mockReturnValue({
    uid: "user-1",
    email: "a@b.com",
    displayName: "A",
    photoURL: null,
  }),
  signIn: vi.fn(),
  signInWithToken: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn().mockReturnValue(() => {}),
  getIdToken: vi.fn().mockResolvedValue("original-token"),
  waitForAuthReady: vi.fn().mockResolvedValue(undefined),
};

// Import after mocks are set up
import getClient, { configureClientAuth, resetClient } from "./client";
import { logger } from "../lib/logger";

const mockLogger = vi.mocked(logger);

let client: ReturnType<typeof getClient>;

describe("401 response interceptor", () => {
  let originalAdapter: ReturnType<typeof getClient>["defaults"]["adapter"];

  beforeEach(() => {
    // Reset client state for full test isolation — each test gets a fresh
    // axios instance with its own interceptor chain.
    resetClient();
    client = getClient();
    configureClientAuth(mockAuthService);
    originalAdapter = client.defaults.adapter;
    vi.mocked(mockAuthService.getIdToken).mockReset().mockResolvedValue("original-token");
  });

  afterEach(() => {
    if (originalAdapter === undefined) {
      delete client.defaults.adapter;
    } else {
      client.defaults.adapter = originalAdapter;
    }
  });

  it("should retry a 401 response once with a force-refreshed token", async () => {
    const successData = { data: "ok" };

    // Mock adapter: first call returns 401, second returns 200
    let callCount = 0;
    const adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(createAxiosError(401, config));
      }
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: successData,
      });
    });
    client.defaults.adapter = adapter;

    vi.mocked(mockAuthService.getIdToken).mockResolvedValueOnce("refreshed-token");

    const response = await client.get("test");

    expect(response.data).toEqual(successData);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(mockAuthService.getIdToken).toHaveBeenCalledWith(true);
  });

  it("should not retry more than once (prevents infinite loops)", async () => {
    const adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      return Promise.reject(createAxiosError(401, config));
    });
    client.defaults.adapter = adapter;

    vi.mocked(mockAuthService.getIdToken).mockResolvedValue("refreshed-token");

    await expect(client.get("test")).rejects.toThrow();
    // Original request + 1 retry = 2 calls, not infinite
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-401 errors", async () => {
    const adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      return Promise.reject(createAxiosError(500, config));
    });
    client.defaults.adapter = adapter;

    await expect(client.get("test")).rejects.toThrow();
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(mockAuthService.getIdToken).not.toHaveBeenCalledWith(true);
  });

  it("should reject if token refresh fails", async () => {
    const adapter = vi
      .fn()
      .mockImplementation((config: InternalAxiosRequestConfig) =>
        Promise.reject(createAxiosError(401, config))
      );
    client.defaults.adapter = adapter;

    // First call is from the request interceptor (attaching initial token),
    // second call is from the 401 response interceptor (force refresh).
    vi.mocked(mockAuthService.getIdToken)
      .mockResolvedValueOnce("original-token")
      .mockRejectedValueOnce(new Error("Token refresh failed"));

    await expect(client.get("test")).rejects.toThrow();
    // Should not have retried since token refresh failed
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});

describe("traceparent request interceptor", () => {
  const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

  beforeEach(() => {
    resetClient();
    client = getClient();
    configureClientAuth(mockAuthService);
  });

  /** Capture the outgoing request config; resolve 200 so the call settles. */
  function captureAdapter() {
    const seen: InternalAxiosRequestConfig[] = [];
    const adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      seen.push(config);
      return Promise.resolve({ status: 200, statusText: "OK", headers: {}, config, data: {} });
    });
    client.defaults.adapter = adapter;
    return seen;
  }

  const traceparentOf = (config: InternalAxiosRequestConfig | undefined) =>
    (config?.headers as unknown as Record<string, unknown> | undefined)?.traceparent as
      string | undefined;

  it("attaches a well-formed traceparent to internal requests", async () => {
    const seen = captureAdapter();
    await client.get("activities");
    expect(traceparentOf(seen[0])).toMatch(TRACEPARENT);
  });

  it("does not attach traceparent to external (cross-origin) requests", async () => {
    const seen = captureAdapter();
    await client.get("https://evil.example.org/steal");
    expect(traceparentOf(seen[0])).toBeUndefined();
  });

  it("shares one trace-id across requests but uses a fresh span-id each", async () => {
    const seen = captureAdapter();
    await client.get("activities");
    await client.get("activities/1");

    const a = traceparentOf(seen[0])?.split("-");
    const b = traceparentOf(seen[1])?.split("-");
    expect(a?.[1]).toBe(b?.[1]); // same trace-id (no navigation between)
    expect(a?.[2]).not.toBe(b?.[2]); // distinct span-id per request
  });
});

describe("X-Trace-Id response logging (dev-only)", () => {
  beforeEach(() => {
    resetClient();
    client = getClient();
    configureClientAuth(mockAuthService);
    mockLogger.debug.mockClear();
  });

  const TRACE_ID = "1234abcd5678ef901234abcd5678ef90";

  it("logs the backend trace_id from X-Trace-Id on success responses", async () => {
    client.defaults.adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { "x-trace-id": TRACE_ID },
        config,
        data: { ok: true },
      })
    );

    await client.get("activities");

    const matched = mockLogger.debug.mock.calls.some(
      ([msg]) => typeof msg === "string" && msg.includes(`trace_id=${TRACE_ID}`)
    );
    expect(matched).toBe(true);
  });

  it("logs the backend trace_id from X-Trace-Id on error responses", async () => {
    client.defaults.adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      const err = createAxiosError(500, config);
      // createAxiosError defaults to empty headers; attach our trace id.
      if (err.response) err.response.headers = { "x-trace-id": TRACE_ID };
      return Promise.reject(err);
    });

    await expect(client.get("activities")).rejects.toThrow();

    const matched = mockLogger.debug.mock.calls.some(
      ([msg]) => typeof msg === "string" && msg.includes(`trace_id=${TRACE_ID}`)
    );
    expect(matched).toBe(true);
  });

  it("does not log when the header is absent", async () => {
    client.defaults.adapter = vi
      .fn()
      .mockImplementation((config: InternalAxiosRequestConfig) =>
        Promise.resolve({ status: 200, statusText: "OK", headers: {}, config, data: {} })
      );

    await client.get("activities");

    const matched = mockLogger.debug.mock.calls.some(
      ([msg]) => typeof msg === "string" && msg.includes("trace_id=")
    );
    expect(matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAxiosError(status: number, config: InternalAxiosRequestConfig): AxiosError {
  const response: AxiosResponse = {
    status,
    statusText: status === 401 ? "Unauthorized" : "Internal Server Error",
    headers: {},
    config,
    data: null,
  };
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true as const,
    response,
    name: "AxiosError" as const,
    config,
    toJSON: () => ({}),
  }) as AxiosError;
}

describe("auth-init re-arming (request interceptor)", () => {
  beforeEach(() => {
    resetClient();
    client = getClient();
    configureClientAuth(mockAuthService);
    vi.mocked(mockAuthService.waitForAuthReady).mockReset();
    vi.mocked(mockAuthService.getIdToken).mockReset().mockResolvedValue("original-token");
    mockLogger.error.mockClear();
  });

  function captureAdapter() {
    const seen: InternalAxiosRequestConfig[] = [];
    client.defaults.adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      seen.push(config);
      return Promise.resolve({ status: 200, statusText: "OK", headers: {}, config, data: {} });
    });
    return seen;
  }

  const authHeaderOf = (config: InternalAxiosRequestConfig | undefined) =>
    (config?.headers as unknown as Record<string, unknown> | undefined)?.Authorization as
      string | undefined;

  // Regression: authInitPromise used to cache the *result* of the readiness race,
  // not just the in-flight wait. One throw (or one lost race against the 5s timer)
  // left a resolved-false promise in the closure for the lifetime of the tab, so
  // every later request skipped token injection, took a 401, and paid a
  // refresh+retry round trip. The 401 interceptor kept it correct, which is why it
  // stayed invisible. Found independently by two audits a week apart
  // (2026-08-17-web:M1 and 2026-08-24-web:M1).
  it("recovers on a later request after the first auth-init throws", async () => {
    vi.mocked(mockAuthService.waitForAuthReady)
      .mockRejectedValueOnce(new Error("firebase hiccup"))
      .mockResolvedValue(undefined);

    const seen = captureAdapter();

    await client.get("activities");
    expect(authHeaderOf(seen[0])).toBeUndefined(); // first request is the casualty

    await client.get("activities");
    expect(authHeaderOf(seen[1])).toBe("Bearer original-token"); // recovered
  });

  it("caches a successful init and does not re-wait on later requests", async () => {
    vi.mocked(mockAuthService.waitForAuthReady).mockResolvedValue(undefined);
    const seen = captureAdapter();

    await client.get("activities");
    await client.get("activities/1");

    expect(authHeaderOf(seen[0])).toBe("Bearer original-token");
    expect(authHeaderOf(seen[1])).toBe("Bearer original-token");
    // The success path is still coalesced — one wait, not one per request.
    expect(mockAuthService.waitForAuthReady).toHaveBeenCalledTimes(1);
  });

  it("logs the error cause rather than reporting a timeout that did not happen", async () => {
    vi.mocked(mockAuthService.waitForAuthReady).mockRejectedValueOnce(new Error("boom"));
    captureAdapter();

    await client.get("activities");

    const messages = mockLogger.error.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("Auth initialization errored"))).toBe(true);
    expect(messages.some((m) => m.includes("timed out"))).toBe(false);
  });
});
