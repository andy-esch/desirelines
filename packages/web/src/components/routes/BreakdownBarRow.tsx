import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A row's bar width as a percent of the largest row, floored at 2% so a small row stays visible. */
export function breakdownBarPct(value: number, max: number): number {
  return max > 0 ? Math.max(2, (value / max) * 100) : 0;
}

export interface BreakdownBarRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Bar width, from `breakdownBarPct`. */
  pct: number;
  isSelected: boolean;
  /** Fade the row because something else is selected. */
  dimmed: boolean;
  onClick: () => void;
  /** The row's own bar color (a sport's identity color). Without one the bar is accent cyan. */
  barColor?: string;
}

/** One clickable proportional-bar row in a routes-map breakdown list. */
export function BreakdownBarRow({
  label,
  value,
  pct,
  isSelected,
  dimmed,
  onClick,
  barColor,
}: BreakdownBarRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        style={barColor === undefined ? undefined : ({ "--bar": barColor } as CSSProperties)}
        className={cn(
          "group block w-full rounded-md px-1.5 py-1 text-left transition-opacity",
          "hover:bg-accent",
          dimmed && "opacity-40 hover:opacity-100"
        )}
      >
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-body-text">{label}</span>
          <span className="shrink-0 tabular-nums text-muted-text">{value}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={
              barColor === undefined
                ? "h-full rounded-full bg-accent-cyan"
                : "sport-mark h-full rounded-full bg-[var(--bar)]"
            }
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
    </li>
  );
}
