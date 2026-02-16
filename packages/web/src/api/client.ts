import axios from "axios";
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
const config = getConfig();
if (!config.apiGatewayUrl) {
  throw new Error(
    "API Gateway URL is not configured. Set VITE_API_GATEWAY_URL in your environment."
  );
}
const client = axios.create({
  baseURL: config.apiGatewayUrl,
});

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

  let authInitialized = false;

  client.interceptors.request.use(async (config) => {
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
}

export default client;
