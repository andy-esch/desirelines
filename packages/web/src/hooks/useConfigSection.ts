import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Preferences, UserConfig } from "../services/userConfigService";
import { useConfigDocument } from "./useConfigDocument";
import type { ConfigAdapter } from "../services/config/configAdapter";
import {
  selectSection,
  withSection,
  type ConfigSection,
  type SectionRef,
} from "../services/config/sections";

export interface ConfigSectionState<T extends ConfigSection> {
  /** The section as saved; else `fallback`; else null. */
  value: T | null;
  loading: boolean;
  /** The first load failed, or the listener has since; after the latter `value` is the last good copy. */
  error: Error | null;
  /**
   * Whether `value` is something saved, or the fallback standing in for it. False while
   * loading, and while the first load has failed, when what's saved isn't known.
   */
  isSaved: boolean;
  save: (value: T) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  clearSaveError: () => void;
}

/**
 * One section of the session's user config, read from and saved through the store
 * (`UserConfigProvider`). The section hooks (`usePreferences`, `useGoals`,
 * `useAnnotations`) are built on this; call those rather than this.
 *
 * The cache holds what is saved, and `fallback` only shapes what's returned. A save shows
 * in the cache at once and, if it fails, rolls back that section alone, so it can't undo
 * another section's save made meanwhile.
 */
export function useConfigSection<T extends ConfigSection>(
  ref: SectionRef,
  fallback?: T
): ConfigSectionState<T> {
  const { doc, adapter, loading, error } = useConfigDocument();
  const queryClient = useQueryClient();
  const saved = selectSection(doc, ref) as T | null;

  const mutation = useMutation({
    mutationFn: async (value: T) => {
      if (!adapter) throw new Error("Your settings haven't loaded yet. Please try again.");
      await adapter.saveSection(ref, value);
    },
    onMutate: async (
      value: T
    ): Promise<{ adapter: ConfigAdapter; previous: ConfigSection | null } | undefined> => {
      if (!adapter) return undefined;
      // So a load finishing now can't put the pre-save copy over the optimistic one.
      await queryClient.cancelQueries({ queryKey: adapter.queryKey });
      const before = queryClient.getQueryData<UserConfig | null>(adapter.queryKey);
      const previous = selectSection(before, ref);
      // An account's preferences save leaves the stored theme in place (`saveTheme` is its
      // writer), so the cached theme stays too: the payload's theme, from a stale snapshot or
      // "" from defaults, would read to `ThemeSync` as a change and prompt it to act on it.
      const shown =
        adapter.kind === "account" && ref.section === "preferences"
          ? { ...(value as Preferences), theme: (previous as Preferences | null)?.theme ?? "" }
          : value;
      queryClient.setQueryData<UserConfig | null>(
        adapter.queryKey,
        withSection(before, ref, shown)
      );
      return { adapter, previous };
    },
    onError: (_err, _value, context) => {
      // Put back what this section held before the save, and only this section: a failed
      // first save (nothing was saved there) must not stay on screen as if it had been.
      if (!context) return;
      queryClient.setQueryData<UserConfig | null>(context.adapter.queryKey, (current) =>
        withSection(current, ref, context.previous)
      );
    },
    // No onSettled: the listener brings the saved document, and the demo's copy is the save.
  });

  // Both are the observer's own, so stable: effects and memos can depend on them.
  const { mutateAsync, reset } = mutation;
  const save = useCallback(
    async (value: T) => {
      await mutateAsync(value);
    },
    [mutateAsync]
  );
  const clearSaveError = useCallback(() => reset(), [reset]);

  return {
    value: saved ?? fallback ?? null,
    loading,
    error,
    isSaved: saved !== null,
    save,
    isSaving: mutation.isPending,
    saveError: mutation.error || null,
    clearSaveError,
  };
}
