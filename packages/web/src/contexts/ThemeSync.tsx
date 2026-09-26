import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { useUserConfig } from "../hooks/useUserConfig";
import { UserConfigService } from "../services/userConfigService";
import { readSyncedTheme, type ThemePreference } from "../themes/registry";
import { logApiError } from "../api/errors";
import { useServices } from "./ServiceContext";
import { useTheme } from "./ThemeContext";

/**
 * Carries the theme choice between a signed-in user's devices, through `preferences.theme`
 * in their config. localStorage stays where the theme lives on a device (the first-paint
 * script reads it), and this moves the choice between it and the synced value:
 *
 * - On sign-in, a synced theme is applied here. With none, this device's choice is written.
 * - A change from another device is applied and never written back.
 * - A change made here is written, and the write sets the theme alone.
 * - Signed out (demo mode), nothing is read or written.
 *
 * Renders nothing. Mount it inside `AuthProvider`.
 */
export function ThemeSync() {
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();
  const { data, loading, error } = useUserConfig("preferences");
  const { authService, databaseService } = useServices();
  const service = useMemo(
    () => new UserConfigService(undefined, "v1", { authService, databaseService }),
    [authService, databaseService]
  );

  const signedIn = user !== null;
  const synced = readSyncedTheme(data?.theme);
  // The synced theme as this device last saw it, so a change there can be told from one
  // made here. Undefined until the first read after signing in.
  const seen = useRef<ThemePreference | null | undefined>(undefined);

  useEffect(() => {
    if (!signedIn) {
      seen.current = undefined;
      return;
    }
    // Before the first read lands, or after it fails, "nothing synced" isn't known to be
    // true, and writing on it would overwrite the choice another device made.
    if (loading || error) return;

    const changed = synced !== seen.current;
    seen.current = synced;
    if (synced !== null && changed) {
      if (synced !== preference) setPreference(synced);
      return;
    }
    if (synced === preference) return;
    service
      .updateTheme(preference)
      .catch((err: unknown) => logApiError(err, "[ThemeSync] Failed to save the theme"));
  }, [signedIn, loading, error, synced, preference, setPreference, service]);

  return null;
}
