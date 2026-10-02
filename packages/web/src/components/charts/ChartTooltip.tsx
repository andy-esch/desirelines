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
  /** Compact mode - show only actual + nearest goal with delta */
  compact?: boolean;
}

/**
 * The cumulative and pacing charts' tooltip, in the shared ChartTooltipFrame.
 *
 * Displays the formatted date and data values, with customizable units and decimal
 * precision.
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

  // Find actual value and goal values from payload
  const actualEntry = payload.find((p) => p.dataKey === "actual" || p.name?.includes("Data"));
  const hasActualData = actualEntry !== undefined && typeof actualEntry.value === "number";
  const actualValue = hasActualData ? (actualEntry.value as number) : 0;

  // Find prior year entries (only those with a numeric value at this date),
  // sorted most recent year first (e.g. 2025, 2024, 2023…)
  const priorYearEntries = payload
    .filter(
      (p): p is typeof p & { value: number } =>
        p.dataKey?.startsWith("prior_") === true && typeof p.value === "number"
    )
    .sort((a, b) => {
      const yearA = Number(a.dataKey?.replace("prior_", "") ?? 0);
      const yearB = Number(b.dataKey?.replace("prior_", "") ?? 0);
      return yearB - yearA;
    });

  // Find goal entries (exclude actual, average, and prior year lines)
  const goalEntries = payload.filter(
    (p) =>
      !p.dataKey?.startsWith("prior_") &&
      (p.dataKey?.startsWith("goal") ||
        (p.name && !p.name.includes("Data") && !p.name.includes("Average")))
  );

  // Find the next unachieved goal (smallest goal value > actual) or closest goal
  let targetGoal = goalEntries.find((g) => {
    const goalVal = typeof g.value === "number" ? g.value : 0;
    return goalVal > actualValue;
  });
  // If all goals achieved, show the highest one
  if (!targetGoal && goalEntries.length > 0) {
    targetGoal = goalEntries[goalEntries.length - 1];
  }

  const targetValue = typeof targetGoal?.value === "number" ? targetGoal.value : 0;
  const delta = actualValue - targetValue;
  const deltaAbs = Math.abs(delta);
  const isAhead = delta > 0;

  // Extract goal label (remove the ": X miles" part)
  const goalLabel = targetGoal?.name?.split(":")[0] || "Goal";

  if (compact && targetGoal) {
    // Compact mode: actual + delta vs nearest goal, plus prior year values
    // Use goal's color for the delta to create visual connection
    const goalColor = targetGoal.stroke || targetGoal.color || "var(--color-chart-neutral)";

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
          {hasActualData && (
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
        {payload.map(
          (
            entry: {
              readonly stroke?: string;
              readonly color?: string;
              readonly value?: number | string;
              readonly name?: string;
              readonly dataKey?: string;
            },
            index: number
          ) => {
            const color = entry.stroke || entry.color || "var(--color-chart-neutral)";
            const value =
              typeof entry.value === "number" ? entry.value.toFixed(decimals) : (entry.value ?? "");
            // Shorten the label
            const shortName = entry.name?.split(":")[0] || entry.dataKey || "";

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
                <span style={{ color: "var(--color-chart-tooltip-label)" }}>{shortName}</span>
                <span
                  style={{
                    color: "var(--color-chart-tooltip-text)",
                    fontWeight: "500",
                    marginLeft: "auto",
                  }}
                >
                  {value}
                </span>
              </div>
            );
          }
        )}
      </div>
    </ChartTooltipFrame>
  );
};

export default ChartTooltip;
