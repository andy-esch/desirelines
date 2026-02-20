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

import { roundToCleanMax } from "../utils/chartScaling";

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

  /** Grid styling — horizontal-only lines at major Y-axis values */
  grid: {
    stroke: "var(--color-chart-grid)",
    vertical: false,
  },

  /** Axis styling */
  axis: {
    stroke: "var(--color-chart-axis)",
  },

  /** Axis tick styling */
  tick: {
    fontSize: 11,
    fill: "var(--color-chart-tick)",
    fontFamily: '"Space Grotesk", sans-serif',
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
      backgroundColor: "var(--color-chart-tooltip-bg)",
      border: "1px solid var(--color-chart-tooltip-border)",
      borderRadius: "6px",
      padding: "12px 16px",
      boxShadow: "0 4px 12px var(--color-surface-shadow)",
    },
    labelStyle: {
      color: "var(--color-chart-tooltip-text)",
      fontWeight: "bold",
      marginBottom: "8px",
      fontSize: "13px",
    },
    itemStyle: {
      color: "var(--color-chart-tooltip-muted)",
      padding: "4px 0",
      fontSize: "12px",
    },
  },

  /** Animation settings */
  animation: {
    duration: 400,
    easing: "ease-out" as const,
  },

  /** Drag-to-zoom selection overlay */
  selection: {
    fill: "var(--color-accent-cyan)",
    fillOpacity: 0.2,
  },

  /** Goal achievement marker styling (visibility controlled by showAchievements prop) */
  achievementMarker: {
    /** Render SVG path star (true) or unicode character (false) */
    svgStar: true,
    /** Size of the star marker */
    size: 12,
    /** Vertical offset above the data point (0 = on the line) */
    yOffset: 0,
    /** Unicode star character (used when svgStar is false) */
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
  return roundToCleanMax(dataMax);
}
