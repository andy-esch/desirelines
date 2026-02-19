import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { CheckIcon, CloseIcon, EyeIcon, EyeSlashIcon } from "../icons";
import NeonSpinner from "../NeonSpinner";
import { InlineAlert } from "../InlineAlert";

/** Duration to show "Saved" indicator */
const SAVE_SUCCESS_DURATION = 2000;

/** Sport entry with parsed config */
interface SportEntry {
  key: string;
  displayName: string;
  stravaTypes: string[];
  metrics: string[];
}

/** Format metric key for display (e.g., "distance_meters" -> "Distance") */
function formatMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    distance_meters: "Distance",
    time_minutes: "Time",
    elevation_meters: "Elevation",
    activities: "Activities",
  };
  return labels[metric] || metric;
}

/** Check if a Set and array have the same elements */
function setsMatch(set: Set<string>, arr: string[]): boolean {
  if (set.size !== arr.length) return false;
  for (const item of arr) {
    if (!set.has(item)) return false;
  }
  return true;
}

/** Check if a Set differs from a baseline array */
function selectionDiffers(selection: Set<string>, baseline: string[] | null): boolean {
  if (baseline === null) return false;
  return !setsMatch(selection, baseline);
}

/** Reusable sport table for both visible and hidden sections */
function SportTable({
  sports,
  actionVariant,
  onAction,
  disabled,
  emptyMessage,
}: {
  sports: SportEntry[];
  actionVariant: "show" | "hide";
  onAction: (key: string) => void;
  disabled?: (key: string) => boolean;
  emptyMessage: string;
}) {
  if (sports.length === 0) {
    return <div className="text-slate-light py-2 text-sm">{emptyMessage}</div>;
  }

  // Use eye icons: EyeIcon for "show" (make visible), EyeSlashIcon for "hide"
  const ActionIcon = actionVariant === "show" ? EyeIcon : EyeSlashIcon;
  const actionTitle = actionVariant === "show" ? "Show sport" : "Hide sport";

  return (
    <div className="table-responsive">
      <table className="table table-sm mb-0">
        <thead>
          <tr>
            <th style={{ width: "130px" }}>Sport</th>
            <th>Strava Types</th>
            <th style={{ width: "130px" }}>Metrics</th>
            <th style={{ width: "44px" }}></th>
          </tr>
        </thead>
        <tbody>
          {sports.map((sport) => {
            const isDisabled = disabled?.(sport.key) ?? false;
            return (
              <tr key={sport.key}>
                <td className="align-middle font-medium">{sport.displayName}</td>
                <td className="align-middle">
                  <span className="text-slate-light text-sm" style={{ lineHeight: 1.4 }}>
                    {sport.stravaTypes.join(", ")}
                  </span>
                </td>
                <td className="align-middle">
                  <span className="text-sm">{sport.metrics.map(formatMetricLabel).join(", ")}</span>
                </td>
                <td className="align-middle text-right">
                  {isDisabled ? (
                    <span
                      className="inline-block"
                      tabIndex={0}
                      title="At least one sport must be visible"
                      style={{ cursor: "not-allowed" }}
                    >
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled
                        style={{ padding: "0.25rem 0.4rem", pointerEvents: "none" }}
                        aria-label={actionTitle}
                      >
                        <ActionIcon size={14} />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn-sm ${actionVariant === "show" ? "btn-outline-success" : "btn-outline-secondary"}`}
                      onClick={() => onAction(sport.key)}
                      style={{ padding: "0.25rem 0.4rem" }}
                      title={actionTitle}
                      aria-label={`${actionTitle}: ${sport.displayName}`}
                    >
                      <ActionIcon size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Auto-save debounce delay in milliseconds */
const AUTO_SAVE_DELAY = 500;

/**
 * Sport visibility settings component.
 *
 * Allows users to select which sports appear throughout the app.
 * Features:
 * - Two-box layout: Visible Sports and Hidden Sports
 * - Live filter box (filters as you type)
 * - Shows display name, Strava types, and available metrics
 * - Auto-saves changes after a brief debounce
 * - Validates at least one sport must be selected
 */
export function SportVisibilitySettings() {
  const { sportConfig, isLoading: configLoading, error: configError } = useSportConfig();
  const {
    visibleSports,
    setVisibleSports,
    isLoading: prefsLoading,
    isSaving,
    saveError,
    clearSaveError,
  } = useVisibleSports();

  // Local state for UI
  const [localSelection, setLocalSelection] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // Track what visibleSports we last synced from
  const lastSyncedRef = useRef<string[] | null>(null);
  // Track if we're initialized (to prevent auto-save on initial load)
  const isInitializedRef = useRef(false);
  // Ref to read localSelection inside effects without adding it as a dependency
  const localSelectionRef = useRef(localSelection);
  useEffect(() => {
    localSelectionRef.current = localSelection;
  });
  // Debounce timer for auto-save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timer for success message dismissal (for cleanup)
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync localSelection with visibleSports when it changes from external source.
  // But only if user hasn't made unsaved edits.
  useEffect(() => {
    if (visibleSports.length === 0) return;

    const lastSynced = lastSyncedRef.current;
    const currentSelection = localSelectionRef.current;

    // Check if visibleSports actually changed from what we last synced
    // (Use Set for O(1) lookup instead of array.includes which is O(n))
    const visibleSet = new Set(visibleSports);
    const visibleSportsChanged = lastSynced === null || !setsMatch(visibleSet, lastSynced);

    if (!visibleSportsChanged) return; // No change, nothing to do

    // Check if localSelection already matches visibleSports (avoid unnecessary Set creation)
    if (setsMatch(currentSelection, visibleSports)) {
      // Just update the ref, no need to create new Set
      lastSyncedRef.current = visibleSports;
      isInitializedRef.current = true;
      return;
    }

    // Check if user has unsaved edits (localSelection differs from lastSynced)
    const hasUnsavedEdits = lastSynced !== null && !setsMatch(currentSelection, lastSynced);

    if (!hasUnsavedEdits) {
      // Safe to sync - user hasn't made changes
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external Firestore state into local state
      setLocalSelection(new Set(visibleSports));
      lastSyncedRef.current = visibleSports;
      isInitializedRef.current = true;
    }
    // Note: if user has unsaved edits, we don't sync (preserve their work)
  }, [visibleSports]);

  // Get sorted sport entries
  const sportEntries = useMemo(() => {
    if (!sportConfig?.sport_categories) return [];

    return Object.entries(sportConfig.sport_categories)
      .map(([key, config]) => ({
        key,
        displayName: config.display_name,
        stravaTypes: config.strava_types,
        metrics: config.metrics,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [sportConfig]);

  // Filter and split sports into visible and hidden
  const { visibleFiltered, hiddenFiltered } = useMemo(() => {
    const search = filterText.toLowerCase().trim();

    const matchesFilter = (sport: SportEntry) => {
      if (!search) return true;
      return (
        sport.displayName.toLowerCase().includes(search) ||
        sport.key.toLowerCase().includes(search) ||
        sport.stravaTypes.some((t) => t.toLowerCase().includes(search))
      );
    };

    const visible: SportEntry[] = [];
    const hidden: SportEntry[] = [];

    for (const sport of sportEntries) {
      if (!matchesFilter(sport)) continue;

      if (localSelection.has(sport.key)) {
        visible.push(sport);
      } else {
        hidden.push(sport);
      }
    }

    return { visibleFiltered: visible, hiddenFiltered: hidden };
  }, [sportEntries, localSelection, filterText]);

  // Show a sport (add to selection)
  const showSport = useCallback((sportKey: string) => {
    setLocalSelection((prev) => new Set([...prev, sportKey]));
  }, []);

  // Hide a sport (remove from selection)
  const hideSport = useCallback((sportKey: string) => {
    setLocalSelection((prev) => {
      if (prev.size <= 1) return prev; // Keep at least one
      const next = new Set(prev);
      next.delete(sportKey);
      return next;
    });
  }, []);

  // Auto-save effect: debounced save when localSelection changes
  useEffect(() => {
    // Don't save during initial load or if not initialized
    if (!isInitializedRef.current) return;
    // Check for changes at effect time (not render time) to avoid stale ref reads
    if (!selectionDiffers(localSelection, lastSyncedRef.current)) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule save after debounce delay
    saveTimeoutRef.current = setTimeout(async () => {
      // Re-check at save time in case sync effect updated the ref
      if (!selectionDiffers(localSelection, lastSyncedRef.current)) return;

      const sportsToSave = Array.from(localSelection);
      // Update lastSynced BEFORE async call to prevent race with sync effect
      // (React may re-render during the await, and sync effect would see stale ref)
      lastSyncedRef.current = sportsToSave;
      try {
        await setVisibleSports(sportsToSave);
        setShowSaveSuccess(true);
        // Clear any existing success timeout before setting a new one
        if (successTimeoutRef.current) {
          clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(
          () => setShowSaveSuccess(false),
          SAVE_SUCCESS_DURATION
        );
      } catch (err) {
        // Rollback ref on error so retry is possible
        lastSyncedRef.current = null;
        console.error("Failed to auto-save visible sports:", err);
      }
    }, AUTO_SAVE_DELAY);

    // Cleanup timeouts on unmount or re-run
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, [localSelection, setVisibleSports]);

  // Loading state
  if (configLoading || prefsLoading) {
    return (
      <div className="flex justify-center py-6">
        <NeonSpinner />
      </div>
    );
  }

  // Error state
  if (configError) {
    return (
      <div className="alert alert-danger" role="alert">
        Failed to load sport configuration: {configError.message}
      </div>
    );
  }

  if (!sportConfig || sportEntries.length === 0) {
    return <div className="text-slate-light py-6">No sport configuration available.</div>;
  }

  const noFilterResults = filterText && visibleFiltered.length === 0 && hiddenFiltered.length === 0;

  return (
    <div>
      {/* Filter input */}
      <div className="mb-6 relative" style={{ maxWidth: "300px" }}>
        <input
          type="text"
          className="form-control form-control-sm pe-6"
          placeholder="Filter sports..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {filterText && (
          <button
            type="button"
            className="btn btn-link btn-sm absolute top-50 end-0 translate-middle-y text-slate-light p-0 pe-2"
            onClick={() => setFilterText("")}
            aria-label="Clear filter"
            style={{ lineHeight: 1 }}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {noFilterResults ? (
        <div className="text-slate-light py-6 text-center">No sports match "{filterText}"</div>
      ) : (
        <>
          {/* Visible Sports Box */}
          <div
            className="border rounded p-6 mb-6"
            style={{ backgroundColor: "color-mix(in srgb, var(--color-success) 5%, transparent)" }}
          >
            <h6 className="mb-2 flex items-center gap-2">
              <span style={{ color: "var(--color-success)" }}>Visible</span>
              <span className="badge bg-success">{localSelection.size}</span>
            </h6>
            <SportTable
              sports={visibleFiltered}
              actionVariant="hide"
              onAction={hideSport}
              disabled={(key) => localSelection.size === 1 && localSelection.has(key)}
              emptyMessage={filterText ? "No visible sports match filter" : "No sports visible"}
            />
          </div>

          {/* Hidden Sports Box */}
          <div
            className="border rounded p-6"
            style={{ backgroundColor: "var(--color-surface-hover)" }}
          >
            <h6 className="mb-2 flex items-center gap-2">
              <span className="text-slate-light">Hidden</span>
              <span className="badge bg-secondary">
                {sportEntries.length - localSelection.size}
              </span>
            </h6>
            <SportTable
              sports={hiddenFiltered}
              actionVariant="show"
              onAction={showSport}
              emptyMessage={filterText ? "No hidden sports match filter" : "No sports hidden"}
            />
          </div>
        </>
      )}

      {/* Summary and save status */}
      <div className="flex justify-between items-center mt-6 pt-6 border-t">
        {!noFilterResults && (
          <span className="text-slate-light text-sm">
            {localSelection.size} of {sportEntries.length} sports visible
          </span>
        )}
        {noFilterResults && <span />}

        {/* Auto-save status indicator */}
        <span className="text-sm flex items-center gap-1">
          {isSaving && <span className="text-slate-light">Saving...</span>}
          {showSaveSuccess && (
            <span className="text-success flex items-center gap-1">
              <CheckIcon />
              Saved
            </span>
          )}
        </span>
      </div>

      {/* Save error */}
      {saveError && (
        <InlineAlert className="mt-6 mb-0" onDismiss={clearSaveError}>
          Failed to save: {saveError.message}
        </InlineAlert>
      )}
    </div>
  );
}
