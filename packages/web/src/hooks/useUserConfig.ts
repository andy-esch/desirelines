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
 * Hook for accessing goals for a specific year with real-time sync
 */
export function useUserConfig(
  configType: "goals",
  year: number,
  defaultValue?: GoalsForYear,
  userId?: string,
  version?: string
): {
  data: GoalsForYear | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: GoalsForYear) => Promise<void>;
};

/**
 * Hook for accessing annotations for a specific year with real-time sync
 */
export function useUserConfig(
  configType: "annotations",
  year: number,
  defaultValue?: AnnotationsForYear,
  userId?: string,
  version?: string
): {
  data: AnnotationsForYear | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: AnnotationsForYear) => Promise<void>;
};

/**
 * Hook for accessing preferences with real-time sync
 * Note: year parameter is not used for preferences, but kept for signature compatibility
 */
export function useUserConfig(
  configType: "preferences",
  year?: undefined,
  defaultValue?: Preferences,
  userId?: string,
  version?: string
): {
  data: Preferences | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: Preferences) => Promise<void>;
};

/**
 * Implementation
 */
export function useUserConfig(
  configType: any,
  yearOrDefault?: any,
  defaultValueOrUserId?: any,
  userIdOrVersion?: any,
  versionParam?: any
): any {
  // Get authenticated user
  const { user } = useAuth();

  // Parse overloaded parameters
  let year: number | undefined;
  let defaultValue: GoalsForYear | AnnotationsForYear | Preferences | undefined;
  let userId: string = user?.uid || "default";  // Use authenticated user's ID
  let version: string = "v1";

  if (configType === "preferences") {
    // preferences(configType, defaultValue?, userId?, version?)
    defaultValue = yearOrDefault as Preferences | undefined;
    // Allow override, but default to authenticated user
    userId = (defaultValueOrUserId as string) || user?.uid || "default";
    version = (userIdOrVersion as string) || "v1";
  } else {
    // goals/annotations(configType, year, defaultValue?, userId?, version?)
    year = yearOrDefault as number;
    defaultValue = defaultValueOrUserId as GoalsForYear | AnnotationsForYear | undefined;
    // Allow override, but default to authenticated user
    userId = (userIdOrVersion as string) || user?.uid || "default";
    version = versionParam || "v1";
  }

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
  const configService = useMemo(() => new UserConfigService(userId, version), [userId, version]);

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
                setData(section);
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
                setData(section);
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
              setData(section);
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
        console.log("Fixture mode: Changes not persisted", newData);
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

  return {
    data,
    loading,
    error,
    updateData,
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
        console.log("Fixture mode: Changes not persisted", data);
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
