import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./useThemeStructure";

export type GoalStatus =
  | "achieved"
  | "ahead"
  | "on-track"
  | "slightly-behind"
  | "behind"
  | "far-behind"
  | "not-met"
  | "no-activity";

type Tone = "good" | "warn" | "bad" | "none";

const TONE: Record<GoalStatus, Tone> = {
  achieved: "good",
  ahead: "good",
  "on-track": "good",
  "slightly-behind": "warn",
  behind: "bad",
  "far-behind": "bad",
  "not-met": "bad",
  "no-activity": "none",
};

const TONE_COLOR: Record<Tone, string> = {
  good: "text-(color:--color-status-good)",
  warn: "text-(color:--color-status-warn)",
  bad: "text-(color:--color-status-bad)",
  none: "text-(color:--color-muted-text)",
};

/**
 * Inline SVG rather than text glyphs: IBM Plex Mono's Latin subset lacks ▲ ▼ ✔, and some of
 * them render as color emoji on iOS.
 */
function Glyph({ status, outlined }: { status: GoalStatus; outlined: boolean }) {
  const paint = outlined
    ? { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" as const }
    : { fill: "currentColor" };
  if (status === "no-activity") return null;
  if (status === "achieved") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
        <path
          d="M1.5 5.3 L4 7.8 L8.6 2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="square"
        />
      </svg>
    );
  }
  const up = TONE[status] === "good";
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
      <path d={up ? "M5 1.2 L9 8.4 L1 8.4 Z" : "M1 1.6 L9 1.6 L5 8.8 Z"} {...paint} />
    </svg>
  );
}

export interface StatusSymbolProps {
  status: GoalStatus;
  /** The status in words; always shown, so color is never the only cue. */
  label: ReactNode;
  /**
   * Badge fill for themes that render statuses as badges (e.g. the goal's own color). Only
   * used when the theme's `statusSymbolStyle` is `badge`.
   */
  badgeStyle?: CSSProperties | undefined;
  className?: string | undefined;
}

/**
 * A goal status as a symbol plus text, or as a colored badge where the theme keeps badges.
 * Symbol color follows the status tone through the `--color-status-*` tokens.
 */
export function StatusSymbol({ status, label, badgeStyle, className }: StatusSymbolProps) {
  const { statusSymbolStyle } = useThemeStructure();

  if (statusSymbolStyle === "badge") {
    return (
      <span className={cn("badge", className)} style={badgeStyle} data-status={status}>
        {label}
      </span>
    );
  }

  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap text-(length:--status-size) tracking-(--status-tracking) [text-transform:var(--status-case)]",
        TONE_COLOR[TONE[status]],
        className
      )}
    >
      <Glyph status={status} outlined={statusSymbolStyle === "outlined"} />
      {label}
    </span>
  );
}
