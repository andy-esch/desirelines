import { useCallback } from "react";
import { useAuth } from "./useAuth";

/**
 * Hook for getting Firebase authentication tokens
 *
 * Provides a callback to fetch the current user's ID token from Firebase.
 * Returns undefined if user is not authenticated.
 *
 * @returns Object with getToken callback
 *
 * @example
 * ```tsx
 * const { getToken } = useAuthToken();
 *
 * const idToken = await getToken();
 * if (idToken) {
 *   // Make authenticated API request
 *   await fetchData(idToken);
 * }
 * ```
 */
export function useAuthToken() {
  const { user } = useAuth();

  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!user) return undefined;

    const { getFirebaseAuth } = await import("../lib/firebase");
    const auth = getFirebaseAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) return undefined;

    return await currentUser.getIdToken();
  }, [user]);

  return { getToken };
}
