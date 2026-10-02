/**
 * RouteChartTooltip - The routes page charts' tooltip, in the shared ChartTooltipFrame: the
 * hovered week, bin or day as the title, and its one value under it.
 */
import type { ReactNode } from "react";
import ChartTooltipFrame from "../charts/ChartTooltipFrame";

export interface RouteChartTooltipProps {
  /** Set by Recharts: whether a point is hovered, its x value, and its series' values. */
  active?: boolean;
  label?: ReactNode;
  payload?: readonly { value?: unknown }[];
  /** The hovered x value as the title, e.g. "Week of Sep 1, 2026". */
  formatLabel: (label: ReactNode) => string;
  /** The series' name, e.g. "Volume". */
  name: string;
  /** The hovered value with its unit, e.g. "42 mi". */
  formatValue: (value: number) => string;
}

export default function RouteChartTooltip({
  active,
  label,
  payload,
  formatLabel,
  name,
  formatValue,
}: RouteChartTooltipProps) {
  const value = payload?.[0]?.value;
  if (!active || value == null) return null;

  return (
    <ChartTooltipFrame title={formatLabel(label)}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
        <span style={{ color: "var(--color-chart-tooltip-label)" }}>{name}</span>
        <span
          className="tabular-nums"
          style={{ color: "var(--color-chart-tooltip-text)", fontWeight: 500, marginLeft: "auto" }}
        >
          {formatValue(Number(value))}
        </span>
      </div>
    </ChartTooltipFrame>
  );
}
