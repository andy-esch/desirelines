import { useMemo, useCallback } from "react";
import { useUserConfig } from "./useUserConfig";
import { useAuth } from "./useAuth";
import { usePublicSportConfig } from "./usePublicSportConfig";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import { logger } from "../lib/logger";

/**
 * Default visible sports when user hasn't set preferences.
 * Uses DEFAULT_PREFERENCES as the single source of truth.
 *
 * NOTE: This list is hard-coded sport keys. If any of these get renamed in
 * sport_types.json the defaults would silently point at missing sports — so
 * the hook always filters them against the live sportConfig before returning.
 */
const DEFAULT_VISIBLE_SPORTS = DEFAULT_PREFERENCES.visibleSports;

/**
 * Hook for managing which sports are visible in the UI.
 *
 * Features:
 * - Returns default sports when preference not set
 * - Persists to Firestore for authenticated users
 * - Falls back to localStorage for demo mode
 * - Validates sport keys against known sports (optional)
 *
 * @param knownSports - Optional array of valid sport keys for filtering
 *
 * @example
 * ```tsx
 * const { visibleSports, setVisibleSports, isLoading } = useVisibleSports();
 *
 * // Toggle a sport's visibility
 * const toggleSport = (sport: string) => {
 *   if (visibleSports.includes(sport)) {
 *     setVisibleSports(visibleSports.filter(s => s !== sport));
 *   } else {
 *     setVisibleSports([...visibleSports, sport]);
 *   }
 * };
 * ```
 */
export function useVisibleSports(knownSports?: string[]) {
  const { loading: authLoading } = useAuth();
  const {
    data: prefs,
    loading,
    error,
    updateData,
    isSaving,
    saveError,
    clearSaveError,
  } = useUserConfig("preferences");
  // Used to filter both stored prefs and defaults against the live registry
  // when the caller doesn't pass an explicit `knownSports` list.
  const { sportConfig } = usePublicSportConfig();

  /**
   * Get visible sports from preferences, with defaults and filtering.
   *
   * Logic:
   * 1. If prefs.visibleSports is set and non-empty, use it
   * 2. Otherwise, use DEFAULT_VISIBLE_SPORTS
   * 3. Filter to the caller's `knownSports` (if provided) or sportConfig
   */
  const visibleSports = useMemo(() => {
    // Get raw value from preferences
    const raw = prefs?.visibleSports;

    // Use stored value if it exists and is non-empty, otherwise defaults
    let sports = raw && raw.length > 0 ? raw : DEFAULT_VISIBLE_SPORTS;

    // Use the explicit allow-list if provided, otherwise fall back to the
    // live sport registry so stale defaults or stored prefs don't survive.
    const allow =
      knownSports && knownSports.length > 0
        ? knownSports
        : sportConfig
          ? Object.keys(sportConfig.sportCategories)
          : null;

    if (allow) {
      sports = sports.filter((s) => allow.includes(s));
      // If filtering removed everything, fall back to defaults that exist
      if (sports.length === 0) {
        sports = DEFAULT_VISIBLE_SPORTS.filter((s) => allow.includes(s));
      }
    }

    return sports;
  }, [prefs?.visibleSports, knownSports, sportConfig]);

  /**
   * Update visible sports preference.
   *
   * Validates that at least one sport is selected.
   * If knownSports provided, filters to only valid keys.
   */
  const setVisibleSports = useCallback(
    async (sports: string[]) => {
      // Filter to known sports if provided
      let validSports = sports;
      if (knownSports && knownSports.length > 0) {
        validSports = sports.filter((s) => knownSports.includes(s));
      }

      // Ensure at least one sport is selected.
      // Silent return is acceptable here - the UI (SportVisibilitySettings)
      // prevents this case by disabling the "Hide" button on the last sport.
      // This is a defensive check, not a user-facing validation.
      if (validSports.length === 0) {
        logger.warn("At least one sport must be visible, keeping current selection");
        return;
      }

      // Create prefs object if it doesn't exist yet, using defaults
      await updateData({
        ...DEFAULT_PREFERENCES,
        ...prefs,
        visibleSports: validSports,
      });
    },
    [prefs, updateData, knownSports]
  );

  return {
    /** Currently visible sports (filtered, with defaults applied) */
    visibleSports,
    /** Update the visible sports list */
    setVisibleSports,
    /** True while loading auth or preferences from storage */
    isLoading: authLoading || loading,
    /** Error loading preferences (null if no error) */
    error,
    /** True while saving to storage */
    isSaving,
    /** Error saving preferences (null if no error) */
    saveError,
    /** Clear the save error */
    clearSaveError,
  };
}
