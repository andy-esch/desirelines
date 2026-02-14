/**
 * Chart Configuration Constants
 *
 * Centralized configuration for Recharts components.
 * Defines layout, sizing, styling, and behavior settings.
 *
 * Architecture:
 * - CHART_CONFIG: Shared settings used by all chart types
 * - DANGER_ZONE_CONFIG: Pacing chart specific (zone of unachievability)
 * - calculateYAxisDomain: Shared utility for cumulative chart Y-axis scaling
 */

export const CHART_CONFIG = {
  /** Chart dimensions */
  height: 400,

  /** Chart margins (top, right, bottom, left) */
  margin: {
    top: 20,
    right: 5,
    left: 5,
    bottom: 5,
  },

  /** Line stroke widths */
  strokeWidth: {
    actual: 3,
    goal: 2,
  },

  /** Grid styling */
  grid: {
    strokeDasharray: "3 3",
    stroke: "#2a2a2a",
    opacity: 0.3,
  },

  /** Axis styling */
  axis: {
    stroke: "#666",
  },

  /** Y-axis marker styling (only fontSize used; radius/fontWeight use component defaults) */
  marker: {
    fontSize: {
      actual: 12,
    },
  },

  /** Tooltip styling */
  tooltip: {
    contentStyle: {
      backgroundColor: "#1a1a1a",
      border: "1px solid #444",
      borderRadius: "6px",
      padding: "12px 16px",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    },
    labelStyle: {
      color: "#fff",
      fontWeight: "bold",
      marginBottom: "8px",
      fontSize: "13px",
    },
    itemStyle: {
      color: "#ddd",
      padding: "4px 0",
      fontSize: "12px",
    },
  },

  /** Animation settings */
  animation: {
    duration: 50,
  },

  /** Drag-to-zoom selection overlay */
  selection: {
    fill: "#8884d8",
    fillOpacity: 0.2,
  },

  /** Goal achievement marker styling (visibility controlled by showAchievements prop) */
  achievementMarker: {
    /** Use SVG path star (true) or unicode character (false) */
    useSvgStar: true,
    /** Size of the star marker */
    size: 12,
    /** Vertical offset above the data point (0 = on the line) */
    yOffset: 0,
    /** Unicode star character (used when useSvgStar is false) */
    unicodeChar: "★",
    /** Font size for unicode star */
    unicodeFontSize: 18,
  },
} as const;

/**
 * Danger Zone Configuration (Pacing Chart)
 *
 * Visual styling for the "zone of unachievability" that appears
 * when required daily pace exceeds realistic limits.
 */
export const DANGER_ZONE_CONFIG = {
  /** Shaded area fill */
  area: {
    fill: "rgba(255, 152, 0, 0.08)",
    fillOpacity: 0.5,
    stroke: "rgba(255, 152, 0, 0.3)",
    strokeDasharray: "3 3",
  },
  /** Threshold line */
  line: {
    stroke: "#ff9800",
    strokeWidth: 2,
    strokeDasharray: "5 5",
  },
  /** Label styling */
  label: {
    fill: "#e65100",
    fontSize: 12,
    fontWeight: 600,
    fontStyle: "italic" as const,
    position: "insideTopRight" as const,
    offset: 5,
  },
} as const;

/**
 * Calculate Y-axis domain maximum for cumulative charts.
 *
 * Uses tiered rounding to create clean axis values:
 * - < 500: round to nearest 100
 * - < 2000: round to nearest 250
 * - < 5000: round to nearest 500
 * - >= 5000: round to nearest 1000
 *
 * @param dataMax - Maximum value in the data
 * @returns Rounded maximum for Y-axis domain
 */
export function calculateCumulativeYAxisMax(dataMax: number): number {
  if (dataMax < 500) return Math.ceil(dataMax / 100) * 100;
  if (dataMax < 2000) return Math.ceil(dataMax / 250) * 250;
  if (dataMax < 5000) return Math.ceil(dataMax / 500) * 500;
  return Math.ceil(dataMax / 1000) * 1000;
}
