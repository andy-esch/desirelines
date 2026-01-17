import axios from "axios";
import { getConfig } from "../lib/config";
import { auth, waitForAuthReady } from "../lib/firebase";

/**
 * Centralized API client with automatic authentication.
 *
 * This client:
 * 1. Sets the correct Base URL.
 * 2. Automatically injects the Firebase ID Token if the user is signed in.
 * 3. Handles token refreshing automatically (via currentUser.getIdToken()).
 * 4. Waits for initial auth state to be resolved before making requests.
 */
const config = getConfig();
const client = axios.create({
  baseURL: config.apiGatewayUrl || "http://localhost:8084",
});

client.interceptors.request.use(async (config) => {
  // Ensure auth state is known before proceeding
  // This prevents race conditions where a request fires before we know if the user is logged in
  await waitForAuthReady();

  const user = auth.currentUser;
  if (user) {
    try {
      // Force refresh only if expired? No, standard behavior is auto-refresh if needed.
      const token = await user.getIdToken();
      config.headers.Authorization = `Bearer ${token}`;
    } catch (error) {
      console.error("Failed to get ID token for request:", error);
      // We don't block the request, it will likely fail with 401/403, which the caller should handle
    }
  }

  return config;
});

export default client;
