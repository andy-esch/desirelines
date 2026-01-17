import { useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserConfigService,
  type UserConfig,
  type GoalsForYear,
  type AnnotationsForYear,
  type Preferences,
} from "../services/userConfigService";
import { useAuth } from "./useAuth";
import { logApiError } from "../api/errors";

// Union type for all supported configuration sections
type ConfigData = GoalsForYear | AnnotationsForYear | Preferences;

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
 * Helper to get localStorage key
 */
function getStorageKey(userId: string, configType: string, year?: number, sport?: string) {
  if (configType === "goals" && year !== undefined && sport !== undefined) {
    return `userConfig_${userId}_${configType}_${year}_${sport}`;
  } else if (year !== undefined) {
    return `userConfig_${userId}_${configType}_${year}`;
  } else {
    return `userConfig_${userId}_${configType}`;
  }
}

/**
 * Read from local storage with fallback
 */
function readFromLocalStorage(
  key: string,
  configType: string,
  defaultValue?: ConfigData
): ConfigData | null {
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (err) {
      logApiError(err, "Failed to parse stored config, using defaults");
    }
  }

  // Fall back to defaults
  if (configType === "goals") {
    return (defaultValue as GoalsForYear) || DEFAULT_GOALS;
  } else if (configType === "annotations") {
    return (defaultValue as AnnotationsForYear) || ({ annotations: [] } as AnnotationsForYear);
  } else if (configType === "preferences") {
    return (
      (defaultValue as Preferences) ||
      ({ theme: "light", defaultYear: new Date().getFullYear() } as Preferences)
    );
  }
  return null;
}

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

