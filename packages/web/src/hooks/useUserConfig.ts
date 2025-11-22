import { useState, useEffect, useCallback, useMemo } from "react";
import {
  UserConfigService,
  type UserConfig,
  type GoalsForYear,
  type AnnotationsForYear,
  type Preferences,
} from "../services/userConfigService";
import { USE_FIXTURE_DATA } from "../config";
import { FIXTURE_GOALS } from "../data/fixtures";
import { useAuth } from "./useAuth";

/**
 * Hook for accessing user config with real-time Firestore sync.
 *
 * Type-safe return based on configType:
 * - "goals" → data is GoalsForYear | null (requires year and sport)
 * - "annotations" → data is AnnotationsForYear | null (requires year)
 * - "preferences" → data is Preferences | null
 *
 * @param configType - Type of config section ("goals", "annotations", or "preferences")
 * @param year - Required for goals/annotations, not used for preferences
 * @param sport - Required for goals, not used for annotations/preferences
 * @param defaultValue - Default value if config doesn't exist
 * @param userId - Optional userId override. If not provided, uses authenticated user's UID
 *   (or "default" for unauthenticated users). Providing an explicit userId when authenticated
 *   will throw an error unless it matches the authenticated user's UID.
 * @param version - Config version (defaults to "v1")
 */
