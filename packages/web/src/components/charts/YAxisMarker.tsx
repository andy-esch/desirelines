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
}: {
  viewBox: { x: number; y: number };
  label: string;
  color: string;
  fontSize: number;
  fontWeight: string | number;
  radius: number;
}) {
  return (
    <g>
      <circle cx={viewBox.x} cy={viewBox.y} r={radius} fill={color} />
      <text
        x={viewBox.x + 10}
        y={viewBox.y}
        textAnchor="start"
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
}: YAxisMarkerProps) {
  return (
    <ReferenceLine
      y={value}
      stroke="transparent"
      label={(props: { viewBox: { x: number; y: number } }) => (
        <MarkerLabel
          viewBox={props.viewBox}
          label={label}
          color={color}
          fontSize={fontSize}
          fontWeight={fontWeight}
          radius={radius}
        />
      )}
    />
  );
}

export default YAxisMarker;
