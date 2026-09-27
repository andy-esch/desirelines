import { useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  UserConfigService,
  parseConfigData,
  hasPreferencesBesidesTheme,
  type UserConfig,
  type GoalsForYear,
  type AnnotationsForYear,
  type Preferences,
} from "../services/userConfigService";
import { useAuth } from "./useAuth";
import { useServices } from "../contexts/ServiceContext";
import { logApiError } from "../api/errors";
import { DEFAULT_PREFERENCES } from "../constants/settings";

// Discriminator for the supported configuration sections
type ConfigType = "goals" | "annotations" | "preferences";
// Union type for all supported configuration sections
type ConfigData = GoalsForYear | AnnotationsForYear | Preferences;

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
 * Read from localStorage and validate against the section's Zod schema.
 *
 * Mirrors the sign-in migration's validation path so demo-mode reads can't
 * surface partially-written or corrupted blobs to the rest of the app.
 * Invalid data is logged and treated the same as a missing entry — the
 * caller's `defaultValue` (or the configType-specific fallback below)
 * is returned instead.
 */
function readFromLocalStorage(
  key: string,
  configType: ConfigType,
  defaultValue?: ConfigData
): ConfigData | null {
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      const result = parseConfigData(configType, parsed);
      if (result.ok) {
        return result.data;
      }
      logApiError(result.error, `[useUserConfig] localStorage at ${key} failed schema validation`);
    } catch (err) {
      logApiError(err, "Failed to parse stored config, using defaults");
    }
  }

  // Fall back to defaults. Goals callers (useSportPageData, DemoSportPage)
  // always supply a sport-aware `defaultValue`, so returning null when one
  // isn't passed is correct — the consumer's null-handling kicks in.
  if (configType === "goals") {
    return (defaultValue as GoalsForYear) ?? null;
  } else if (configType === "annotations") {
    return (defaultValue as AnnotationsForYear) || { annotations: [] };
  } else if (configType === "preferences") {
    return (defaultValue as Preferences) || DEFAULT_PREFERENCES;
  }
  return null;
}

/**
 * Sign-in migrations claimed so far, per query client (one per app, and a fresh one per
 * test): keys are the signed-in uid and the demo localStorage key. See the migration effect.
 */
const migrationClaims = new WeakMap<QueryClient, Set<string>>();

function claimedMigrations(client: QueryClient): Set<string> {
  let claims = migrationClaims.get(client);
  if (!claims) {
    claims = new Set();
    migrationClaims.set(client, claims);
  }
  return claims;
}

