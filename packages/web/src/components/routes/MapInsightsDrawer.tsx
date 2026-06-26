import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

const DRAWER_ID = "map-insights-drawer";

/** Map chrome uses the vivid neon cyan in dark; see MapFilterDrawer's NEON_CHROME. */
const NEON_CHROME = { "--color-accent-cyan": "var(--color-neon-cyan)" } as CSSProperties;

export interface MapInsightsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDark: boolean;
  /** Hide the closed-state toggle even when collapsed — used on mobile while the
   *  other (filter) bottom sheet is open, so the dock pill doesn't float over it. */
  hideToggle?: boolean;
  /** Charts slot in here. */
  children?: ReactNode;
}

/** Chevron — points left (open from the right edge) / right (collapse). */
function Chevron({ className }: { className?: string }) {
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

/** Bar-chart glyph for the "Insights" toggle (the panel holds the charts). */
function InsightsIcon({ className }: { className?: string }) {
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
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="10" />
    </svg>
  );
}

/**
 * **Insights** drawer — cross-filtered charts. Auto-hidden by default behind a
 * toggle: a labeled "Insights" pill in the bottom dock on mobile (beside Filters),
 * a compact icon button in the top-right corner on desktop. The panel is a bottom
 * sheet on mobile and a right-hand side panel on desktop (mirrors the filter
 * drawer). Non-modal (renders inline over the still-interactive map). Same a11y as
 * the filter drawer: `inert` when closed, Esc-to-collapse (focus-scoped),
 * return-focus-to-toggle on close.
 */
export default function MapInsightsDrawer({
  open,
  onOpenChange,
  hideToggle = false,
  isDark,
  children,
}: MapInsightsDrawerProps) {
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const neonChrome = isDark ? NEON_CHROME : undefined;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      if (!(panelRef.current?.contains(active) || toggleButtonRef.current === active)) return;
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Unlike the left filter drawer (open-on-mount, so it must NOT steal focus), this
  // panel is closed by default and opened by an explicit click — and the toggle
  // becomes hidden (opacity-0/pointer-events-none) once open. So on a user-initiated
  // open we move focus into the panel (else focus is stranded on a hidden button);
  // on collapse we return it to the toggle if focus was inside.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) {
      panelRef.current?.focus();
    } else if (!open && prevOpen.current && panelRef.current?.contains(document.activeElement)) {
      toggleButtonRef.current?.focus();
    }
    prevOpen.current = open;
  }, [open]);

  return (
    <>
      {/* Closed-state toggle. Mobile: a labeled "Insights" pill in the bottom dock,
          just right of center (the Filters toggle sits just left). Desktop: a compact
          icon button in the upper-right corner. */}
      <button
        ref={toggleButtonRef}
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        tabIndex={open || hideToggle ? -1 : undefined}
        style={neonChrome}
        className={cn(
          "absolute z-30 inline-flex items-center justify-center rounded-md border border-border/70",
          "bg-card/85 text-body-text shadow-lg backdrop-blur-md",
          "transition-all duration-200 ease-out hover:border-accent-cyan/50 hover:text-accent-cyan",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50",
          "motion-reduce:transition-none",
          // Mobile: bottom-dock pill, left edge just right of center. Fixed width
          // (matching the Filters pill) so the two anchor symmetrically around center.
          // Safe-area-aware.
          "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 ml-1 w-32 gap-2 px-4 py-2 text-sm font-medium",
          // Desktop: compact icon button, top-right corner (sm:w-8 overrides the w-32).
          "sm:bottom-auto sm:left-auto sm:right-2 sm:top-2 sm:ml-0 sm:h-8 sm:w-8 sm:gap-0 sm:px-0 sm:py-0",
          open || hideToggle ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
        )}
      >
        <InsightsIcon className="h-4 w-4" />
        {/* Visible label on mobile; sr-only on desktop (icon-only) so the accessible
            name is "Insights" in both — matches the visible text (no aria-label). */}
        <span className="sm:sr-only">Insights</span>
      </button>

      <aside
        ref={panelRef}
        id={DRAWER_ID}
        role="region"
        aria-labelledby={headingId}
        tabIndex={-1}
        inert={!open}
        style={neonChrome}
        className={cn(
          "absolute z-20 flex flex-col bg-card/85 shadow-xl backdrop-blur-md",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          // Mobile: bottom sheet (safe-area-aware), mirroring the filter drawer.
          "inset-x-0 bottom-0 max-h-[70%] border-t border-border/70 pb-[env(safe-area-inset-bottom)]",
          // Desktop: full-height right panel.
          "sm:inset-y-0 sm:bottom-auto sm:left-auto sm:right-0 sm:h-full sm:w-80 sm:max-h-none sm:max-w-[85%]",
          "sm:border-t-0 sm:border-l sm:pb-0",
          open
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-y-0 sm:translate-x-[110%]"
        )}
      >
        {/* sr-only title for the region's accessible name; the collapse control sits
            top-right of the sheet/panel. A borderless top bar (no `border-b`) so
            there's no stray hline above the first chart's header. */}
        <h2 id={headingId} className="sr-only">
          Insights
        </h2>
        <div className="flex justify-end px-2 pt-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Collapse insights"
            aria-expanded={open}
            aria-controls={DRAWER_ID}
            // 44px touch target on mobile (the sheet's main dismiss control); compact
            // on desktop where a mouse is precise.
            className="h-11 w-11 text-slate-light sm:h-7 sm:w-7"
          >
            {/* Down on mobile (collapses the bottom sheet) / right on desktop. */}
            <Chevron className="h-4 w-4 -rotate-90 sm:rotate-180" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    </>
  );
}
