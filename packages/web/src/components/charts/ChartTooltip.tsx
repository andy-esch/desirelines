export interface ChartTooltipProps {
  /** Whether the tooltip is active (hovered) */
  active?: boolean;
  /** Payload data from Recharts */
  payload?: Array<{
    name?: string;
    value?: number | string;
    stroke?: string;
    color?: string;
    dataKey?: string;
  }>;
  /** X-axis label (typically a date string) */
  label?: string | number;
  /** Unit to display after values (e.g., "mi", "mi/day") */
  unit?: string;
  /** Number of decimal places for value formatting */
  decimals?: number;
  /** Compact mode - show only actual + nearest goal with delta */
  compact?: boolean;
}

/**
 * Shared tooltip component for Recharts charts
 *
 * Displays formatted date and data values with consistent styling.
 * Supports customizable units and decimal precision.
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
  if (!active || !payload || payload.length === 0) return null;

  const date = new Date(label as string);
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);

  // Find actual value and goal values from payload
  const actualEntry = payload.find((p) => p.dataKey === "actual" || p.name?.includes("Data"));
  const actualValue = typeof actualEntry?.value === "number" ? actualEntry.value : 0;

  // Find goal entries (exclude actual and average)
  const goalEntries = payload.filter(
    (p) =>
      p.dataKey?.startsWith("goal") ||
      (p.name && !p.name.includes("Data") && !p.name.includes("Average"))
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
    // Compact mode: just actual + delta vs nearest goal
    // Use goal's color for the delta to create visual connection
    const goalColor = targetGoal.stroke || targetGoal.color || "#888";

    return (
      <div
        style={{
          backgroundColor: "rgba(20, 20, 20, 0.85)",
          border: "1px solid #444",
          borderRadius: "6px",
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
          fontSize: "12px",
          minWidth: "140px",
        }}
      >
        <div style={{ color: "#999", marginBottom: "4px" }}>{formattedDate}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span style={{ color: "#fff", fontWeight: "600", fontSize: "14px" }}>
            {actualValue.toFixed(decimals)} {unit}
          </span>
          <span
            style={{
              color: goalColor,
              fontSize: "11px",
            }}
          >
            {isAhead ? "+" : "−"}
            {deltaAbs.toFixed(decimals)} vs {goalLabel}
          </span>
        </div>
      </div>
    );
  }

  // Full mode (original behavior, slightly refined)
  return (
    <div
      style={{
        backgroundColor: "rgba(20, 20, 20, 0.9)",
        border: "1px solid #444",
        borderRadius: "6px",
        padding: "10px 12px",
        boxShadow: "0 2px 12px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header with date */}
      <div
        style={{
          fontSize: "12px",
          fontWeight: "bold",
          color: "#fff",
          marginBottom: "8px",
          paddingBottom: "6px",
          borderBottom: "1px solid #333",
        }}
      >
        {formattedDate}
      </div>

      {/* Data items */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {payload.map(
          (
            entry: {
              stroke?: string;
              color?: string;
              value?: number | string;
              name?: string;
              dataKey?: string;
            },
            index: number
          ) => {
            const color = entry.stroke || entry.color || "#888";
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
                    borderRadius: "2px",
                    backgroundColor: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "#aaa" }}>{shortName}</span>
                <span style={{ color: "#fff", fontWeight: "500", marginLeft: "auto" }}>
                  {value}
                </span>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
};

export default ChartTooltip;
