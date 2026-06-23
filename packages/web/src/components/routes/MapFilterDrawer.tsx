import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import type { ActivityTotals } from "../../utils/routeFilters";
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
  /** Totals of the currently-filtered activity set (drives the summary). */
  totals: ActivityTotals;
  /** Size of the full dataset, for the "of N" context line. */
  totalCount: number;
  /** Number of active (non-default) filter dimensions; shown as a badge. */
  activeFilterCount: number;
  onReset: () => void;
  distanceUnit: DistanceUnit;
  elevationUnit: ElevationUnit;
  /** Dataset still loading — show a quiet placeholder instead of zeros. */
  isLoading?: boolean;
  /** Dataset failed to load. */
  error?: Error | null;
  /** Filter controls / charts / activity list slot in here (later steps). */
  children?: ReactNode;
}

/** Sliders icon for the closed-state toggle handle. */
function FiltersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="9" cy="8" r="2.5" fill="var(--color-card)" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="15" cy="16" r="2.5" fill="var(--color-card)" />
    </svg>
  );
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
  totals,
  totalCount,
  activeFilterCount,
  onReset,
  distanceUnit,
  elevationUnit,
  isLoading = false,
  error = null,
  children,
}: MapFilterDrawerProps) {
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  // Esc collapses the drawer. Non-modal: scoped so it ignores key events
  // originating inside an open inner overlay (Popover/Combobox/Select set
  // `aria-expanded` on their trigger / use `[role=listbox]`/`[role=dialog]`),
  // which should dismiss themselves first rather than collapse the whole panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="listbox"],[role="dialog"],[aria-expanded="true"]')) return;
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // This is the APG *disclosure* pattern, not a modal dialog: focus is NOT moved
  // into the panel on open (that would steal focus on the default-open mount and
  // dump keyboard users onto the collapse button). The panel joins the natural tab
  // order via `inert` toggling below. On collapse we only return focus to the
  // toggle if focus was inside the panel, so closing it keeps the user oriented.
  const panelRef = useRef<HTMLElement>(null);
  const prevOpen = useRef(open);
  useEffect(() => {
    if (!open && prevOpen.current && panelRef.current?.contains(document.activeElement)) {
      toggleButtonRef.current?.focus();
    }
    prevOpen.current = open;
  }, [open]);

  const distanceLabel = getDistanceLabel(distanceUnit);
  const summary = isLoading
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
  const filteredOut = !isLoading && totalCount > 0 && totals.count < totalCount;
  // One plain-text sentence announced to AT as the cross-filter result changes —
  // sighted users read the grid below; this gives screen readers the same update.
  const liveSummary =
    isLoading || error
      ? ""
      : `${summary.count} ${totals.count === 1 ? "activity" : "activities"}` +
        `${activeFilterCount > 0 ? " filtered" : ""} · ${summary.distance} · ` +
        `${summary.time} · ${summary.elevation}`;

  return (
    <>
      {/* Closed-state toggle handle: top-left on desktop, bottom-center on mobile.
          Fades/scales out as the panel takes over, so the two never overlap. */}
      <button
        ref={toggleButtonRef}
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        className={cn(
          // Restrained polish — glass + a subtle accent border. The full neon glow
          // treatment is the separate routes-map-neon-aesthetic-pass task; don't
          // pre-empt it here (keep heavy glow for active/selected states later).
          "absolute z-30 inline-flex items-center gap-2 rounded-full border border-border/70",
          "bg-card/85 px-4 py-2 text-sm font-medium text-body-text shadow-lg backdrop-blur-md",
          "transition-all duration-200 ease-out",
          "hover:border-accent-cyan/50 hover:text-accent-cyan focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-accent-cyan/50 motion-reduce:transition-none",
          "bottom-4 left-1/2 -translate-x-1/2 sm:bottom-auto sm:left-4 sm:top-4 sm:translate-x-0",
          open
            ? "pointer-events-none scale-95 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        )}
      >
        <FiltersIcon className="h-4 w-4 text-accent-cyan" />
        Explore
        {activeFilterCount > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-cyan px-1.5 text-[0.7rem] font-bold text-bg-body">
            {activeFilterCount}
          </span>
        )}
      </button>

      <aside
        ref={panelRef}
        id={DRAWER_ID}
        role="region"
        aria-labelledby={headingId}
        // `inert` (not `aria-hidden`) when closed: removes the offscreen panel from
        // BOTH the a11y tree and the focus/pointer order in one deterministic step,
        // so the collapsed panel can't trap Tab focus or swallow clicks over the map
        // (aria-hidden alone leaves children focusable — a keyboard dead-end).
        inert={!open}
        className={cn(
          // Glass panel with a soft shadow — the deep neon styling is deferred to
          // routes-map-neon-aesthetic-pass; this is functional, restrained chrome.
          "absolute z-20 flex flex-col bg-card/85 shadow-xl backdrop-blur-md",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          // Mobile: bottom sheet (safe-area-aware bottom padding for notched devices).
          "inset-x-0 bottom-0 max-h-[70%] rounded-t-2xl border-t border-border/70",
          "pb-[env(safe-area-inset-bottom)]",
          // Desktop: full-height left panel.
          "sm:inset-y-0 sm:bottom-auto sm:right-auto sm:left-0 sm:h-full sm:w-80 sm:max-h-none",
          "sm:rounded-none sm:rounded-r-2xl sm:border-t-0 sm:border-r sm:border-border/70 sm:pb-0",
          open
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-y-0 sm:-translate-x-[120%]"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <FiltersIcon className="h-4 w-4 text-accent-cyan" />
            <h2
              id={headingId}
              className="text-sm font-semibold uppercase tracking-wider text-body-text"
            >
              Explore
            </h2>
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-cyan/15 px-1.5 text-xs font-bold text-accent-cyan">
                {activeFilterCount}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Collapse panel"
            className="h-8 w-8 text-slate-light"
          >
            <CollapseIcon className="h-4 w-4 -rotate-90 sm:rotate-0" />
          </Button>
        </div>

        {/* Hero summary — the live cross-filter readout. */}
        <div className="border-b border-border/60 px-4 py-4">
          {/* Screen-reader mirror of the visual stats; announced politely as the
              filtered set changes (the visual grid is aria-hidden to avoid a
              piecemeal, number-by-number readout). */}
          <p className="sr-only" role="status" aria-live="polite">
            {liveSummary}
          </p>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              Couldn't load activity data.
            </p>
          ) : (
            <>
              {/* Visual stats only (aria-hidden — the sr-only status above is the
                  announced equivalent). Interactive controls stay OUTSIDE this. */}
              <div aria-hidden="true">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums text-accent-cyan">
                    {summary.count}
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
                  <Stat label="Distance" value={summary.distance} />
                  <Stat label="Time" value={summary.time} />
                  <Stat label="Elevation" value={summary.elevation} />
                </div>
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="link"
                  onClick={onReset}
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
