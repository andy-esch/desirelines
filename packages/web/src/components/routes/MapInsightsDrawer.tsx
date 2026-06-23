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

/**
 * Right-hand **insights** drawer — cross-filtered charts. Auto-hidden by default
 * with a small toggle handle on the right edge; non-modal (renders inline over the
 * map, which stays interactive). Mirrors the left filter drawer's a11y: `inert`
 * when closed, Esc-to-collapse (focus-scoped), return-focus-to-toggle on close.
 */
export default function MapInsightsDrawer({
  open,
  onOpenChange,
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
      {/* Closed-state toggle: a compact `‹` in the upper-right corner (no label —
          the chevron + position imply "open the right-hand panel"). */}
      <button
        ref={toggleButtonRef}
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        aria-label="Show insights"
        tabIndex={open ? -1 : undefined}
        style={neonChrome}
        className={cn(
          "absolute right-2 top-2 z-30 inline-flex h-8 w-8 items-center justify-center rounded-md",
          "border border-border/70 bg-card/85 text-slate-light shadow-lg backdrop-blur-md",
          "transition-all duration-200 ease-out hover:border-accent-cyan/50 hover:text-accent-cyan",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50",
          "motion-reduce:transition-none",
          open ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
        )}
      >
        <Chevron className="h-4 w-4" />
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
          "absolute inset-y-0 right-0 z-20 flex w-80 max-w-[85%] flex-col bg-card/85 shadow-xl backdrop-blur-md",
          "border-l border-border/70 transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "translate-x-[110%]"
        )}
      >
        {/* sr-only title for the region's accessible name; the `›` collapse control
            sits in the upper-right, mirroring the closed-state `‹` position. A
            borderless top bar (no `border-b`) so there's no stray hline above the
            first chart's header. */}
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
            className="h-7 w-7 text-slate-light"
          >
            <Chevron className="h-4 w-4 rotate-180" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    </>
  );
}
