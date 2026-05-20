import axios, { type AxiosError } from "axios";
import { getConfig } from "../lib/config";
import { logger } from "../lib/logger";
import type { AuthService } from "../services/auth/AuthService";
import { buildTraceparent } from "./trace";
import { isInternalRequest } from "./url";

/**
 * Centralized API client with automatic authentication.
 *
 * Auth is configured once by AuthProvider via configureClientAuth(),
 * which registers a request interceptor that injects Firebase ID tokens.
 * The auth service is captured in the interceptor closure — no global mutable refs.
 *
 * Module-level state is encapsulated behind getClient/configureClientAuth/resetClient.
 * resetClient() allows test isolation and HMR re-initialization.
 */
let client: ReturnType<typeof axios.create> | null = null;
let configured = false;

/**
 * Case-insensitive read from either a plain header object (axios's default
 * normalized-lowercase form) or an `AxiosHeaders` instance (which exposes
 * `.get()`). Returns `undefined` for missing / non-string values.
 */
function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const h = headers as Record<string, unknown> & { get?: (n: string) => unknown };
  const raw = typeof h.get === "function" ? h.get(name) : (h[name.toLowerCase()] ?? h[name]);
  return typeof raw === "string" ? raw : undefined;
}

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

    // Dev-only style guard: enforce the convention that call-site URLs are
    // written without a leading slash (e.g. "activities", not "/activities").
    // Axios's combineURLs strips leading slashes and would combine both forms
    // identically, and `isInternalRequest` mirrors that — but consistent style
    // makes the code easier to scan and signals REST-ful intent ("activities"
    // is a resource under the configured baseURL).
    if (!config.isProduction) {
      client.interceptors.request.use((reqConfig) => {
        if (reqConfig.url?.startsWith("/")) {
          throw new Error(
            `[API Client] URL "${reqConfig.url}" starts with "/". ` +
              `Use a relative URL instead (e.g., "activities" not "/activities") ` +
              `for consistency with the codebase style.`
          );
        }
        return reqConfig;
      });
    }

    // Surface the backend trace id stamped by otel.TraceIDResponseHeader on
    // every internal API response. Apigateway exposes the header cross-origin
    // via CORS `Access-Control-Expose-Headers`. apierrors already inlines the
    // same value in error response bodies, so this is the success-path / opaque-
    // failure (non-apierrors) backstop. Dev-only logging keeps prod console
    // quiet; the header is still attached and readable by error-reporting code.
    if (!config.isProduction) {
      client.interceptors.response.use(
        (response) => {
          const traceId = headerValue(response.headers, "x-trace-id");
          if (traceId) {
            const method = response.config.method?.toUpperCase() ?? "GET";
            logger.debug(`[API] ${method} ${response.config.url} → trace_id=${traceId}`);
          }
          return response;
        },
        (error: AxiosError) => {
          const traceId = headerValue(error.response?.headers, "x-trace-id");
          if (traceId) {
            const method = error.config?.method?.toUpperCase() ?? "GET";
            logger.debug(`[API error] ${method} ${error.config?.url} → trace_id=${traceId}`);
          }
          return Promise.reject(error);
        }
      );
    }
  }
  return client;
}

/**
 * Reset the API client and auth configuration.
 *
 * Clears the cached axios instance and the configured flag so that
 * configureClientAuth() can be called again. This is essential for:
 * - **Test isolation**: prevents interceptor state from leaking between tests
 * - **HMR**: allows re-configuration when modules are hot-replaced in development
 *
 * @internal — intended for tests and HMR; not for production application code.
 */
export function resetClient(): void {
  client = null;
  configured = false;
}

const AUTH_READY_TIMEOUT_MS = 5000;

/**
 * Configure the API client with an auth service.
 * Registers a request interceptor that waits for auth readiness and injects tokens.
 * Called once by AuthProvider — the auth service is captured in the interceptor closure.
 *
 * Safe to call multiple times — subsequent calls are no-ops unless resetClient()
 * is called first (which clears both the client instance and the configured flag).
 */
export function configureClientAuth(authService: AuthService): void {
  if (configured) return;
  configured = true;

  const instance = getClient();
  let authInitPromise: Promise<boolean> | null = null;

  instance.interceptors.request.use(async (config) => {
    // Only our own API gateway gets auth tokens and trace propagation;
    // absolute URLs to other domains must receive neither.
    const isInternal = isInternalRequest(config.url, config.baseURL);

    // Inject W3C traceparent before the auth wait so correlation survives
    // even an auth-init timeout (which early-returns below). The apigateway
    // is public-endpoint-mode — it links, never parents — so this is a
    // correlation hint, not a trusted parent. See ./trace.ts.
    if (isInternal) {
      config.headers.traceparent = buildTraceparent();
    }

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
          logger.error(
            "Auth initialization failed:",
            e instanceof Error ? e.message : "unknown error"
          );
          return false;
        }
      })();
    }

    const ready = await authInitPromise;
    if (!ready) {
      logger.error(
        `Auth initialization timed out after ${AUTH_READY_TIMEOUT_MS}ms. ` +
          "Request will proceed without auth token and likely receive 401."
      );
      return config;
    }

    const user = authService.getCurrentUser();
    if (user && isInternal) {
      try {
        // getIdToken() auto-refreshes if expired or close to expiry (5 min buffer).
        const token = await authService.getIdToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      } catch (error) {
        logger.error(
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
        logger.error(
          "Token refresh failed during 401 retry:",
          refreshError instanceof Error ? refreshError.message : "unknown error"
        );
      }
    }

    return Promise.reject(error);
  });
}

export default getClient;
