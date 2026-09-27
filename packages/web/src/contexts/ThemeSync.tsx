import { useEffect, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import {
  DEFAULT_THEME_PREFERENCE,
  readSyncedTheme,
  type ThemePreference,
} from "../themes/registry";
import { logApiError } from "../api/errors";
import { useTheme } from "./ThemeContext";

/**
 * Keeps the demo's theme and the signed-in account's apart, and carries the account's
 * between devices through `preferences.theme` in its config:
 *
 * - Signed out, the demo's own theme shows, and nothing is read or written.
 * - On sign-in, the account's synced theme shows, or the default for an account with none.
 *   Nothing from this device or the demo is written to the account.
 * - Signed in, a change made here is written (the theme alone), and a change from another
 *   device is applied and never written back.
 * - On sign-out, the demo's theme shows again, and the account's cached copy is cleared.
 *
 * The switching itself is `ThemeContext`'s scope. Reads and writes through the config store
 * (`usePreferences`), so renders nothing; mount it inside `UserConfigProvider`.
 */
export function ThemeSync() {
  const { user, loading: authLoading } = useAuth();
  const { preference, setPreference, scope, setScope } = useTheme();
  const { preferences, loading, error, saveTheme } = usePreferences();

  const signedIn = user !== null;
  const synced = readSyncedTheme(preferences.theme);
  // The synced theme as last seen, undefined until the first read after signing in, so a
  // change on another device can be told from one made here.
  const seen = useRef<ThemePreference | null | undefined>(undefined);
  // The default shown for an account with no theme. It isn't a choice, so it isn't written.
  const defaultShown = useRef<ThemePreference | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!signedIn) {
      seen.current = undefined;
      if (scope !== "demo") setScope("demo");
      return;
    }
    if (loading) return;
    // With the first read failed, the account's theme isn't known: show its cached copy,
    // and write nothing, which could overwrite the choice another device made.
    if (error) {
      if (scope !== "account") setScope("account");
      return;
    }

    const first = seen.current === undefined;
    const changed = synced !== seen.current;
    seen.current = synced;
    if (first || scope !== "account") {
      defaultShown.current = synced === null ? DEFAULT_THEME_PREFERENCE : null;
      setScope("account", synced ?? DEFAULT_THEME_PREFERENCE);
      return;
    }
    if (changed && synced !== null) {
      defaultShown.current = null;
      if (synced !== preference) setPreference(synced);
      return;
    }
    // A change made here, or the account's theme left unset by an older client's save (a
    // default it spread, not a choice): write the one showing.
    if (preference === synced || preference === defaultShown.current) return;
    saveTheme(preference).catch((err: unknown) =>
      logApiError(err, "[ThemeSync] Failed to save the theme")
    );
  }, [
    authLoading,
    signedIn,
    loading,
    error,
    synced,
    preference,
    setPreference,
    scope,
    setScope,
    saveTheme,
  ]);

  return null;
}
