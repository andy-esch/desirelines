import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type { ActivityTotals } from "../../utils/routeFilters";

/**
 * The map chrome uses the vivid in-house **neon** palette in dark mode, not the
 * default azure `accent-cyan` (#00d4ff). Overriding the token locally re-tints
 * everything that resolves through it — the drawer accents AND the Base UI
 * primitives inside (Slider/ToggleGroup paint with `--color-primary` →
 * `accent-cyan`) — to neon cyan, scoped to the map only (those primitives are
 * map-only today). Applied in DARK only: neon cyan (`rgb(0,255,255)`) is great on
 * the dark basemap but illegible on the light theme's pale glass, so light falls
 * back to the theme-tuned readable `accent-cyan`. Magenta accents use the
 * theme-aware `accent-magenta` token (neon `#ff00ff` dark / deeper `#c026d3`
 * light), so they read in both.
 */
const NEON_CHROME = { "--color-accent-cyan": "var(--color-neon-cyan)" } as CSSProperties;
import {
  convertDistance,
  getDistanceLabel,
  formatMetricDisplayValue,
  formatHoursMinutes,
  formatElevation,
  type DistanceUnit,
  type ElevationUnit,
} from "../../utils/units";

const DRAWER_ID = "map-filter-drawer";

export interface MapFilterDrawerProps {
  /** Whether the drawer is expanded. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hide the closed-state toggle even when collapsed — used on mobile while the
   *  other (insights) bottom sheet is open, so the dock pill doesn't float over it. */
  hideToggle?: boolean;
  /** Totals of the currently-filtered activity set (drives the summary). */
  totals: ActivityTotals;
  /** Size of the full dataset, for the "of N" context line. */
  totalCount: number;
  /** Number of active (non-default) filter dimensions; shown as a badge. */
  activeFilterCount: number;
  /** Reset filters to the defaults (current year, all sports/regions). */
  onReset: () => void;
  /** Widen to all activities (full date range, no filters) — the zero-result recourse. */
  onShowAll: () => void;
  distanceUnit: DistanceUnit;
  elevationUnit: ElevationUnit;
  /** Dark theme → apply the vivid neon-cyan chrome override (see NEON_CHROME). */
  isDark: boolean;
  /** Dataset still loading — show a quiet placeholder instead of zeros. */
  isLoading?: boolean;
  /** Dataset failed to load. */
  error?: Error | null;
  /** Pull the latest map data (Strava sync is backend-driven, so no push signal). */
  onRefresh?: () => void;
  /** A refresh is in flight — spins the refresh control. */
  isRefreshing?: boolean;
  /** Ref to the collapsed-state Filters toggle, so a parent (the on-map "Show all"
   *  banner) can return keyboard focus to it after clearing the filters. */
  toggleRef?: RefObject<HTMLButtonElement | null>;
  /** Filter controls / charts / activity list slot in here (later steps). */
  children?: ReactNode;
}

/** Collapse chevron — points left on desktop (panel slides left), down on mobile. */
function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/** Funnel glyph for the Filters toggle (mirrors the Charts toggle's icon). */
function FilterIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

/** Circular-arrows glyph for the refresh control (spins while a refresh is in flight). */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold tabular-nums text-body-text" title={value}>
        {value}
      </div>
      <div className="text-[0.65rem] uppercase tracking-wider text-slate-light">{label}</div>
    </div>
  );
}

/**
 * Non-modal, collapsible map dashboard drawer. Left panel on desktop, bottom
 * sheet on mobile. Deliberately **not** built on the modal `Sheet`/`Dialog`
 * primitive: a modal sets `pointer-events:none` on `<body>` and freezes the
 * Mapbox canvas (see design spec). This panel renders inline in the map
 * container, so the map stays fully interactive alongside it.
 *
 * Step 1 ships the shell + the live cross-filter **summary** (filtered totals
 * react to the filter state in lockstep with the map). Filter controls, charts,
 * and the activity list slot into `children` in later steps.
 */
