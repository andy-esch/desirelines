/**
 * Chart Configuration Constants
 *
 * Centralized configuration for Recharts components.
 * Defines layout, sizing, styling, and behavior settings.
 */

export const CHART_CONFIG = {
  /** Chart dimensions */
  height: 450,

  /** Chart margins (top, right, bottom, left) */
  margin: {
    top: 20,
    right: 20,
    left: 80,
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

  /** Y-axis marker styling */
  marker: {
    radius: 4,
    fontSize: {
      actual: 12,
      goal: 11,
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
} as const;
