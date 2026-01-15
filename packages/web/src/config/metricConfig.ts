/**
 * MetricConfig System
 *
 * Centralized configuration for sport-specific metrics, replacing scattered magic numbers.
 * This system provides:
 * - Metric type definitions (distance, sessions, time, elevation)
 * - Sport-to-metric mappings
 * - UI configuration (goal increments, rounding, chart intervals)
 * - User preference integration (miles/km, feet/meters)
 *
 * DESIGN DECISIONS:
 * - Each metric type has sensible defaults
 * - Sports can override specific values while inheriting the rest
 * - User preferences (units) are applied at runtime
 * - Chart intervals scale based on data ranges
 *
 * @see GoalControls - Uses incrementSize, roundingFactor
 * @see CumulativeMetricsChart - Uses chartIntervalThresholds
 * @see SportPage - Uses defaultGoalValue
 */

import type { MetricUnit } from "../utils/units";

/**
 * Threshold configuration for Y-axis intervals.
 * When the max value is below `max`, use `interval`.
 */
export interface IntervalThreshold {
  /** Upper bound for this threshold (exclusive) */
  max: number;
  /** Interval to use for Y-axis ticks */
  interval: number;
}

/**
 * Complete configuration for a metric type.
 */
export interface MetricConfig {
  /** Unique identifier for this metric type */
  id: string;
  /** Human-readable name (e.g., "Distance", "Sessions") */
  displayName: string;
  /** Unit label for display (e.g., "mi", "km", "sessions") */
  unit: MetricUnit;
  /** Short label for charts (e.g., "mi", "sessions") */
  chartLabel: string;
  /** Label for chart Y-axis (e.g., "mi", "# Sessions") */
  chartAxisLabel: string;
  /** Label for per-day rates (e.g., "mi / day") */
  perDayLabel: string;

  // Sport-specific business rules (addresses magic numbers)
  /** Increment size for +/- buttons in goal controls */
  goalIncrement: number;
  /** Rounding factor for goal values */
  roundingFactor: number;
  /** Default goal value when no data exists */
  defaultGoalValue: number;
  /** Thresholds for Y-axis interval calculation */
  chartIntervalThresholds: IntervalThreshold[];
}

/**
 * Base metric configurations.
 * These define the core metric types without sport-specific overrides.
 */
const BASE_METRIC_CONFIGS: Record<string, MetricConfig> = {
  distance: {
    id: "distance",
    displayName: "Distance",
    unit: "mi",
    chartLabel: "mi",
    chartAxisLabel: "mi",
    perDayLabel: "mi / day",
    goalIncrement: 100,
    roundingFactor: 100,
    defaultGoalValue: 2500,
    chartIntervalThresholds: [
      { max: 500, interval: 100 },
      { max: 2000, interval: 250 },
      { max: 5000, interval: 500 },
      { max: Infinity, interval: 1000 },
    ],
  },
  sessions: {
    id: "sessions",
    displayName: "Sessions",
    unit: "sessions",
    chartLabel: "sessions",
    chartAxisLabel: "# Sessions",
    perDayLabel: "sessions / day",
    goalIncrement: 10,
    roundingFactor: 10,
    defaultGoalValue: 100,
    chartIntervalThresholds: [
      { max: 50, interval: 10 },
      { max: 200, interval: 25 },
      { max: 500, interval: 50 },
      { max: Infinity, interval: 100 },
    ],
  },
  time: {
    id: "time",
    displayName: "Time",
    unit: "min",
    chartLabel: "min",
    chartAxisLabel: "min",
    perDayLabel: "min / day",
    goalIncrement: 30,
    roundingFactor: 30,
    defaultGoalValue: 1000,
    chartIntervalThresholds: [
      { max: 500, interval: 100 },
      { max: 2000, interval: 250 },
      { max: 5000, interval: 500 },
      { max: Infinity, interval: 1000 },
    ],
  },
  elevation: {
    id: "elevation",
    displayName: "Elevation",
    unit: "ft",
    chartLabel: "ft",
    chartAxisLabel: "ft",
    perDayLabel: "ft / day",
    goalIncrement: 1000,
    roundingFactor: 1000,
    defaultGoalValue: 50000,
    chartIntervalThresholds: [
      { max: 10000, interval: 2000 },
      { max: 50000, interval: 5000 },
      { max: 100000, interval: 10000 },
      { max: Infinity, interval: 25000 },
    ],
  },
};

/**
 * Sport-specific metric overrides.
 * These override specific properties from the base metric config.
 */
interface SportMetricOverride {
  /** Base metric type to use */
  metricType: string;
  /** Properties to override from the base config */
  overrides?: Partial<MetricConfig>;
}

