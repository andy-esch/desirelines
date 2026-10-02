import { useThemeDateFormat } from "../theme/useThemeDateFormat";
import { MissingValue } from "../theme/MissingValue";
import ChartTooltipFrame from "./ChartTooltipFrame";

export interface ChartTooltipProps {
  /** Whether the tooltip is active (hovered) */
  active?: boolean;
  /** Payload data from Recharts */
  payload?: readonly {
    name?: string;
    value?: number | string;
    stroke?: string;
    color?: string;
    dataKey?: string;
  }[];
  /** X-axis value: the point's date (a UTC-midnight Date or timestamp), or a date string */
  label?: string | number | Date;
  /** Unit to display after values (e.g., "mi", "mi/day") */
  unit?: string;
  /** Number of decimal places for value formatting */
  decimals?: number;
  /** Compact mode - show only actual, its delta to the nearest goal, and prior years */
  compact?: boolean;
  /**
   * Each goal's own label, by goal index, for the compact delta ("−12.0 vs Target"). The
   * lines' names, which the rows show, carry the goal's total as well.
   */
  goalLabels?: readonly string[];
}

/** The goal index a data key names (`goal0`, `goal1`…), if it names a goal. */
function goalIndexOf(dataKey: string | undefined): number | undefined {
  const match = /^goal(\d+)$/.exec(dataKey ?? "");
  return match ? Number(match[1]) : undefined;
}

/** The year a data key names (`prior_2025`), if it names a prior year. */
function priorYearOf(dataKey: string | undefined): number | undefined {
  const match = /^prior_(\d+)$/.exec(dataKey ?? "");
  return match ? Number(match[1]) : undefined;
}

/**
 * The cumulative and pacing charts' tooltip, in the shared ChartTooltipFrame.
 *
 * Displays the formatted date and data values, with customizable units and decimal
 * precision. Entries are told apart by their data keys (see chartLines.ts), never by their
 * names, which are the legend's and can be anything a goal is called.
 *
 * @example
 * // Distance chart (1 decimal, "mi" unit)
 * <Tooltip content={<ChartTooltip unit="mi" decimals={1} />} />
 *
 * @example
 * // Pacing chart (2 decimals, "mi/day" unit)
 * <Tooltip content={<ChartTooltip unit="mi/day" decimals={2} />} />
 */
export const ChartTooltip = ({
  active,
  payload,
  label,
  unit = "mi",
  decimals = 1,
  compact = false,
  goalLabels = [],
}: ChartTooltipProps) => {
  const { formatAxisDate } = useThemeDateFormat();
  if (!active || !payload || payload.length === 0) return null;

  // Recharts hands over the point's `date` as the data holds it, a Date in the chart hooks.
  const formattedDate =
    label instanceof Date
      ? formatAxisDate(label.getTime())
      : typeof label === "number"
        ? formatAxisDate(label)
        : String(label ?? "");

  const actualEntry = payload.find((p) => p.dataKey === "actual");
  const hasActualData = actualEntry !== undefined && typeof actualEntry.value === "number";
  const actualValue = hasActualData ? (actualEntry.value as number) : 0;

  // Prior years with a value at this date, the most recent first (2025, 2024, 2023…)
  const priorYearEntries = payload
    .filter(
      (p): p is typeof p & { value: number } =>
        priorYearOf(p.dataKey) !== undefined && typeof p.value === "number"
    )
    .sort((a, b) => priorYearOf(b.dataKey)! - priorYearOf(a.dataKey)!);

  // The next goal not yet reached, or the last goal once all are; in goal order
  const goalEntries = payload.filter((p) => goalIndexOf(p.dataKey) !== undefined);
  const targetGoal =
    goalEntries.find((g) => typeof g.value === "number" && g.value > actualValue) ??
    goalEntries.at(-1);

  const targetValue = typeof targetGoal?.value === "number" ? targetGoal.value : 0;
  const delta = actualValue - targetValue;
  const deltaAbs = Math.abs(delta);
  const isAhead = delta > 0;
  const targetIndex = goalIndexOf(targetGoal?.dataKey);
  const goalLabel = (targetIndex !== undefined && goalLabels[targetIndex]) || "Goal";

  if (compact) {
    // Compact mode: actual + delta vs nearest goal, when there is one, plus prior year values.
    // The delta takes the goal's color, to tie it to the goal's line.
    const goalColor = targetGoal?.stroke || targetGoal?.color || "var(--color-chart-neutral)";

    return (
      <ChartTooltipFrame title={formattedDate} tone="caption" minWidth={140}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span
            style={{
              color: "var(--color-chart-tooltip-text)",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            {hasActualData ? `${actualValue.toFixed(decimals)} ${unit}` : <MissingValue />}
          </span>
          {hasActualData && targetGoal && (
            <span
              style={{
                color: goalColor,
                fontSize: "11px",
              }}
            >
              {isAhead ? "+" : "−"}
              {deltaAbs.toFixed(decimals)} vs {goalLabel}
            </span>
          )}
        </div>
        {priorYearEntries.length > 0 && (
          <div
            style={{
              marginTop: "4px",
              paddingTop: "4px",
              borderTop: "1px solid var(--color-chart-tooltip-divider)",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            {/* The years take the label color, not their lines': a ghost line's stroke is
                as little as 9% opaque, too faint to read as text. */}
            {priorYearEntries.map((entry, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "11px",
                }}
              >
                <span style={{ color: "var(--color-chart-tooltip-label)" }}>{entry.name}</span>
                <span style={{ color: "var(--color-chart-tooltip-muted)" }}>
                  {entry.value.toFixed(decimals)} {unit}
                </span>
              </div>
            ))}
          </div>
        )}
      </ChartTooltipFrame>
    );
  }

  // Full mode: every line's value under the date
  return (
    <ChartTooltipFrame title={formattedDate}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {payload.map((entry, index) => {
          const color = entry.stroke || entry.color || "var(--color-chart-neutral)";
          const value =
            typeof entry.value === "number" ? entry.value.toFixed(decimals) : (entry.value ?? "");

          return (
            <div
              key={index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "min(var(--radius), 2px)",
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "var(--color-chart-tooltip-label)" }}>
                {entry.name ?? entry.dataKey}
              </span>
              <span
                style={{
                  color: "var(--color-chart-tooltip-text)",
                  fontWeight: "500",
                  // Clear of a goal's name, which ends in its total ("Target 4,000").
                  marginLeft: "auto",
                  paddingLeft: "16px",
                }}
              >
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </ChartTooltipFrame>
  );
};

export default ChartTooltip;
