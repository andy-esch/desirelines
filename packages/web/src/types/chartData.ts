/**
 * Type definitions for chart data structures.
 *
 * These types ensure type safety when merging and transforming
 * chart data for Recharts components.
 */
import type { DistanceEntry } from "./activity";

/**
 * Base interface for merged chart data points.
 * Used by both cumulative and pacing charts.
 */
export interface ChartDataPoint {
  date: Date;
  actual?: number | undefined;
  average?: number | undefined;
  // Dynamic goal keys: goal0, goal1, goal2, etc.
  // TypeScript index signature for goal properties
  [key: `goal${number}`]: number | undefined;
  // Prior year keys: prior_2025, prior_2024, etc.
  [key: `prior_${number}`]: number | undefined;
}

/**
 * Chart data point for cumulative distance charts.
 * Extends base with danger boundary for "zone of unachievability".
 */
export interface CumulativeChartDataPoint extends ChartDataPoint {
  dangerBoundary?: number | undefined;
}

/**
 * Chart data point for pacing charts.
 * Currently identical to ChartDataPoint but available for future extension.
 */
export type PacingChartDataPoint = ChartDataPoint;

/**
 * Current values summary for Y-axis markers.
 * Shows where each line currently sits on the chart.
 */
export interface CurrentChartValues {
  actual: number;
  goals: Array<{
    label?: string | undefined;
    value: number;
    color: string;
  }>;
  average?: number | undefined;
}

/** Goal metadata shared between cumulative and pacing charts */
interface GoalMeta {
  id: string;
  value: number;
  label?: string | undefined;
}

/**
 * Goal line data for cumulative chart rendering.
 */
export interface GoalLineData {
  goal: GoalMeta;
  line: DistanceEntry[];
}

/**
 * Goal pacing data for pacing chart rendering.
 */
export interface PacingGoalData {
  goal: GoalMeta;
  pacing: DistanceEntry[];
}

/**
 * Goal achievement marker data.
 */
export interface GoalAchievement {
  date: Date;
  goalLabel: string;
  goalValue: number;
  actualValue: number;
  goalColor: string;
  goalIndex: number;
}
