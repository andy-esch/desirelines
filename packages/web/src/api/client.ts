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

client.interceptors.request.use(async (config) => {
  // Ensure auth state is known before proceeding
  // This prevents race conditions where a request fires before we know if the user is logged in
  await authService.waitForAuthReady();

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