/**
 * Hook for accessing user config with real-time Firestore sync.
 *
 * Type-safe return based on configType:
 * - "goals" → data is GoalsForYear | null (requires year and sport)
 * - "annotations" → data is AnnotationsForYear | null (requires year)
 * - "preferences" → data is Preferences | null
 *
 * Beyond the basic query/mutation, the hook also owns two boundary effects:
 *
 *   1. **Sign-in migration**: when the user authenticates, demo localStorage
 *      data for the same section is Zod-validated and promoted into
 *      Firestore (`parseConfigData` is the gate — see `userConfigService.ts`).
 *      Malformed payloads are logged and left in place for diagnosis.
 *   2. **Orphan localStorage cleanup**: when Firestore already has data for
 *      the section, any leftover demo localStorage entry is deleted on next
 *      render — so a user who signed up, played in demo, then signed in
 *      doesn't accumulate stale localStorage forever. Preferences holding only
 *      the theme `ThemeSync` wrote count as empty, so demo preferences migrate.
 *
 * Both effects live inside the hook (search "MIGRATION + CLEANUP" in the
 * body) and run automatically, once per section however many consumers are
 * mounted; callers don't need to coordinate them.
 *
 * Signed in, `defaultValue` only shapes what the hook returns: the query cache
 * holds what Firestore holds (null for an empty section), which is how the
 * migration tells an empty account from a populated one.
 *
 * Demo-mode reads (`readFromLocalStorage` below) apply the same Zod
 * validation, so corrupted localStorage can't surface junk to consumers.
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
  data: ConfigData | null;
  loading: boolean;
  error: Error | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloads provide type safety to callers
  updateData: (data: any) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  clearSaveError: () => void;
} {
  const { user, loading: authLoading } = useAuth();
  const { authService, databaseService } = useServices();
  const queryClient = useQueryClient();

  const effectiveUserId = userId ?? user?.uid ?? "anonymous";
  const effectiveVersion = version ?? "v1";
  const isLocalStorageMode = !user;

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(() => {
    if (isLocalStorageMode) return null;
    return new UserConfigService(userId, effectiveVersion, { authService, databaseService });
  }, [userId, effectiveVersion, isLocalStorageMode, authService, databaseService]);

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
  //
  // The cache holds what Firestore holds: null for an empty section, never the caller's
  // `defaultValue`, which is applied only where the hook returns. The migration below reads
  // the cache to tell an empty account from a populated one, so a default cached here made
  // a new user's demo data look orphaned, and it was deleted instead of migrated.
  useEffect(() => {
    // Skip if using localStorage mode or configService not ready
    if (isLocalStorageMode || !configService) return;

    let unsubscribe: () => void;

    // Subscribe based on config type
    if (configType === "goals" && year !== undefined && sport !== undefined) {
      unsubscribe = configService.subscribeToConfigSection(
        "goals",
        (newData) => {
          queryClient.setQueryData(queryKey, newData ?? null);
        },
        year,
        sport
      );
    } else if (configType === "annotations" && year !== undefined) {
      unsubscribe = configService.subscribeToConfigSection(
        "annotations",
        (newData) => {
          queryClient.setQueryData(queryKey, newData ?? null);
        },
        year
      );
    } else if (configType === "preferences") {
      unsubscribe = configService.subscribeToConfigSection("preferences", (newData) => {
        queryClient.setQueryData(queryKey, newData ?? null);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [configType, year, sport, configService, isLocalStorageMode, queryClient, queryKey]);

  // WRITE MUTATION (declared before migration effect which references it)
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

      // Optimistically update to the new value. A Firestore preferences save leaves the
      // stored theme in place (`updateTheme` is its writer), so the cached theme stays too:
      // the payload's theme, often "" from demo data, would read to `ThemeSync` as no synced
      // theme and prompt it to write one.
      queryClient.setQueryData(
        queryKey,
        !isLocalStorageMode && configType === "preferences"
          ? {
              ...(newData as Preferences),
              theme: (previousData as Preferences | null | undefined)?.theme ?? "",
            }
          : newData
      );

      // Return a context object with the snapshotted value
      return { previousData };
    },
    onError: (_err, _newData, context) => {
      // Put back what was cached before the save, nothing included: a failed first save
      // (an empty section caches null) must not stay on screen as if it had been saved.
      if (context) queryClient.setQueryData(queryKey, context.previousData ?? null);
    },
    // No onSettled needed because subscription will update with server data
  });

  const clearSaveError = useCallback(() => {
    mutation.reset();
  }, [mutation]);

  // MIGRATION + CLEANUP: localStorage → Firestore
  //
  // Two paths, both gated on the user being authenticated and the auth/data
  // load having settled:
  //
  //   1. **Migration** (Firestore empty for this section): if there's a demo
  //      localStorage entry, validate it against the section's Zod schema and
  //      promote it into Firestore. Delete on success. On validation failure,
  //      leave the entry in place so it can be inspected during diagnosis
  //      rather than silently dropped.
  //   2. **Cleanup** (Firestore already has data for this section): the demo
  //      entry is orphaned — Firestore is the source of truth and a user
  //      signing in with both populated would otherwise leave the localStorage
  //      key sitting around forever. Drop it.
  //
  // Every mounted consumer of a section runs this effect. The one that starts the save claims
  // the section (`claimedMigrations`), and the rest skip it while the claim stands: they
  // would save it again, or, once the optimistic update has put the demo data in the cache,
  // drop the entry as an orphan. The claim is released when the save lands. A failed save
  // keeps its claim until the next page load, which retries, rather than retrying in a loop.
  useEffect(() => {
    if (!user || isLoading || !configService) return;

    // Read the key the *pre-sign-in* session wrote: the unauthenticated
    // effectiveUserId, which is `userId ?? "anonymous"` (NOT `user.uid`). This
    // effect only runs once signed in, so `effectiveUserId` here is the
    // authenticated uid — using it (or the old hardcoded "default") reads a
    // `userConfig_<uid|default>_*` key that nothing ever wrote, and the
    // migration silently no-ops. See audit 2026-06-01-web C1.
    const anonymousUserId = userId ?? "anonymous";
    const key = getStorageKey(anonymousUserId, configType, year, sport);
    const claims = claimedMigrations(queryClient);
    const claim = `${user.uid} ${key}`;
    if (claims.has(claim)) return;
    const localDataRaw = localStorage.getItem(key);
    if (!localDataRaw) return;

    // Preferences holding only the theme `ThemeSync` wrote at sign-in count as empty, so
    // demo preferences still migrate into them (and the save keeps that theme).
    const hasRemoteData =
      configType === "preferences"
        ? hasPreferencesBesidesTheme(data)
        : data !== null && data !== undefined;

    // Path 2 — Firestore is authoritative; the demo entry is orphaned.
    if (hasRemoteData) {
      localStorage.removeItem(key);
      return;
    }

    // Path 1 — Firestore is empty; try to migrate the demo entry into it.
    try {
      const parsedJson = JSON.parse(localDataRaw) as unknown;
      // Validate the payload's shape against the Zod schema before trusting
      // it. Without this we'd happily promote any malformed demo blob into
      // Firestore — see the goal-storage incident where raw display values
      // leaked in via this path.
      const parseResult = parseConfigData(configType, parsedJson);
      if (parseResult.ok) {
        claims.add(claim);
        mutation
          .mutateAsync(parseResult.data)
          .then(() => {
            localStorage.removeItem(key);
            claims.delete(claim);
          })
          .catch((err) => {
            logApiError(err, `[useUserConfig] Migration failed for ${key}; retried on next load`);
          });
      } else {
        // Don't delete: leave the entry in place so it can be inspected
        // during diagnosis rather than silently dropping (potentially
        // recoverable) data.
        logApiError(
          parseResult.error,
          `[useUserConfig] localStorage data at ${key} failed schema validation; not migrating`
        );
      }
    } catch (err) {
      logApiError(err, `[useUserConfig] Invalid localStorage data for ${key}, clearing`);
      localStorage.removeItem(key);
    }
  }, [
    isLoading,
    data,
    user,
    userId,
    configType,
    year,
    sport,
    configService,
    queryClient,
    mutation,
  ]);

  return {
    data: data ?? defaultValue ?? null,
    loading: isLoading || authLoading, // Treat auth loading as loading
    error: error || null,
    updateData: async (newData: ConfigData) => {
      await mutation.mutateAsync(newData);
    },
    isSaving: mutation.isPending,
    saveError: mutation.error || null,
    clearSaveError,
  };
}

/**
 * Hook for accessing the full user configuration
 * Use this when you need access to multiple config sections
 *
 * @param userId - Optional userId override. If not provided, uses authenticated user's UID
 *   (or "anonymous" for unauthenticated users). Providing an explicit userId when authenticated
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
  const { authService, databaseService } = useServices();
  const queryClient = useQueryClient();

  // Determine if we're in localStorage mode based on auth state
  const isLocalStorageMode = !user;
  const effectiveUserId = userId ?? user?.uid ?? "anonymous";

  // Memoize configService to avoid recreating on every render
  const configService = useMemo(() => {
    if (isLocalStorageMode) {
      return null;
    }
    return new UserConfigService(userId, version, { authService, databaseService });
  }, [userId, version, isLocalStorageMode, authService, databaseService]);

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
      year?: number | undefined;
      sport?: string | undefined;
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
    error: error || mutation.error,
    updateSection,
  };
}
