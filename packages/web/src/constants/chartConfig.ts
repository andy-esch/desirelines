/**
 * Chart Configuration Constants
 *
 * Centralized configuration for Recharts components.
 * Defines layout, sizing, styling, and behavior settings.
 *
 * Architecture:
 * - CHART_CONFIG: Shared settings used by all chart types
 * - DANGER_ZONE_CONFIG: Pacing chart specific (zone of unachievability)
 */

import { alpha } from "../utils/colorTokens";

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
    fontFamily: "var(--font-chart)",
  },

  /** Y-axis marker styling (only fontSize used; radius/fontWeight use component defaults) */
  marker: {
    fontSize: {
      actual: 12,
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
    fill: alpha("var(--color-danger-zone)", 8),
    fillOpacity: 0.5,
    stroke: alpha("var(--color-danger-zone)", 30),
    strokeDasharray: "3 3",
  },
  /** Threshold line */
  line: {
    stroke: "var(--color-danger-zone)",
    strokeWidth: 2,
    strokeDasharray: "5 5",
  },
  /** Label styling */
  label: {
    fill: "var(--color-danger-zone-label)",
    fontSize: 12,
    fontWeight: 600,
    fontStyle: "italic" as const,
    position: "insideTopRight" as const,
    offset: 5,
  },
} as const;
