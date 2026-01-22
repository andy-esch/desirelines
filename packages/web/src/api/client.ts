import axios from "axios";
import { getConfig } from "../lib/config";
import { getFirebaseAuthService } from "../services/auth/FirebaseAuthService";

/**
 * Centralized API client with automatic authentication.
 *
 * This client:
 * 1. Sets the correct Base URL.
 * 2. Automatically injects the Firebase ID Token if the user is signed in.
 * 3. Handles token refreshing automatically (via getIdToken()).
 * 4. Waits for initial auth state to be resolved before making requests.
 */
const config = getConfig();
const client = axios.create({
  baseURL: config.apiGatewayUrl || "http://localhost:8084",
});

// Get auth service singleton
const authService = getFirebaseAuthService();

// Timeout for waiting on auth initialization (5 seconds)
const AUTH_READY_TIMEOUT_MS = 5000;

// Cache flag to skip auth wait after first successful initialization
let authInitialized = false;

/**
 * Wait for auth to be ready with a timeout to prevent hanging requests.
 * After first successful initialization, returns immediately.
 */
async function waitForAuthWithTimeout(): Promise<boolean> {
  // Skip waiting if we've already initialized successfully
  if (authInitialized) {
    return true;
  }

  const timeoutPromise = new Promise<false>((resolve) => {
    setTimeout(() => resolve(false), AUTH_READY_TIMEOUT_MS);
  });

  const authPromise = authService.waitForAuthReady().then(() => true as const);

  const result = await Promise.race([authPromise, timeoutPromise]);

  // Cache successful initialization
  if (result) {
    authInitialized = true;
  }

  return result;
}

client.interceptors.request.use(async (config) => {
  // Ensure auth state is known before proceeding (with timeout)
  // This prevents race conditions where a request fires before we know if the user is logged in
  const authReady = await waitForAuthWithTimeout();

  if (!authReady) {
    console.warn(
      "Auth initialization timed out after",
      AUTH_READY_TIMEOUT_MS,
      "ms. Proceeding without auth token."
    );
    return config;
  }

  const user = authService.getCurrentUser();
  if (user) {
    try {
      // getIdToken() auto-refreshes the token if it is expired or close to expiry (5 min buffer).
      // We avoid forceRefresh: true here to prevent unnecessary network calls to Firebase Auth on every request.
      const token = await authService.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error("Failed to get ID token for request:", error);
      // We don't block the request, it will likely fail with 401/403, which the caller should handle
    }
  }

  return config;
});

export default client;