// Implementation
export function useUserConfig(
  configType: "goals" | "annotations" | "preferences",
  year?: number,
  sport?: string,
  defaultValue?: ConfigData,
  userId?: string,
  version?: string
): {
  data: any;
  loading: boolean;
  error: Error | null;
  updateData: (data: any) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  clearSaveError: () => void;
} {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const effectiveUserId = userId ?? user?.uid ?? "default";
  const effectiveVersion = version ?? "v1";
  const isLocalStorageMode = !user;

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(() => {
    if (isLocalStorageMode) return null;
    return new UserConfigService(userId, effectiveVersion);
  }, [userId, effectiveVersion, isLocalStorageMode]);

  // Query Key includes all dependencies
  const queryKey = useMemo(
    () => ["userConfig", configType, year, sport, effectiveUserId, effectiveVersion],
    [configType, year, sport, effectiveUserId, effectiveVersion]
  );

  // READ QUERY
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      // LocalStorage Mode
      if (isLocalStorageMode) {
        const key = getStorageKey(effectiveUserId, configType, year, sport);
        return readFromLocalStorage(key, configType, defaultValue);
      }

      // Firestore Mode
      if (!configService) throw new Error("Config service not initialized");

      // We need to cast types here because getConfigSection has overloads
      if (configType === "goals" && year !== undefined && sport !== undefined) {
        return configService.getConfigSection("goals", year, sport);
      } else if (configType === "annotations" && year !== undefined) {
        return configService.getConfigSection("annotations", year);
      } else if (configType === "preferences") {
        return configService.getConfigSection("preferences");
      }
      return null;
    },
    enabled: !authLoading,
    staleTime: Infinity, // Real-time subscription handles updates
  });

  // REAL-TIME SUBSCRIPTION
  useEffect(() => {
    // Skip if using localStorage mode or configService not ready
    if (isLocalStorageMode || !configService) return;

    let unsubscribe: () => void;

    // Subscribe based on config type
    if (configType === "goals" && year !== undefined && sport !== undefined) {
      unsubscribe = configService.subscribeToConfigSection(
        "goals",
        (newData) => {
          queryClient.setQueryData(queryKey, newData ?? defaultValue ?? null);
        },
        year,
        sport
      );
    } else if (configType === "annotations" && year !== undefined) {
      unsubscribe = configService.subscribeToConfigSection(
        "annotations",
        (newData) => {
          queryClient.setQueryData(queryKey, newData ?? defaultValue ?? null);
        },
        year
      );
    } else if (configType === "preferences") {
      unsubscribe = configService.subscribeToConfigSection("preferences", (newData) => {
        queryClient.setQueryData(queryKey, newData ?? defaultValue ?? null);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [
    configType,
    year,
    sport,
    configService,
    isLocalStorageMode,
    queryClient,
    queryKey,
    defaultValue,
  ]);

  // MIGRATION: LocalStorage -> Firestore
  // When a user signs in, migrate their demo data if no remote data exists
  useEffect(() => {
    // Only run if authenticated (not LS mode), finished loading, and no remote data exists
    if (isLocalStorageMode || isLoading || data || !configService) return;

    const key = getStorageKey("default", configType, year, sport);
    const localDataRaw = localStorage.getItem(key);

    if (localDataRaw) {
      try {
        const localData = JSON.parse(localDataRaw);

        mutation
          .mutateAsync(localData)
          .then(() => {
            localStorage.removeItem(key);
          })
          .catch((err) => {
            logApiError(err, `[useUserConfig] Migration failed for ${key}`);
          });
      } catch (err) {
        logApiError(err, `[useUserConfig] Invalid localStorage data for ${key}, clearing`);
        localStorage.removeItem(key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalStorageMode, isLoading, data === null, configType, year, sport, configService]);
  // Note: relying on data being null to trigger. If data changes to non-null, effect runs but early returns.

  // WRITE MUTATION
  const mutation = useMutation({
    mutationFn: async (newData: ConfigData) => {
      if (isLocalStorageMode) {
        const key = getStorageKey(effectiveUserId, configType, year, sport);
        localStorage.setItem(key, JSON.stringify(newData));
        return newData;
      }

      if (!configService) throw new Error("Config service not initialized");

      if (configType === "goals" && year !== undefined && sport !== undefined) {
        await configService.updateConfigSection("goals", newData as GoalsForYear, year, sport);
      } else if (configType === "annotations" && year !== undefined) {
        await configService.updateConfigSection("annotations", newData as AnnotationsForYear, year);
      } else if (configType === "preferences") {
        await configService.updateConfigSection("preferences", newData as Preferences);
      }
      return newData;
    },
    onMutate: async (newData) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(queryKey);

      // Optimistically update to the new value
      queryClient.setQueryData(queryKey, newData);

      // Return a context object with the snapshotted value
      return { previousData };
    },
    onError: (_err, _newData, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    // No onSettled needed because subscription will update with server data
  });

  const clearSaveError = useCallback(() => {
    mutation.reset();
  }, [mutation]);

  return {
    data: data ?? defaultValue ?? null,
    loading: isLoading || authLoading, // Treat auth loading as loading
    error: (error as Error | null) || null,
    updateData: async (newData: ConfigData) => {
      await mutation.mutateAsync(newData);
    },
    isSaving: mutation.isPending,
    saveError: (mutation.error as Error | null) || null,
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
export function useFullUserConfig(
  userId?: string,
  version: string = "v1"
): {
  config: UserConfig | null;
  loading: boolean;
  error: Error | null;
  updateSection: (
    configType: "goals" | "annotations" | "preferences",
    data: ConfigData,
    year?: number,
    sport?: string
  ) => Promise<void>;
} {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  // Determine if we're in localStorage mode based on auth state
  const isLocalStorageMode = !user;
  const effectiveUserId = userId ?? user?.uid ?? "default";

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(() => {
    if (isLocalStorageMode) {
      return null;
    }
    return new UserConfigService(userId, version);
  }, [userId, version, isLocalStorageMode]);

  const queryKey = useMemo(
    () => ["fullUserConfig", effectiveUserId, version],
    [effectiveUserId, version]
  );

  // READ
  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (isLocalStorageMode || !configService) return null;
      return configService.getConfig();
    },
    enabled: !authLoading,
    staleTime: Infinity,
  });

  // REAL-TIME SUBSCRIPTION
  useEffect(() => {
    if (isLocalStorageMode || !configService) return;

    const unsubscribe = configService.subscribeToConfig((fullConfig) => {
      queryClient.setQueryData(queryKey, fullConfig);
    });

    return unsubscribe;
  }, [configService, isLocalStorageMode, queryClient, queryKey]);

  // MUTATION
  const mutation = useMutation({
    mutationFn: async ({
      configType,
      data,
      year,
      sport,
    }: {
      configType: "goals" | "annotations" | "preferences";
      data: GoalsForYear | AnnotationsForYear | Preferences;
      year?: number;
      sport?: string;
    }) => {
      if (isLocalStorageMode) {
        logApiError(new Error("Fixture mode: Changes not persisted"), "useFullUserConfig");
        return;
      }

      if (!configService) throw new Error("Config service not initialized");

      if (configType === "goals" && year !== undefined && sport !== undefined) {
        await configService.updateConfigSection("goals", data as GoalsForYear, year, sport);
      } else if (configType === "annotations" && year !== undefined) {
        await configService.updateConfigSection("annotations", data as AnnotationsForYear, year);
      } else if (configType === "preferences") {
        await configService.updateConfigSection("preferences", data as Preferences);
      }
    },
  });

  const updateSection = useCallback(
    async (
      configType: "goals" | "annotations" | "preferences",
      data: GoalsForYear | AnnotationsForYear | Preferences,
      year?: number,
      sport?: string
    ): Promise<void> => {
      await mutation.mutateAsync({ configType, data, year, sport });
    },
    [mutation]
  );

  return {
    config: config ?? null,
    loading: isLoading || authLoading,
    error: (error as Error | null) || (mutation.error as Error | null),
    updateSection,
  };
}
