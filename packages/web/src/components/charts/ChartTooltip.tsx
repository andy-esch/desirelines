export interface ChartTooltipProps {
  /** Whether the tooltip is active (hovered) */
  active?: boolean;
  /** Payload data from Recharts */
  payload?: Array<{
    name?: string;
    value?: number | string;
    stroke?: string;
    color?: string;
  }>;
  /** X-axis label (typically a date string) */
  label?: string | number;
  /** Unit to display after values (e.g., "mi", "mi/day") */
  unit?: string;
  /** Number of decimal places for value formatting */
  decimals?: number;
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
}: ChartTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  const date = new Date(label as string);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      style={{
        backgroundColor: "#1a1a1a",
        border: "1px solid #444",
        borderRadius: "8px",
        padding: "16px",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.6)",
      }}
    >
      {/* Header with date */}
      <div
        style={{
          fontSize: "14px",
          fontWeight: "bold",
          color: "#fff",
          marginBottom: "12px",
          paddingBottom: "8px",
          borderBottom: "1px solid #333",
        }}
      >
        {formattedDate}
      </div>

      {/* Data items */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {payload.map((entry: any, index: number) => {
          // Get the color - use the stroke color from the entry
          const color = entry.stroke || entry.color || "#888";
          const value =
            typeof entry.value === "number" ? entry.value.toFixed(decimals) : entry.value;

          return (
            <div
              key={index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
              }}
            >
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "2px",
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "#ddd", flex: 1 }}>{entry.name}:</span>
              <span style={{ color: "#fff", fontWeight: "600" }}>
                {value} {unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChartTooltip;
