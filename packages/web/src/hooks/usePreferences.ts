import { useCallback, useMemo } from "react";
import type { Preferences } from "../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import { getUserSettings, type UserSettings } from "../utils/units";
import { useConfigSection } from "./useConfigSection";
import { useConfigDocument } from "./useConfigDocument";

const PREFERENCES = { section: "preferences" } as const;

/**
 * The session's preferences: the account's, or the demo's on this device.
 *
 * `preferences` is always set: the defaults stand in where nothing is saved (`isSaved`
 * says which). `save` writes every preference but the theme, which has its own writer,
 * `saveTheme`, for accounts: signed out, the theme stays on the device with `ThemeContext`.
 */
export function usePreferences() {
  const { value, save, ...section } = useConfigSection<Preferences>(PREFERENCES);
  const { adapter } = useConfigDocument();

  const saveTheme = useCallback(
    (theme: string): Promise<void> =>
      adapter?.saveTheme
        ? adapter.saveTheme(theme)
        : Promise.reject(new Error("Only an account's theme is saved; signed out it stays here.")),
    [adapter]
  );

  return { ...section, preferences: value ?? DEFAULT_PREFERENCES, save, saveTheme };
}

/** The units the session's preferences choose (defaults where unset). */
export function useUnitSettings(): UserSettings {
  const { preferences } = usePreferences();
  return useMemo(() => getUserSettings(preferences), [preferences]);
}

/** The session's chosen timezone, or undefined for the browser's own. */
export function useTimezone(): string | undefined {
  return usePreferences().preferences.timezone || undefined;
}
