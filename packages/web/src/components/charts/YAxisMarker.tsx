/**
 * YAxisMarker - Reusable Y-axis marker component for Recharts.
 *
 * Renders a colored dot and label at a specific Y position on the chart,
 * typically used to show where "Actual" data and goal lines currently sit.
 */
import { ReferenceLine } from "recharts";

/** Default marker styling constants */
const DEFAULT_MARKER_RADIUS = 4;
const DEFAULT_FONT_SIZE = 11;

interface YAxisMarkerProps {
  /** The Y-axis value where the marker should appear */
  value: number;
  /** Label text to display next to the marker */
  label: string;
  /** Color for both the dot and label */
  color: string;
  /** Font size for the label (defaults to 11) */
  fontSize?: number;
  /** Font weight for the label (defaults to "normal") */
  fontWeight?: string | number;
  /** Radius of the marker dot (defaults to 4) */
  radius?: number;
  /** Position of the marker: "left" (Y-axis) or "right" (end of chart) */
  position?: "left" | "right";
}

/**
 * Custom label renderer for the ReferenceLine.
 * Renders a circle (dot) and text label at the Y-axis position.
 */
function MarkerLabel({
  viewBox,
  label,
  color,
  fontSize,
  fontWeight,
  radius,
  position,
}: {
  viewBox: { x: number; y: number; width: number };
  label: string;
  color: string;
  fontSize: number;
  fontWeight: string | number;
  radius: number;
  position: "left" | "right";
}) {
  const isRight = position === "right";
  const dotX = isRight ? viewBox.x + viewBox.width : viewBox.x;
  const textX = isRight ? dotX - 10 : dotX + 10;
  const anchor = isRight ? "end" : "start";

  return (
    <g>
      <circle cx={dotX} cy={viewBox.y} r={radius} fill={color} />
      <text
        x={textX}
        y={viewBox.y}
        textAnchor={anchor}
        fill={color}
        fontSize={fontSize}
        fontWeight={fontWeight}
        dominantBaseline="middle"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * YAxisMarker component - renders a dot + label marker at a Y-axis position.
 *
 * Usage:
 * ```tsx
 * <YAxisMarker
 *   value={currentValues.actual}
 *   label="Actual"
 *   color={CHART_COLORS.ACTUAL_DATA_LINE}
 *   fontWeight="bold"
 * />
 * ```
 */
export function YAxisMarker({
  value,
  label,
  color,
  fontSize = DEFAULT_FONT_SIZE,
  fontWeight = "normal",
  radius = DEFAULT_MARKER_RADIUS,
  position = "left",
}: YAxisMarkerProps) {
  return (
    <ReferenceLine
      y={value}
      stroke="transparent"
      label={(props: { viewBox: { x: number; y: number; width: number } }) => (
        <MarkerLabel
          viewBox={props.viewBox}
          label={label}
          color={color}
          fontSize={fontSize}
          fontWeight={fontWeight}
          radius={radius}
          position={position}
        />
      )}
    />
  );
}

export default YAxisMarker;
