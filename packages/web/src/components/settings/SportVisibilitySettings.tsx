import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import NeonSpinner from "../NeonSpinner";

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

/** Reusable sport table for both visible and hidden sections */
function SportTable({
  sports,
  actionLabel,
  actionVariant,
  onAction,
  disabled,
  emptyMessage,
}: {
  sports: SportEntry[];
  actionLabel: string;
  actionVariant: "show" | "hide";
  onAction: (key: string) => void;
  disabled?: (key: string) => boolean;
  emptyMessage: string;
}) {
  if (sports.length === 0) {
    return <div className="text-muted py-2 small">{emptyMessage}</div>;
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm mb-0">
        <thead>
          <tr>
            <th style={{ width: "130px" }}>Sport</th>
            <th>Strava Types</th>
            <th style={{ width: "130px" }}>Metrics</th>
            <th style={{ width: "70px" }}></th>
          </tr>
        </thead>
        <tbody>
          {sports.map((sport) => {
            const isDisabled = disabled?.(sport.key) ?? false;
            return (
              <tr key={sport.key}>
                <td className="align-middle fw-medium">{sport.displayName}</td>
                <td className="align-middle">
                  <span className="text-muted small" style={{ lineHeight: 1.4 }}>
                    {sport.stravaTypes.join(", ")}
                  </span>
                </td>
                <td className="align-middle">
                  <span className="small">{sport.metrics.map(formatMetricLabel).join(", ")}</span>
                </td>
                <td className="align-middle text-end">
                  {isDisabled ? (
                    <span
                      className="d-inline-block"
                      tabIndex={0}
                      data-bs-toggle="tooltip"
                      title="At least one sport must be visible"
                      style={{ cursor: "not-allowed" }}
                    >
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.15rem 0.5rem",
                          pointerEvents: "none",
                        }}
                      >
                        {actionLabel}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn-sm ${actionVariant === "show" ? "btn-outline-success" : "btn-outline-secondary"}`}
                      onClick={() => onAction(sport.key)}
                      style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem" }}
                    >
                      {actionLabel}
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

/**
 * Sport visibility settings component.
 *
 * Allows users to select which sports appear throughout the app.
 * Features:
 * - Two-box layout: Visible Sports and Hidden Sports
 * - Live filter box (filters as you type)
 * - Shows display name, Strava types, and available metrics
 * - Explicit "Save Changes" button (no auto-save)
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
  } = useVisibleSports();

  // Local state for unsaved changes
  const [localSelection, setLocalSelection] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // Track what visibleSports we last synced from
  const lastSyncedRef = useRef<string[] | null>(null);

  // Sync localSelection with visibleSports when it changes
  // But only if user hasn't made unsaved edits (localSelection matches lastSynced)
  useEffect(() => {
    if (visibleSports.length === 0) return;

    const lastSynced = lastSyncedRef.current;

    // Check if visibleSports actually changed from what we last synced
    const visibleSportsChanged =
      lastSynced === null ||
      lastSynced.length !== visibleSports.length ||
      !lastSynced.every((s) => visibleSports.includes(s));

    if (!visibleSportsChanged) return; // No change, nothing to do

    // Check if user has unsaved edits (localSelection differs from lastSynced)
    const hasUnsavedEdits =
      lastSynced !== null &&
      (localSelection.size !== lastSynced.length ||
        !lastSynced.every((s) => localSelection.has(s)));

    if (!hasUnsavedEdits) {
      // Safe to sync - user hasn't made changes
      setLocalSelection(new Set(visibleSports));
      lastSyncedRef.current = visibleSports;
    }
    // Note: if user has unsaved edits, we don't sync (preserve their work)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSports]); // Only depend on visibleSports, not localSelection

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

  // Check if there are unsaved changes
  // Check if local selection differs from last synced (i.e., user made changes)
  const hasChanges = useMemo(() => {
    const lastSynced = lastSyncedRef.current;
    if (lastSynced === null) return false; // Not initialized yet
    if (localSelection.size !== lastSynced.length) return true;
    for (const sport of localSelection) {
      if (!lastSynced.includes(sport)) return true;
    }
    return false;
  }, [localSelection]);

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

  // Save changes
  const handleSave = useCallback(async () => {
    const sportsToSave = Array.from(localSelection);
    try {
      await setVisibleSports(sportsToSave);
      // Only update lastSynced on success so hasChanges stays accurate
      lastSyncedRef.current = sportsToSave;
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    } catch (err) {
      // Error is exposed via saveError from the hook, no need to handle here
      console.error("Failed to save visible sports:", err);
    }
  }, [localSelection, setVisibleSports]);

  // Reset to last saved state
  const handleReset = useCallback(() => {
    if (lastSyncedRef.current) {
      setLocalSelection(new Set(lastSyncedRef.current));
    }
  }, []);

  // Loading state
  if (configLoading || prefsLoading) {
    return (
      <div className="d-flex justify-content-center py-4">
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
    return <div className="text-muted py-3">No sport configuration available.</div>;
  }

  const noFilterResults = filterText && visibleFiltered.length === 0 && hiddenFiltered.length === 0;

  return (
    <div>
      {/* Filter input */}
      <div className="mb-3 position-relative" style={{ maxWidth: "300px" }}>
        <input
          type="text"
          className="form-control form-control-sm pe-4"
          placeholder="Filter sports..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {filterText && (
          <button
            type="button"
            className="btn btn-link btn-sm position-absolute top-50 end-0 translate-middle-y text-muted p-0 pe-2"
            onClick={() => setFilterText("")}
            aria-label="Clear filter"
            style={{ lineHeight: 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        )}
      </div>

      {noFilterResults ? (
        <div className="text-muted py-3 text-center">No sports match "{filterText}"</div>
      ) : (
        <>
          {/* Visible Sports Box */}
          <div
            className="border rounded p-3 mb-3"
            style={{ backgroundColor: "rgba(0, 128, 0, 0.03)" }}
          >
            <h6 className="mb-2 d-flex align-items-center gap-2">
              <span style={{ color: "var(--bs-success, #198754)" }}>Visible</span>
              <span className="badge bg-success">{localSelection.size}</span>
            </h6>
            <SportTable
              sports={visibleFiltered}
              actionLabel="Hide"
              actionVariant="hide"
              onAction={hideSport}
              disabled={(key) => localSelection.size === 1 && localSelection.has(key)}
              emptyMessage={filterText ? "No visible sports match filter" : "No sports visible"}
            />
          </div>

          {/* Hidden Sports Box */}
          <div className="border rounded p-3" style={{ backgroundColor: "rgba(0, 0, 0, 0.02)" }}>
            <h6 className="mb-2 d-flex align-items-center gap-2">
              <span className="text-muted">Hidden</span>
              <span className="badge bg-secondary">
                {sportEntries.length - localSelection.size}
              </span>
            </h6>
            <SportTable
              sports={hiddenFiltered}
              actionLabel="Show"
              actionVariant="show"
              onAction={showSport}
              emptyMessage={filterText ? "No hidden sports match filter" : "No sports hidden"}
            />
          </div>
        </>
      )}

      {/* Summary and actions */}
      <div className="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
        {!noFilterResults && (
          <span className="text-muted small">
            {localSelection.size} of {sportEntries.length} sports visible
          </span>
        )}
        {noFilterResults && <span />}

        <div className="d-flex align-items-center gap-2">
          {showSaveSuccess && (
            <span className="text-success small d-flex align-items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
              </svg>
              Saved
            </span>
          )}
          {hasChanges && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleReset}
              disabled={isSaving}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${hasChanges ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? "Saving..." : hasChanges ? "Save Changes" : "Saved"}
          </button>
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          Failed to save: {saveError.message}
        </div>
      )}
    </div>
  );
}
