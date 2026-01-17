import { useState, useEffect, useCallback, useMemo } from "react";
import {
  UserConfigService,
  type UserConfig,
  type GoalsForYear,
  type AnnotationsForYear,
  type Preferences,
} from "../services/userConfigService";
import { useAuth } from "./useAuth";

// Default goals for unauthenticated users (localStorage fallback)
const DEFAULT_GOALS: GoalsForYear = {
  goals: [
    {
      id: "1",
      value: 2000,
      label: "Conservative",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "2",
      value: 2500,
      label: "Target",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "3",
      value: 3000,
      label: "Stretch",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

/**
 * Hook for accessing user config with real-time Firestore sync.
 *
 * Type-safe return based on configType:
 * - "goals" → data is GoalsForYear | null (requires year and sport)
 * - "annotations" → data is AnnotationsForYear | null (requires year)
 * - "preferences" → data is Preferences | null
 */

// Overload for "goals" - year and sport are required
export function useUserConfig(
  configType: "goals",
  year: number,
  sport: string,
  defaultValue?: GoalsForYear,
  userId?: string,
  version?: string
): {
  data: GoalsForYear | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: GoalsForYear) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  clearSaveError: () => void;
};

// Overload for "annotations" - year is required, sport is optional but unused
export function useUserConfig(
  configType: "annotations",
  year: number,
  sport?: string,
  defaultValue?: AnnotationsForYear,
  userId?: string,
  version?: string
): {
  data: AnnotationsForYear | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: AnnotationsForYear) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  clearSaveError: () => void;
};

// Overload for "preferences" - year and sport are optional but unused
export function useUserConfig(
  configType: "preferences",
  year?: number,
  sport?: string,
  defaultValue?: Preferences,
  userId?: string,
  version?: string
): {
  data: Preferences | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: Preferences) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  clearSaveError: () => void;
};

