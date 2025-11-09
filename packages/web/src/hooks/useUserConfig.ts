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
 * - "goals" → data is GoalsForYear | null
 * - "annotations" → data is AnnotationsForYear | null
 * - "preferences" → data is Preferences | null
 *
 * @param configType - Type of config section ("goals", "annotations", or "preferences")
 * @param year - Required for goals/annotations, not used for preferences
 * @param defaultValue - Default value if config doesn't exist
 * @param userId - Firestore userId (defaults to authenticated user)
 * @param version - Config version (defaults to "v1")
 */
export function useUserConfig<T extends "goals" | "annotations" | "preferences">(
  configType: T,
  year?: number,
  defaultValue?: T extends "goals"
    ? GoalsForYear
    : T extends "annotations"
      ? AnnotationsForYear
      : Preferences,
  userId: string = "default",
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

  // Use provided userId or default to authenticated user
  const effectiveUserId = userId || user?.uid || "default";
  const effectiveVersion = version || "v1";

  const [data, setData] = useState<GoalsForYear | AnnotationsForYear | Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Smart mode: Use fixtures if:
  // 1. Environment is configured for fixture-only mode (USE_FIXTURE_DATA=true), OR
  // 2. User is not authenticated (anonymous users see demo)
  useEffect(() => {
    if (USE_FIXTURE_DATA || !user) {
      if (configType === "goals") {
        setData(FIXTURE_GOALS);
      } else if (configType === "annotations") {
        setData({ annotations: [] } as AnnotationsForYear);
      } else if (configType === "preferences") {
        setData({ theme: "light", defaultYear: 2025 } as Preferences);
      }
      setLoading(false);
      setError(null);
      return;
    }
  }, [configType, user]);

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(
    () => new UserConfigService(effectiveUserId, effectiveVersion),
    [effectiveUserId, effectiveVersion]
  );

  // Load config and subscribe to real-time updates
  useEffect(() => {
    // Skip Firestore if using fixtures or not authenticated
    if (USE_FIXTURE_DATA || !user) {
      return;
    }

    let unsubscribe: (() => void) | undefined;

    async function initializeConfig() {
      try {
        setLoading(true);
        setError(null);

        // Subscribe to real-time updates for this specific section
        if (configType === "goals" && year !== undefined) {
          unsubscribe = configService.subscribeToConfigSection(
            "goals",
            (section) => {
              if (section !== null) {
                // When year is provided, section is GoalsForYear (not dictionary)
                setData(section as GoalsForYear);
              } else if (defaultValue !== undefined) {
                setData(defaultValue);
              } else {
                setData(null);
              }
              setLoading(false);
            },
            year
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
  }, [configType, year, configService, user]);

  /**
   * Update the config data
   * Uses optimistic UI update (updates local state immediately)
   * then syncs to Firestore in the background
   */
  const updateData = useCallback(
    async (newData: GoalsForYear | AnnotationsForYear | Preferences) => {
      // In fixture mode, just update local state (no persistence)
      if (USE_FIXTURE_DATA) {
        console.warn("Fixture mode: Changes not persisted", newData);
        setData(newData);
        return;
      }

      // Optimistic update
      setData(newData);

      try {
        if (configType === "goals" && year !== undefined) {
          await configService.updateConfigSection("goals", newData as GoalsForYear, year);
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
    [configType, year, configService]
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
export function useFullUserConfig(userId: string = "default", version: string = "v1") {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
      year?: number
    ): Promise<void> => {
      // In fixture mode, skip persistence
      if (USE_FIXTURE_DATA) {
        console.warn("Fixture mode: Changes not persisted", data);
        return;
      }

      try {
        if (configType === "goals" && year !== undefined) {
          await configService.updateConfigSection("goals", data as GoalsForYear, year);
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
    [configService]
  );

  return {
    config,
    loading,
    error,
    updateSection,
  };
}