export default function MapFilterDrawer({
  open,
  onOpenChange,
  hideToggle = false,
  totals,
  totalCount,
  activeFilterCount,
  onReset,
  onShowAll,
  distanceUnit,
  elevationUnit,
  isDark,
  isLoading = false,
  error = null,
  onRefresh,
  isRefreshing = false,
  toggleRef,
  children,
}: MapFilterDrawerProps) {
  const internalToggleRef = useRef<HTMLButtonElement>(null);
  // Use the parent's ref when provided (so it can return focus to this toggle after the
  // on-map "Show all" banner clears the filters); otherwise a private one.
  const toggleButtonRef = toggleRef ?? internalToggleRef;
  const panelRef = useRef<HTMLElement>(null);
  const headingId = useId();
  // Neon-cyan chrome in dark; readable theme default in light (see NEON_CHROME).
  const neonChrome = isDark ? NEON_CHROME : undefined;

  // Esc collapses the drawer. Non-modal: scoped so it ignores key events
  // originating inside an open inner overlay (Popover/Combobox/Select set
  // `aria-expanded` on their trigger / use `[role=listbox]`/`[role=dialog]`),
  // which should dismiss themselves first rather than collapse the whole panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only collapse when focus is within the drawer (or on its toggle) — not when
      // the user is interacting with the map or unrelated page controls.
      const active = document.activeElement;
      const focusInside = panelRef.current?.contains(active) || toggleButtonRef.current === active;
      if (!focusInside) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="listbox"],[role="dialog"],[aria-expanded="true"]')) return;
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange, toggleButtonRef]);

  // This is the APG *disclosure* pattern, not a modal dialog: focus is NOT moved
  // into the panel on open (that would steal focus on the default-open mount and
  // dump keyboard users onto the collapse button). The panel joins the natural tab
  // order via `inert` toggling below. On collapse we only return focus to the
  // toggle if focus was inside the panel, so closing it keeps the user oriented.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) {
      // EXPLICIT open (user toggled closed → open): move focus into the panel so keyboard
      // users land on the revealed content instead of the now-hidden toggle. This does NOT
      // fire on the default-open mount (open was already true → no transition), preserving
      // the APG-disclosure choice not to steal focus on load.
      panelRef.current?.focus();
    } else if (!open && prevOpen.current && panelRef.current?.contains(document.activeElement)) {
      toggleButtonRef.current?.focus();
    }
    prevOpen.current = open;
  }, [open, toggleButtonRef]);

  const distanceLabel = getDistanceLabel(distanceUnit);
  const stats = isLoading
    ? { count: "—", distance: "—", time: "—", elevation: "—" }
    : {
        count: totals.count.toLocaleString(),
        distance: formatMetricDisplayValue(
          convertDistance(totals.distanceMeters, distanceUnit),
          "distance",
          distanceLabel
        ),
        time: formatHoursMinutes(totals.movingTimeSeconds / 3600),
        elevation: formatElevation(totals.elevationMeters, elevationUnit),
      };

  // Three "nothing to total" states, shown kindly in place of the stats grid:
  //   error          — the fetch failed (gentle, not an alarming red alert);
  //   empty dataset  — the user has no geo-bearing routes at all;
  //   zero result    — routes exist but the current filters exclude them all
  //                    (offers "Show all activities" recourse, since the default
  //                    is the current year with no in-panel year picker yet).
  const isEmptyDataset = !isLoading && !error && totalCount === 0;
  const isZeroResult = !isLoading && !error && totalCount > 0 && totals.count === 0;
  const filteredOut = !isLoading && !error && totals.count > 0 && totals.count < totalCount;

  const statusMessage = error
    ? "We couldn't load your activities right now — please try again shortly."
    : isEmptyDataset
      ? "No routes recorded yet. Go ride, run, or walk one!"
      : isZeroResult
        ? "No activities match these filters."
        : null;

  // One plain-text sentence announced to AT as the result changes — sighted users
  // read the grid/message; this gives screen readers the same update politely.
  const liveSummary = isLoading
    ? ""
    : (statusMessage ??
      `${stats.count} ${totals.count === 1 ? "activity" : "activities"}` +
        `${activeFilterCount > 0 ? " filtered" : ""} · ${stats.distance} · ` +
        `${stats.time} · ${stats.elevation}`);
  // Debounced so a slider drag doesn't flood the `aria-live` region with every
  // intermediate readout — announce only once the filtering settles.
  const announcedSummary = useDebouncedValue(liveSummary, 500);

  // Keep keyboard focus in the drawer when a reset control unmounts on activation
  // (activeFilterCount → 0, or zero-result → stats view) — otherwise focus falls to
  // <body>. The panel region is always present + labelled ("Activity filters") while
  // open, so it's a safe, orienting anchor.
  const resetAndKeepFocus = () => {
    onReset();
    panelRef.current?.focus();
  };
  const showAllAndKeepFocus = () => {
    onShowAll();
    panelRef.current?.focus();
  };

  return (
    <>
      {/* Closed-state toggle handle: top-left on desktop; on mobile it sits just left
          of center in the bottom dock (the Insights toggle sits just right).
          Fades/scales out as the panel takes over, so the two never overlap. */}
      <button
        ref={toggleButtonRef}
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        // When open the handle is visually hidden (opacity-0/pointer-events-none) —
        // also drop it from the tab order so keyboard users don't hit a ghost button.
        tabIndex={open || hideToggle ? -1 : undefined}
        style={neonChrome}
        className={cn(
          // Restrained glass chrome with square corners (matches the panel + sits
          // cleanly under the nav header). Deep neon styling is deferred to the
          // separate routes-map-neon-aesthetic-pass task.
          "absolute z-30 inline-flex items-center gap-2 rounded-md border border-border/70",
          "bg-card/85 px-4 py-2 text-sm font-medium text-body-text shadow-lg backdrop-blur-md",
          "transition-all duration-200 ease-out",
          "hover:border-accent-cyan/50 hover:text-accent-cyan focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-accent-cyan/50 motion-reduce:transition-none",
          // Mobile: bottom dock, right edge just left of center. Fixed width (matching
          // the Insights pill) so the two anchor symmetrically around center and the
          // active-filter badge can't shift the pair. Safe-area-aware.
          "bottom-[calc(1rem+env(safe-area-inset-bottom))] right-1/2 mr-1 w-32 justify-center",
          // Desktop: top-left corner, content-width.
          "sm:bottom-auto sm:right-auto sm:left-4 sm:top-4 sm:mr-0 sm:w-auto sm:justify-start",
          open || hideToggle
            ? "pointer-events-none scale-95 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        )}
      >
        <FilterIcon className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-magenta px-1.5 text-xs font-bold text-bg-body">
            {activeFilterCount}
          </span>
        )}
      </button>

      <aside
        ref={panelRef}
        id={DRAWER_ID}
        role="region"
        aria-labelledby={headingId}
        // Programmatically focusable (not in the tab order) so a reset action can park
        // focus on the region instead of dropping it to <body> (see resetAndKeepFocus).
        tabIndex={-1}
        style={neonChrome}
        // `inert` (not `aria-hidden`) when closed: removes the offscreen panel from
        // BOTH the a11y tree and the focus/pointer order in one deterministic step,
        // so the collapsed panel can't trap Tab focus or swallow clicks over the map
        // (aria-hidden alone leaves children focusable — a keyboard dead-end).
        inert={!open}
        className={cn(
          // Glass panel with a soft shadow and square corners (rounded corners read
          // poorly against the nav header). Deep neon styling is deferred to
          // routes-map-neon-aesthetic-pass; this is functional, restrained chrome.
          "absolute z-20 flex flex-col bg-card/85 shadow-xl backdrop-blur-md",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          // Mobile: bottom sheet (safe-area-aware bottom padding for notched devices).
          "inset-x-0 bottom-0 max-h-[70%] border-t border-border/70",
          "pb-[env(safe-area-inset-bottom)]",
          // Desktop: full-height left panel.
          "sm:inset-y-0 sm:bottom-auto sm:right-auto sm:left-0 sm:h-full sm:w-80 sm:max-h-none",
          "sm:border-t-0 sm:border-r sm:border-border/70 sm:pb-0",
          open
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-y-0 sm:-translate-x-[120%]"
        )}
      >
        {/* No dedicated header row — the collapse control shares the summary block's
            top-right (it doesn't conflict with the KPI readout below it), saving the
            row's vertical space. sr-only heading keeps the region's accessible name. */}
        <h2 id={headingId} className="sr-only">
          Activity filters
        </h2>

        {/* Hero summary — the live cross-filter readout. */}
        <div className="relative border-b border-border/60 px-4 py-4">
          {/* Top-right control cluster: refresh (pull the latest after a Strava sync)
              + collapse. 44px touch targets on mobile; compact on desktop where a mouse
              is precise. Lives here (not floating on the map) so it never overlaps the
              open drawer; the status message below uses `pr-24` to clear it. */}
          <div className="absolute right-2 top-2 flex items-center gap-1">
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                // Not disabled while refreshing — invalidation is idempotent, and a
                // disabled button wouldn't announce the label change to AT.
                aria-label={isRefreshing ? "Refreshing map data" : "Refresh map data"}
                className="h-11 w-11 text-slate-light sm:h-7 sm:w-7"
              >
                <RefreshIcon
                  className={cn(
                    "h-4 w-4",
                    isRefreshing && "animate-spin motion-reduce:animate-none"
                  )}
                />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="Collapse panel"
              aria-expanded={open}
              aria-controls={DRAWER_ID}
              className="h-11 w-11 text-slate-light sm:h-7 sm:w-7"
            >
              <CollapseIcon className="h-4 w-4 -rotate-90 sm:rotate-0" />
            </Button>
          </div>
          {/* Screen-reader mirror of the visual stats; announced politely as the
              filtered set changes (the visual grid is aria-hidden to avoid a
              piecemeal, number-by-number readout). */}
          <p className="sr-only" role="status" aria-live="polite">
            {announcedSummary}
          </p>
          {statusMessage ? (
            <>
              {/* Kind, non-alarming message (the sr-only status above announces it).
                  `pr-24` keeps the wrapped text clear of the top-right control cluster
                  (refresh + collapse, 44px each on mobile). */}
              <p aria-hidden="true" className="pr-24 text-sm text-slate-light">
                {statusMessage}
              </p>
              {/* Recourse for a filtered-to-zero set: widen to everything. The default
                  is the current year and there's no in-panel year picker yet, so
                  this is the only way out of an empty current year. */}
              {isZeroResult && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={showAllAndKeepFocus}>
                    Show all activities
                  </Button>
                  {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={resetAndKeepFocus}>
                      Reset to this year
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Visual stats only (aria-hidden — the sr-only status above is the
                  announced equivalent). Interactive controls stay OUTSIDE this. */}
              <div aria-hidden="true">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums text-accent-cyan">
                    {stats.count}
                  </span>
                  <span className="text-sm text-slate-light">
                    {totals.count === 1 && !isLoading ? "activity" : "activities"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-light">
                  {isLoading
                    ? "Loading your routes…"
                    : filteredOut
                      ? `of ${totalCount.toLocaleString()} · filtered`
                      : activeFilterCount > 0
                        ? "filtered"
                        : "this year"}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <Stat label="Distance" value={stats.distance} />
                  <Stat label="Time" value={stats.time} />
                  <Stat label="Elevation" value={stats.elevation} />
                </div>
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="link"
                  onClick={resetAndKeepFocus}
                  className="mt-3 h-auto p-0 text-xs text-accent-cyan"
                >
                  Reset filters
                </Button>
              )}
            </>
          )}
        </div>

        {/* Filter controls, charts, and the activity list mount here (later steps).
            `overscroll-contain` stops scroll-chaining into the map/page behind it. */}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    </>
  );
}
