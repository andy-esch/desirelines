import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL_ACCENT_BORDER, type PanelAccent } from "./Panel";
import { useThemeStructure } from "./useThemeStructure";

/** How the surrounding `StatRow` frames each stat; a stat outside a row frames itself. */
type StatFrame = "card" | "cell" | "box";

const StatFrameContext = createContext<StatFrame>("card");

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Unit set smaller after the value, e.g. `mi`. */
  unit?: ReactNode | undefined;
  /** One line of context under the value. */
  sub?: ReactNode | undefined;
  /** Frame accent when the theme boxes each stat. */
  accent?: PanelAccent | undefined;
  /** Frames this stat as the emphasized one, when the theme boxes stats. */
  emphasis?: boolean | undefined;
  className?: string | undefined;
}

/** A labeled big number. Type and glow come from the `--stat-*` and display slots. */
export function Stat({
  label,
  value,
  unit,
  sub,
  accent = 1,
  emphasis = false,
  className,
}: StatProps) {
  const frame = useContext(StatFrameContext);
  return (
    <div
      data-frame={frame}
      className={cn(
        "flex flex-col gap-1 min-w-0",
        frame === "card" &&
          "h-full p-3 md:p-4 border-solid border-(length:--panel-border-width) border-panel-border rounded-(--panel-radius) bg-(--panel-bg) transition-colors hover:border-panel-border-hover",
        frame === "cell" && "p-4 md:px-5",
        frame === "box" &&
          cn(
            "p-4 border-solid border-(length:--panel-border-width) rounded-(--panel-radius) bg-(--panel-bg)",
            PANEL_ACCENT_BORDER[accent],
            emphasis
              ? "[box-shadow:var(--panel-shadow-emphasis)]"
              : "[box-shadow:var(--panel-shadow)]"
          ),
        className
      )}
    >
      <span className="text-(length:--stat-label-size) tracking-(--stat-label-tracking) [text-transform:var(--stat-label-case)] text-(color:--color-muted-text)">
        {label}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 min-w-0 font-(family-name:--font-display) font-(weight:--display-weight) text-(length:--stat-value-size) md:text-(length:--stat-value-size-wide) leading-[1.2] tabular-nums [text-shadow:var(--stat-value-shadow)]">
        {value}
        {unit != null && <span className="text-[0.45em]">{unit}</span>}
      </span>
      {sub != null && (
        <span className="text-(length:--stat-sub-size) text-(color:--stat-sub-color)">{sub}</span>
      )}
    </div>
  );
}

/**
 * A row of stats, framed per the theme's `statRowStyle`: separate cards, one panel split
 * into cells, or separate outline boxes.
 */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  const { statRowStyle } = useThemeStructure();

  if (statRowStyle === "divided") {
    return (
      <StatFrameContext.Provider value="cell">
        <div
          data-style="divided"
          className={cn(
            "grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-divider border-solid border-(length:--panel-border-width) border-(color:--panel-accent-1) rounded-(--panel-radius) bg-(--panel-bg) [box-shadow:var(--panel-shadow)]",
            className
          )}
        >
          {children}
        </div>
      </StatFrameContext.Provider>
    );
  }

  return (
    <StatFrameContext.Provider value={statRowStyle === "boxed" ? "box" : "card"}>
      <div
        data-style={statRowStyle}
        className={cn(
          // Two across on small screens: a lone third stat takes the full row.
          "grid grid-cols-2 md:grid-cols-3 [&>:nth-child(3):last-child]:col-span-2 md:[&>:nth-child(3):last-child]:col-span-1",
          statRowStyle === "boxed" ? "gap-5" : "gap-3 md:gap-4",
          className
        )}
      >
        {children}
      </div>
    </StatFrameContext.Provider>
  );
}
