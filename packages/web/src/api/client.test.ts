import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { AuthService } from "../services/auth/AuthService";

// Mock dependencies before importing the module under test
vi.mock("../lib/config", () => ({
  getConfig: () => ({ apiGatewayUrl: "https://api.example.com" }),
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
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn().mockReturnValue(() => {}),
  getIdToken: vi.fn().mockResolvedValue("original-token"),
  waitForAuthReady: vi.fn().mockResolvedValue(undefined),
};

// Import after mocks are set up
import client, { configureClientAuth } from "./client";

// Register interceptors once — mirrors how the app calls this at startup.
configureClientAuth(mockAuthService);

describe("401 response interceptor", () => {
  const originalAdapter = client.defaults.adapter;

  beforeEach(() => {
    vi.mocked(mockAuthService.getIdToken).mockReset().mockResolvedValue("original-token");
  });

  afterEach(() => {
    client.defaults.adapter = originalAdapter;
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

    const response = await client.get("/test");

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

    await expect(client.get("/test")).rejects.toThrow();
    // Original request + 1 retry = 2 calls, not infinite
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-401 errors", async () => {
    const adapter = vi.fn().mockImplementation((config: InternalAxiosRequestConfig) => {
      return Promise.reject(createAxiosError(500, config));
    });
    client.defaults.adapter = adapter;

    await expect(client.get("/test")).rejects.toThrow();
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

    await expect(client.get("/test")).rejects.toThrow();
    // Should not have retried since token refresh failed
    expect(adapter).toHaveBeenCalledTimes(1);
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
    code: undefined,
    toJSON: () => ({}),
  }) as AxiosError;
}
