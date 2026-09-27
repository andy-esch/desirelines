import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UserConfig,
  GoalsForYear,
  AnnotationsForYear,
  Preferences,
} from "../services/userConfigService";
import { useAuth } from "./useAuth";
import { useConfigDocument } from "./useConfigDocument";
import { logApiError } from "../api/errors";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import type { ConfigAdapter } from "../services/config/configAdapter";
import {
  selectSection,
  toSectionRef,
  withSection,
  type ConfigSection,
  type SectionRef,
} from "../services/config/sections";

// Discriminator for the supported configuration sections
type ConfigType = "goals" | "annotations" | "preferences";
// Union type for all supported configuration sections
type ConfigData = GoalsForYear | AnnotationsForYear | Preferences;

/** What the demo shows for a section with nothing saved, when the caller passes no default. */
function demoFallback(configType: ConfigType): ConfigData | null {
  if (configType === "annotations") return { annotations: [] };
  if (configType === "preferences") return DEFAULT_PREFERENCES;
  return null;
}

/** The error for a goals or annotations save without the year (and sport) it's saved under. */
function unplacedSectionError(configType: ConfigType): Error {
  return new Error(`${configType} are saved per year${configType === "goals" ? " and sport" : ""}`);
}

/**
 * The store holds only the session's own document, v1: an explicit `userId` or `version`
 * must name it. Kept for the signature; nothing passes either.
 */
function assertSessionDocument(uid: string | undefined, userId?: string, version?: string) {
  if (userId !== undefined && uid !== undefined && userId !== uid) {
    throw new Error("useUserConfig: userId doesn't match the signed-in account");
  }
  if (version !== undefined && version !== "v1") {
    throw new Error(`useUserConfig: only the v1 config is held, not ${version}`);
  }
}

/**
 * One section of the session's user config, read from and saved through the store
 * (`UserConfigProvider`): one cache entry for the whole document and one listener, however
 * many components call this.
 *
 * Type-safe return based on configType:
 * - "goals" → data is GoalsForYear | null (requires year and sport)
 * - "annotations" → data is AnnotationsForYear | null (requires year)
 * - "preferences" → data is Preferences | null
 *
 * Signed out, the store holds the demo's own storage (`services/demoStorage.ts`); signed
 * in, the account's Firestore document. The two never mix: signing in imports nothing from
 * the demo, and signed-in code never reads a demo key.
 *
 * `defaultValue` only shapes what the hook returns: the cache holds what is saved, and a
 * section with nothing saved is absent from it, signed in or out. `isSaved` says which
 * `data` is: something saved, or the default standing in for it (false while loading, and
 * while the first load has failed, when what's saved isn't known).
 *
 * A save updates the section in the cache at once and rolls back only that section if it
 * fails, so it can't undo another section's save made in between.
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
  isSaved: boolean;
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
  isSaved: boolean;
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
  isSaved: boolean;
};

// Implementation
export function useUserConfig(
  configType: ConfigType,
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
  isSaved: boolean;
} {
  const { user } = useAuth();
  assertSessionDocument(user?.uid, userId, version);
  const { doc, adapter, loading, error } = useConfigDocument();
  const queryClient = useQueryClient();
  const ref = toSectionRef(configType, year, sport);
  const saved = ref ? selectSection(doc, ref) : null;

  const mutation = useMutation({
    mutationFn: async (newData: ConfigData) => {
      if (!adapter) throw new Error("Your settings haven't loaded yet. Please try again.");
      if (!ref) throw unplacedSectionError(configType);
      await adapter.saveSection(ref, newData);
    },
    onMutate: async (
      newData: ConfigData
    ): Promise<
      { adapter: ConfigAdapter; ref: SectionRef; previous: ConfigSection | null } | undefined
    > => {
      if (!adapter || !ref) return undefined;
      // So a load finishing now can't put the pre-save copy over the optimistic one.
      await queryClient.cancelQueries({ queryKey: adapter.queryKey });
      const before = queryClient.getQueryData<UserConfig | null>(adapter.queryKey);
      const previous = selectSection(before, ref);
      // An account's preferences save leaves the stored theme in place (`updateTheme` is its
      // writer), so the cached theme stays too: the payload's theme, from a stale snapshot or
      // "" from defaults, would read to `ThemeSync` as a change and prompt it to act on it.
      const shown =
        adapter.kind === "account" && ref.section === "preferences"
          ? { ...(newData as Preferences), theme: (previous as Preferences | null)?.theme ?? "" }
          : newData;
      queryClient.setQueryData<UserConfig | null>(
        adapter.queryKey,
        withSection(before, ref, shown)
      );
      return { adapter, ref, previous };
    },
    onError: (_err, _newData, context) => {
      // Put back what this section held before the save, and only this section: a failed
      // first save (nothing was saved there) must not stay on screen as if it had been.
      if (!context) return;
      queryClient.setQueryData<UserConfig | null>(context.adapter.queryKey, (current) =>
        withSection(current, context.ref, context.previous)
      );
    },
    // No onSettled: the listener brings the saved document, and the demo's copy is the save.
  });

  const clearSaveError = useCallback(() => {
    mutation.reset();
  }, [mutation]);

  return {
    data: saved ?? defaultValue ?? (adapter?.kind === "demo" ? demoFallback(configType) : null),
    loading,
    error,
    updateData: async (newData: ConfigData) => {
      await mutation.mutateAsync(newData);
    },
    isSaving: mutation.isPending,
    saveError: mutation.error || null,
    clearSaveError,
    isSaved: saved !== null,
  };
}

/**
 * Hook for accessing the full user configuration
 * Use this when you need access to multiple config sections
 *
 * Reads the store's one document, so it adds no listener of its own. Signed out it has no
 * document to show: the demo keeps its sections apart, through `useUserConfig`.
 *
 * @param userId - Optional; must be the signed-in account's uid when given.
 * @param version - Config version: only "v1" is held.
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
  const { user } = useAuth();
  assertSessionDocument(user?.uid, userId, version);
  const { doc, adapter, loading, error } = useConfigDocument();
  const isAccount = adapter?.kind === "account";

  const mutation = useMutation({
    mutationFn: async ({
      configType,
      data,
      year,
      sport,
    }: {
      configType: ConfigType;
      data: ConfigData;
      year?: number | undefined;
      sport?: string | undefined;
    }) => {
      if (!isAccount || !adapter) {
        logApiError(new Error("Fixture mode: Changes not persisted"), "useFullUserConfig");
        return;
      }
      const ref = toSectionRef(configType, year, sport);
      if (!ref) throw unplacedSectionError(configType);
      await adapter.saveSection(ref, data);
    },
  });

  const updateSection = useCallback(
    async (
      configType: ConfigType,
      data: ConfigData,
      year?: number,
      sport?: string
    ): Promise<void> => {
      await mutation.mutateAsync({ configType, data, year, sport });
    },
    [mutation]
  );

  return {
    config: isAccount ? (doc ?? null) : null,
    loading,
    error: error || mutation.error,
    updateSection,
  };
}