const SPORT_METRIC_OVERRIDES: Record<string, SportMetricOverride> = {
  cycling: {
    metricType: "distance",
    // Cycling uses default distance config (100 increment, 2500 default)
  },
  running: {
    metricType: "distance",
    overrides: {
      goalIncrement: 10,
      roundingFactor: 10,
      defaultGoalValue: 1000,
      chartIntervalThresholds: [
        { max: 200, interval: 50 },
        { max: 500, interval: 100 },
        { max: 1500, interval: 250 },
        { max: Infinity, interval: 500 },
      ],
    },
  },
  yoga: {
    metricType: "sessions",
    // Yoga uses default sessions config
  },
  hiking: {
    metricType: "distance",
    overrides: {
      goalIncrement: 10,
      roundingFactor: 10,
      defaultGoalValue: 500,
      chartIntervalThresholds: [
        { max: 100, interval: 25 },
        { max: 500, interval: 50 },
        { max: 1000, interval: 100 },
        { max: Infinity, interval: 250 },
      ],
    },
  },
  swimming: {
    metricType: "distance",
    overrides: {
      goalIncrement: 10,
      roundingFactor: 10,
      defaultGoalValue: 200,
      chartIntervalThresholds: [
        { max: 50, interval: 10 },
        { max: 200, interval: 25 },
        { max: 500, interval: 50 },
        { max: Infinity, interval: 100 },
      ],
    },
  },
  workout: {
    metricType: "sessions",
    overrides: {
      defaultGoalValue: 150,
    },
  },
  walking: {
    metricType: "distance",
    overrides: {
      goalIncrement: 10,
      roundingFactor: 10,
      defaultGoalValue: 500,
    },
  },
};

/**
 * Get the metric configuration for a sport.
 *
 * Returns the base metric config for the sport's primary metric type,
 * with any sport-specific overrides applied.
 *
 * @param sport - Sport key (e.g., "cycling", "yoga")
 * @returns Complete MetricConfig for the sport
 *
 * @example
 * ```ts
 * const config = getMetricConfig("cycling");
 * // Returns distance config with 100 increment, 2500 default
 *
 * const config = getMetricConfig("running");
 * // Returns distance config with 10 increment, 1000 default (overridden)
 *
 * const config = getMetricConfig("yoga");
 * // Returns sessions config with 10 increment, 100 default
 * ```
 */
export function getMetricConfig(sport: string): MetricConfig {
  const sportOverride = SPORT_METRIC_OVERRIDES[sport];

  if (!sportOverride) {
    // Unknown sport defaults to distance
    return BASE_METRIC_CONFIGS.distance;
  }

  const baseConfig = BASE_METRIC_CONFIGS[sportOverride.metricType];

  if (!sportOverride.overrides) {
    return baseConfig;
  }

  // Merge base config with sport-specific overrides
  return {
    ...baseConfig,
    ...sportOverride.overrides,
  };
}

/**
 * Get the chart Y-axis interval for a given maximum value.
 *
 * Uses the sport's interval thresholds to determine the appropriate
 * interval for clean, readable Y-axis tick marks.
 *
 * @param maxValue - Maximum value in the chart data
 * @param config - MetricConfig for the sport
 * @returns Interval to use for Y-axis ticks
 *
 * @example
 * ```ts
 * const config = getMetricConfig("cycling");
 * getChartInterval(300, config);  // Returns 100
 * getChartInterval(1500, config); // Returns 250
 * getChartInterval(3000, config); // Returns 500
 * getChartInterval(8000, config); // Returns 1000
 * ```
 */
export function getChartInterval(maxValue: number, config: MetricConfig): number {
  for (const threshold of config.chartIntervalThresholds) {
    if (maxValue < threshold.max) {
      return threshold.interval;
    }
  }
  // Fallback (should never reach due to Infinity threshold)
  return config.chartIntervalThresholds[config.chartIntervalThresholds.length - 1].interval;
}

/**
 * Generate Y-axis tick values for a chart.
 *
 * Creates an array of evenly-spaced tick values from 0 to beyond maxValue,
 * using the sport-appropriate interval.
 *
 * @param maxValue - Maximum value in the chart data
 * @param config - MetricConfig for the sport
 * @returns Array of tick values for Y-axis
 *
 * @example
 * ```ts
 * const config = getMetricConfig("cycling");
 * generateYAxisTicks(450, config);
 * // Returns [0, 100, 200, 300, 400, 500]
 * ```
 */
export function generateYAxisTicks(maxValue: number, config: MetricConfig): number[] {
  const interval = getChartInterval(maxValue, config);
  const ticks: number[] = [];

  for (let i = 0; i <= maxValue + interval; i += interval) {
    ticks.push(i);
  }

  return ticks;
}

/**
 * Check if a sport uses distance as its primary metric.
 *
 * @param sport - Sport key
 * @returns true if the sport tracks distance
 */
export function isDistanceMetricSport(sport: string): boolean {
  const config = getMetricConfig(sport);
  return config.id === "distance";
}

/**
 * Check if a sport uses sessions as its primary metric.
 *
 * @param sport - Sport key
 * @returns true if the sport tracks sessions
 */
export function isSessionsMetricSport(sport: string): boolean {
  const config = getMetricConfig(sport);
  return config.id === "sessions";
}
