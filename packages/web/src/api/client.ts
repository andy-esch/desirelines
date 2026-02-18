import axios, { type AxiosError } from "axios";
import { getConfig } from "../lib/config";
import type { AuthService } from "../services/auth/AuthService";
import { isInternalRequest } from "./url";

/**
 * Centralized API client with automatic authentication.
 *
 * Auth is configured once by AuthProvider via configureClientAuth(),
 * which registers a request interceptor that injects Firebase ID tokens.
 * The auth service is captured in the interceptor closure — no global mutable refs.
 */
let client: ReturnType<typeof axios.create> | null = null;

function getClient() {
  if (!client) {
    const config = getConfig();
    if (!config.apiGatewayUrl) {
      throw new Error(
        "API Gateway URL is not configured. Set VITE_API_GATEWAY_URL in your environment."
      );
    }
    client = axios.create({
      baseURL: config.apiGatewayUrl,
    });
  }
  return client;
}

const AUTH_READY_TIMEOUT_MS = 5000;

/**
 * Configure the API client with an auth service.
 * Registers a request interceptor that waits for auth readiness and injects tokens.
 * Called once by AuthProvider — the auth service is captured in the interceptor closure.
 */
let configured = false;

export function configureClientAuth(authService: AuthService): void {
  if (configured) return;
  configured = true;

  const instance = getClient();
  let authInitialized = false;

  instance.interceptors.request.use(async (config) => {
    // Wait for initial auth state with timeout (only on first request)
    if (!authInitialized) {
      const timeoutPromise = new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), AUTH_READY_TIMEOUT_MS);
      });
      const authPromise = authService.waitForAuthReady().then(() => true as const);
      const ready = await Promise.race([authPromise, timeoutPromise]);

      if (!ready) {
        console.error(
          `Auth initialization timed out after ${AUTH_READY_TIMEOUT_MS}ms. ` +
            "Request will proceed without auth token and likely receive 401."
        );
        return config;
      }
      authInitialized = true;
    }

    const user = authService.getCurrentUser();
    // Only attach token for requests to our own API gateway.
    // Absolute URLs to other domains must not receive the auth token.
    const isInternal = isInternalRequest(config.url, config.baseURL);

    if (user && isInternal) {
      try {
        // getIdToken() auto-refreshes if expired or close to expiry (5 min buffer).
        const token = await authService.getIdToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      } catch (error) {
        console.error(
          "Failed to get ID token for request:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    return config;
  });

  /**
   * Response interceptor — automatic 401 recovery.
   *
   * When an internal API request receives a 401 Unauthorized response, this
   * interceptor force-refreshes the Firebase ID token and retries the request
   * exactly once. A `_retried` flag on the request config prevents infinite
   * retry loops. External (non-internal) requests are never retried.
   *
   * A shared `refreshPromise` ensures that concurrent 401s coalesce into a
   * single token refresh rather than firing N independent refreshes.
   */
  let refreshPromise: Promise<string | undefined> | null = null;

  instance.interceptors.response.use(undefined, async (error: AxiosError) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retried &&
      isInternalRequest(originalRequest.url, originalRequest.baseURL)
    ) {
      originalRequest._retried = true;

      try {
        // Coalesce concurrent refreshes — if one is already in flight, reuse it.
        if (!refreshPromise) {
          refreshPromise = authService.getIdToken(true).finally(() => {
            refreshPromise = null;
          });
        }
        const token = await refreshPromise;
        if (token) {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return instance(originalRequest);
        }
      } catch (refreshError) {
        console.error(
          "Token refresh failed during 401 retry:",
          refreshError instanceof Error ? refreshError.message : "unknown error"
        );
      }
    }

    return Promise.reject(error);
  });
}

export default getClient;
