import { useEffect, useRef, useState } from "react";
import { useAuthService } from "../contexts/ServiceContext";
import { useAuth } from "./useAuth";
import { logger } from "../lib/logger";

/** Refresh the cached token a little before Firebase's 60-minute expiry. */
const TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000;

export interface AuthTokenState {
  /** Reads the latest Firebase ID token synchronously (for Mapbox transformRequest). */
  getToken: () => string | undefined;
  /**
   * Latest token as render state — drives gating/re-render when it first
   * resolves. Consumers should mount the map only once this is defined so the
   * very first tile request carries a valid token.
   */
  token: string | undefined;
  /** True once the first token fetch has settled (resolved or failed). */
  ready: boolean;
  /** Force a token refresh (e.g. after a 401 tile error). */
  refresh: () => Promise<void>;
}

/**
 * Hold the current Firebase ID token both in a ref (read synchronously by
 * Mapbox GL's `transformRequest`, which can't `await`) and as render state (so
 * the page can gate the map mount until a token exists).
 *
 * The fetch waits for auth readiness and re-runs whenever the signed-in user
 * changes, so a token is in hand before the map's first tile request — without
 * this, the map could mount while `auth.currentUser` is still null and every
 * tile would 401. The interval is a long-session backstop; `getIdToken()` also
 * auto-refreshes within 5 min of expiry.
 */
export function useAuthTokenRef(): AuthTokenState {
  const authService = useAuthService();
  const { user } = useAuth();
  const tokenRef = useRef<string | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  // Stable `refresh` identity that always calls the latest closure.
  const refreshRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true;

    const refresh = async (force = false) => {
      try {
        // Don't fetch before auth has settled — otherwise the first call can
        // resolve `undefined` for a user who is about to sign in.
        await authService.waitForAuthReady();
        const next = await authService.getIdToken(force);
        if (active) {
          tokenRef.current = next;
          setToken(next);
        }
      } catch (err) {
        // Leave the previous token in place; a 401 retry can force a refresh.
        // Log it (raw, to preserve the stack) — a silently-swallowed token
        // failure here previously hung the map on "Loading…" with nothing in
        // the console.
        logger.error("Failed to fetch Firebase ID token for the map:", err);
      } finally {
        if (active) setReady(true);
      }
    };
    refreshRef.current = refresh;

    void refresh();
    const id = setInterval(() => void refresh(), TOKEN_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
    // Re-fetch when the signed-in user changes (e.g. appears after mount).
  }, [authService, user?.uid]);

  return {
    getToken: () => tokenRef.current,
    token,
    ready,
    refresh: () => refreshRef.current(true),
  };
}