// Implementation - parameters must be compatible with ALL overloads
// This means all parameters except configType must be optional
// Note: Using 'any' in implementation signature is a valid TypeScript pattern for overloaded functions
// The actual types are enforced through the overload signatures above
export function useUserConfig(
  configType: string,
  year?: number,
  sport?: string,
  defaultValue?: GoalsForYear | AnnotationsForYear | Preferences,
  userId?: string,
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // Get authenticated user
  const { user } = useAuth();

  // Resolve userId: explicit > auth user > "default"
  // This matches the logic in UserConfigService constructor
  const effectiveUserId = userId ?? user?.uid ?? "default";
  const effectiveVersion = version ?? "v1";

  // Internal state uses union type, return type uses conditional types
  // This is necessary because TypeScript can't narrow generic types at runtime
  const [data, setData] = useState<GoalsForYear | AnnotationsForYear | Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Mutation state - tracks save operations
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  // Clear save error (for dismiss button in UI)
  const clearSaveError = useCallback(() => {
    setSaveError(null);
  }, []);

  // For unauthenticated users, use localStorage fallback
  // This prevents the loading spinner from showing indefinitely
  const isLocalStorageMode = !user;

  // Local storage mode: Use localStorage for unauthenticated users
  // Authenticated users use Firestore
  useEffect(() => {
    if (isLocalStorageMode) {
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
        setData(defaultValue || DEFAULT_GOALS);
      } else if (configType === "annotations") {
        setData(defaultValue || ({ annotations: [] } as AnnotationsForYear));
      } else if (configType === "preferences") {
        setData(
          defaultValue || ({ theme: "light", defaultYear: new Date().getFullYear() } as Preferences)
        );
      }
      setLoading(false);
      setError(null);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configType, isLocalStorageMode, year, sport, effectiveUserId]);

  // Memoize configService to avoid recreating on every render
  // Only create when we have a valid user (not in localStorage mode)
  // Pass undefined for userId to let UserConfigService use auth.currentUser
  const configService = useMemo(() => {
    if (isLocalStorageMode) {
      // Return a dummy service that won't be used (localStorage mode skips Firestore)
      return null;
    }
    // Don't pass effectiveUserId - let UserConfigService resolve from auth.currentUser
    // This avoids race conditions between React state and Firebase auth state
    return new UserConfigService(userId, effectiveVersion);
  }, [userId, effectiveVersion, isLocalStorageMode]);

  // Load config and subscribe to real-time updates
  useEffect(() => {
    // Skip Firestore if using localStorage mode or configService not ready
    if (isLocalStorageMode || !configService) {
      return;
    }

    let unsubscribe: (() => void) | undefined;

    async function initializeConfig() {
      // Double-check configService is still valid (could have changed during async ops)
      if (!configService) return;

      try {
        setLoading(true);
        setError(null);

        // CRITICAL: Wait for Firebase Auth initial state to be determined
        // This prevents "Missing or insufficient permissions" errors when
        // the subscription is set up before auth state is loaded from storage
        const { waitForAuthReady } = await import("../lib/firebase");
        await waitForAuthReady();

        // ADDITIONAL: If user just signed in, wait for auth token to be ready
        // This prevents race condition when user signs in
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
          unsubscribe = configService!.subscribeToConfigSection(
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
          unsubscribe = configService!.subscribeToConfigSection(
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
          unsubscribe = configService!.subscribeToConfigSection("preferences", (section) => {
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
  }, [configType, year, sport, configService, isLocalStorageMode]);

  /**
   * Update the config data
   * Uses optimistic UI update (updates local state immediately)
   * then syncs to Firestore in the background.
   * Tracks isSaving/saveError state for UI feedback.
   */
  const updateData = useCallback(
    async (newData: GoalsForYear | AnnotationsForYear | Preferences) => {
      // Clear any previous save error when starting a new save
      setSaveError(null);
      setIsSaving(true);

      try {
        // In demo mode, persist to localStorage
        if (isLocalStorageMode) {
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
            setSaveError(err as Error);
          }
          return;
        }

        // Optimistic update for Firestore mode
        setData(newData);

        // configService should exist when not in localStorage mode
        if (!configService) {
          console.error("configService is null but not in localStorage mode");
          return;
        }

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
        // Clear read error on successful save (in case there was one)
        setError(null);
      } catch (err) {
        console.error("Error updating config:", err);
        setSaveError(err as Error);
        // Real-time listener will revert to correct state from Firestore
      } finally {
        setIsSaving(false);
      }
    },
    [configType, year, sport, configService, effectiveUserId, isLocalStorageMode]
  );

  return {
    data,
    loading,
    error,
    updateData,
    isSaving,
    saveError,
    clearSaveError,
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

  // Determine if we're in localStorage mode based on auth state
  const isLocalStorageMode = !user;

  // Memoize configService to avoid recreating on every render
  // Only create when we have a valid user (not in localStorage mode)
  const configService = useMemo(() => {
    if (isLocalStorageMode) {
      return null;
    }
    // Don't pass userId explicitly - let UserConfigService resolve from auth.currentUser
    // This avoids race conditions between React state and Firebase auth state
    return new UserConfigService(userId, version);
  }, [userId, version, isLocalStorageMode]);

  useEffect(() => {
    // Skip Firestore if using localStorage mode or configService not ready
    if (isLocalStorageMode || !configService) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    async function initializeConfig() {
      // Double-check configService is still valid
      if (!configService) return;

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
  }, [configService, isLocalStorageMode]);

  const updateSection = useCallback(
    async (
      configType: "goals" | "annotations" | "preferences",
      data: GoalsForYear | AnnotationsForYear | Preferences,
      year?: number,
      sport?: string
    ): Promise<void> => {
      // In demo mode (unauthenticated), skip persistence
      if (isLocalStorageMode) {
        console.warn("Fixture mode: Changes not persisted", data);
        return;
      }

      // configService should exist when not in localStorage mode
      if (!configService) {
        console.error("configService is null but not in localStorage mode");
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
    [configService, isLocalStorageMode]
  );

  return {
    config,
    loading,
    error,
    updateSection,
  };
}