export function useUserConfig<T extends "goals" | "annotations" | "preferences" = "goals">(
  configType: T,
  year?: number,
  sport?: string,
  defaultValue?: GoalsForYear | AnnotationsForYear | Preferences,
  userId?: string,
  version: string = "v1"
): {
  data:
    | (T extends "goals"
        ? GoalsForYear
        : T extends "annotations"
          ? AnnotationsForYear
          : Preferences)
    | null;
  loading: boolean;
  error: Error | null;
  updateData: (
    data: T extends "goals"
      ? GoalsForYear
      : T extends "annotations"
        ? AnnotationsForYear
        : Preferences
  ) => Promise<void>;
} {
  // Get authenticated user
  const { user } = useAuth();

  // Resolve userId: explicit > auth user > "default"
  // This matches the logic in UserConfigService constructor
  const effectiveUserId = userId ?? user?.uid ?? "default";
  const effectiveVersion = version || "v1";

  const [data, setData] = useState<GoalsForYear | AnnotationsForYear | Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // For demo/fixture mode, immediately set loading to false if not authenticated
  // This prevents the loading spinner from showing indefinitely
  // NOTE: isFixtureMode is based ONLY on auth state, not build-time config
  // This allows authenticated users to use Firestore even when VITE_USE_FIXTURES=true
  const isFixtureMode = !user;

  // Fixture mode: Use fixtures/localStorage for unauthenticated users only
  // Authenticated users ALWAYS use Firestore, regardless of VITE_USE_FIXTURES setting
  useEffect(() => {
    if (isFixtureMode) {
      // Build localStorage key - include sport for goals
      let storageKey: string;
      if (configType === "goals" && year !== undefined && sport !== undefined) {
        storageKey = `userConfig_${effectiveUserId}_${configType}_${year}_${sport}`;
      } else if (year !== undefined) {
        storageKey = `userConfig_${effectiveUserId}_${configType}_${year}`;
      } else {
        storageKey = `userConfig_${effectiveUserId}_${configType}`;
      }

      // Try to load from localStorage first
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          setData(JSON.parse(stored));
          setLoading(false);
          setError(null);
          return;
        } catch (err) {
          console.warn("Failed to parse stored config, using defaults:", err);
        }
      }

      // Fall back to defaults
      if (configType === "goals") {
        setData(defaultValue || FIXTURE_GOALS);
      } else if (configType === "annotations") {
        setData(defaultValue || ({ annotations: [] } as AnnotationsForYear));
      } else if (configType === "preferences") {
        setData(defaultValue || ({ theme: "light", defaultYear: 2025 } as Preferences));
      }
      setLoading(false);
      setError(null);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configType, isFixtureMode, year, sport, effectiveUserId]);

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(
    () => new UserConfigService(effectiveUserId, effectiveVersion),
    [effectiveUserId, effectiveVersion]
  );

  // Load config and subscribe to real-time updates
  useEffect(() => {
    // Skip Firestore if using fixtures or not authenticated
    if (isFixtureMode) {
      return;
    }

    let unsubscribe: (() => void) | undefined;

    async function initializeConfig() {
      try {
        setLoading(true);
        setError(null);

        // CRITICAL: Wait for Firebase Auth initial state to be determined
        // This prevents "Missing or insufficient permissions" errors when
        // the subscription is set up before auth state is loaded from storage
        const { waitForAuthReady } = await import("../lib/firebase");
        await waitForAuthReady();

        // ADDITIONAL: If user just signed in, wait for auth token to be ready
        // This prevents race condition when isFixtureMode changes from true->false
        if (user) {
          const { auth } = await import("../lib/firebase");
          const firebaseUser = auth.currentUser;
          if (firebaseUser) {
            try {
              await firebaseUser.getIdToken();
            } catch (err) {
              console.error("Failed to get auth token:", err);
              throw err;
            }
          }
        }

        // Subscribe to real-time updates for this specific section
        if (configType === "goals" && year !== undefined && sport !== undefined) {
          unsubscribe = configService.subscribeToConfigSection(
            "goals",
            (section) => {
              if (section !== null) {
                // When year and sport are provided, section is GoalsForYear
                setData(section as GoalsForYear);
              } else if (defaultValue !== undefined) {
                setData(defaultValue);
              } else {
                setData(null);
              }
              setLoading(false);
            },
            year,
            sport
          );
        } else if (configType === "annotations" && year !== undefined) {
          unsubscribe = configService.subscribeToConfigSection(
            "annotations",
            (section) => {
              if (section !== null) {
                // When year is provided, section is AnnotationsForYear (not dictionary)
                setData(section as AnnotationsForYear);
              } else if (defaultValue !== undefined) {
                setData(defaultValue);
              } else {
                setData(null);
              }
              setLoading(false);
            },
            year
          );
        } else if (configType === "preferences") {
          unsubscribe = configService.subscribeToConfigSection("preferences", (section) => {
            if (section !== null) {
              setData(section as Preferences);
            } else if (defaultValue !== undefined) {
              setData(defaultValue);
            } else {
              setData(null);
            }
            setLoading(false);
          });
        }
      } catch (err) {
        console.error("Error initializing config:", err);
        setError(err as Error);
        setData(defaultValue || null);
        setLoading(false);
      }
    }

    initializeConfig();

    // Cleanup subscription on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
    // Intentionally omitting defaultValue to avoid re-subscriptions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configType, year, sport, configService, isFixtureMode]);

  /**
   * Update the config data
   * Uses optimistic UI update (updates local state immediately)
   * then syncs to Firestore in the background
   */
  const updateData = useCallback(
    async (newData: GoalsForYear | AnnotationsForYear | Preferences) => {
      // In fixture mode, persist to localStorage
      if (isFixtureMode) {
        // Build localStorage key - include sport for goals
        let storageKey: string;
        if (configType === "goals" && year !== undefined && sport !== undefined) {
          storageKey = `userConfig_${effectiveUserId}_${configType}_${year}_${sport}`;
        } else if (year !== undefined) {
          storageKey = `userConfig_${effectiveUserId}_${configType}_${year}`;
        } else {
          storageKey = `userConfig_${effectiveUserId}_${configType}`;
        }

        try {
          localStorage.setItem(storageKey, JSON.stringify(newData));
          setData(newData);
        } catch (err) {
          console.error("Failed to save to localStorage:", err);
          setError(err as Error);
        }
        return;
      }

      // Optimistic update for Firestore mode
      setData(newData);

      try {
        if (configType === "goals" && year !== undefined && sport !== undefined) {
          await configService.updateConfigSection("goals", newData as GoalsForYear, year, sport);
        } else if (configType === "annotations" && year !== undefined) {
          await configService.updateConfigSection(
            "annotations",
            newData as AnnotationsForYear,
            year
          );
        } else if (configType === "preferences") {
          await configService.updateConfigSection("preferences", newData as Preferences);
        }
        setError(null);
      } catch (err) {
        console.error("Error updating config:", err);
        setError(err as Error);
        // Real-time listener will revert to correct state from Firestore
      }
    },
    [configType, year, sport, configService, effectiveUserId, isFixtureMode]
  );

  // Type assertion needed because internal state uses union type
  // but return type uses conditional types for better type safety
  return {
    data,
    loading,
    error,
    updateData,
  } as {
    data:
      | (T extends "goals"
          ? GoalsForYear
          : T extends "annotations"
            ? AnnotationsForYear
            : Preferences)
      | null;
    loading: boolean;
    error: Error | null;
    updateData: (
      data: T extends "goals"
        ? GoalsForYear
        : T extends "annotations"
          ? AnnotationsForYear
          : Preferences
    ) => Promise<void>;
  };
}

/**
 * Hook for accessing the full user configuration
 * Use this when you need access to multiple config sections
 *
 * @param userId - Optional userId override. If not provided, uses authenticated user's UID
 *   (or "default" for unauthenticated users). Providing an explicit userId when authenticated
 *   will throw an error unless it matches the authenticated user's UID.
 * @param version - Config version (defaults to "v1")
 *
 * @example
 * ```tsx
 * const { config, loading, error, updateSection } = useFullUserConfig();
 *
 * // Access multiple sections
 * const goals2025 = config?.goals?.['2025'];
 * const preferences = config?.preferences;
 *
 * // Update a specific section
 * await updateSection('goals', newGoals, 2025);
 * ```
 */
export function useFullUserConfig(userId?: string, version: string = "v1") {
  const { user } = useAuth();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Determine if we're in fixture mode based on auth state
  const isFixtureMode = !user;

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(() => new UserConfigService(userId, version), [userId, version]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function initializeConfig() {
      try {
        setLoading(true);
        setError(null);

        // Subscribe to real-time updates for the full config
        unsubscribe = configService.subscribeToConfig((fullConfig) => {
          setConfig(fullConfig);
          setLoading(false);
        });
      } catch (err) {
        console.error("Error initializing full config:", err);
        setError(err as Error);
        setConfig(null);
        setLoading(false);
      }
    }

    initializeConfig();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [configService]);

  const updateSection = useCallback(
    async (
      configType: "goals" | "annotations" | "preferences",
      data: GoalsForYear | AnnotationsForYear | Preferences,
      year?: number,
      sport?: string
    ): Promise<void> => {
      // In fixture mode (unauthenticated), skip persistence
      if (isFixtureMode) {
        console.warn("Fixture mode: Changes not persisted", data);
        return;
      }

      try {
        if (configType === "goals" && year !== undefined && sport !== undefined) {
          await configService.updateConfigSection("goals", data as GoalsForYear, year, sport);
        } else if (configType === "annotations" && year !== undefined) {
          await configService.updateConfigSection("annotations", data as AnnotationsForYear, year);
        } else if (configType === "preferences") {
          await configService.updateConfigSection("preferences", data as Preferences);
        }
        setError(null);
      } catch (err) {
        console.error("Error updating config section:", err);
        setError(err as Error);
      }
    },
    [configService, isFixtureMode]
  );

  return {
    config,
    loading,
    error,
    updateSection,
  };
}
