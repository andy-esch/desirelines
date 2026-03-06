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
      baseURL: `${config.apiGatewayUrl}/v1`,
      timeout: 30_000,
    });

    // Dev-only guard: URLs starting with "/" resolve against the origin root,
    // bypassing the /v1 base path. This silently breaks isInternalRequest()
    // and drops the auth token. Catch this mistake early in development.
    if (!config.isProduction) {
      client.interceptors.request.use((reqConfig) => {
        if (reqConfig.url?.startsWith("/")) {
          throw new Error(
            `[API Client] URL "${reqConfig.url}" starts with "/" which bypasses the /v1 base path. ` +
              `Use a relative URL instead (e.g., "activities" not "/activities").`
          );
        }
        return reqConfig;
      });
    }
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
  let authInitPromise: Promise<boolean> | null = null;

  instance.interceptors.request.use(async (config) => {
    // Wait for initial auth state with timeout (only on first request).
    // Uses a shared promise so concurrent requests coalesce into one wait.
    if (!authInitPromise) {
      authInitPromise = (async () => {
        try {
          const timeoutPromise = new Promise<false>((resolve) => {
            setTimeout(() => resolve(false), AUTH_READY_TIMEOUT_MS);
          });
          const authPromise = authService.waitForAuthReady().then(() => true as const);
          return await Promise.race([authPromise, timeoutPromise]);
        } catch (e) {
          console.error(
            "Auth initialization failed:",
            e instanceof Error ? e.message : "unknown error"
          );
          return false;
        }
      })();
    }

    const ready = await authInitPromise;
    if (!ready) {
      console.error(
        `Auth initialization timed out after ${AUTH_READY_TIMEOUT_MS}ms. ` +
          "Request will proceed without auth token and likely receive 401."
      );
      return config;
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
