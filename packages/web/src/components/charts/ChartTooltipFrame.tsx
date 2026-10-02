/**
 * ChartTooltipFrame - The box every chart tooltip draws in: the tooltip surface, border,
 * corner and shadow, the chart font, a title over the rows, and an optional total under them.
 * Each tooltip brings only its rows.
 *
 * The theme's `tooltipHeader` structure places the title. `inline` sets it over the rows in
 * the tone the tooltip asks for: a `heading` ruled off from them, or a muted `caption`. `bar`
 * draws it as a bar across the top in the tooltip accent, ruled off in the same color, and
 * gives the total the same tracked, labelled look. Either way the total's value takes the
 * accent, which a theme without a bar sets to the tooltip text.
 */
import type { CSSProperties, ReactNode } from "react";
import { useThemeStructure } from "../theme/useThemeStructure";

export type TooltipTitleTone = "heading" | "caption";

export interface ChartTooltipFrameProps {
  /** What the tooltip describes: a date, a month, a week or a bin. */
  title: ReactNode;
  /** How an inline title reads; a theme's header bar replaces either. */
  tone?: TooltipTitleTone;
  /** A last row summing the ones above it. */
  total?: { label: string; value: ReactNode } | undefined;
  minWidth?: number;
  children: ReactNode;
}

const DIVIDER = "1px solid var(--color-chart-tooltip-divider)";
const LABEL_CASE = "var(--label-case)" as CSSProperties["textTransform"];

const INLINE_TITLE: Record<TooltipTitleTone, CSSProperties> = {
  heading: {
    fontWeight: 700,
    color: "var(--color-chart-tooltip-text)",
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: DIVIDER,
  },
  caption: { fontWeight: 500, color: "var(--color-chart-tooltip-muted)", marginBottom: 4 },
};

const BAR_TITLE: CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid var(--color-chart-tooltip-accent)",
  color: "var(--color-chart-tooltip-accent)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: LABEL_CASE,
};

export default function ChartTooltipFrame({
  title,
  tone = "heading",
  total,
  minWidth,
  children,
}: ChartTooltipFrameProps) {
  const bar = useThemeStructure().tooltipHeader === "bar";

  return (
    <div
      style={{
        backgroundColor: "var(--color-chart-tooltip-bg)",
        border: "1px solid var(--color-chart-tooltip-border)",
        borderRadius: "var(--tooltip-radius)",
        boxShadow: "var(--tooltip-shadow)",
        fontFamily: "var(--font-chart)",
        fontSize: 12,
        minWidth,
        padding: bar ? undefined : "10px 12px",
      }}
    >
      <div style={bar ? BAR_TITLE : INLINE_TITLE[tone]}>{title}</div>
      <div style={bar ? { padding: "8px 10px" } : undefined}>
        {children}
        {total && (
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: DIVIDER,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              ...(bar
                ? { letterSpacing: "0.12em" }
                : { fontWeight: 600, color: "var(--color-chart-tooltip-text)" }),
            }}
          >
            <span
              style={
                bar
                  ? {
                      color: "var(--color-chart-tooltip-label)",
                      textTransform: LABEL_CASE,
                    }
                  : undefined
              }
            >
              {total.label}
            </span>
            <span className="tabular-nums" style={{ color: "var(--color-chart-tooltip-accent)" }}>
              {total.value}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
