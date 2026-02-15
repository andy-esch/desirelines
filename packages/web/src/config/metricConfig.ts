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

import type { MetricUnit, UserSettings } from "../utils/units";
import { MetricType } from "../types/generated/sports_metrics";

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
    unit: "miles",
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
    unit: "hours",
    chartLabel: "hrs",
    chartAxisLabel: "hrs",
    perDayLabel: "hrs / day",
    goalIncrement: 5,
    roundingFactor: 5,
    defaultGoalValue: 100,
    chartIntervalThresholds: [
      { max: 50, interval: 10 },
      { max: 200, interval: 25 },
      { max: 500, interval: 50 },
      { max: Infinity, interval: 100 },
    ],
  },
  elevation: {
    id: "elevation",
    displayName: "Elevation",
    unit: "feet",
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
    metricType: "time",
    // Yoga uses default time config (5 hr increment, 100 hr default)
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
    metricType: "time",
    overrides: {
      defaultGoalValue: 25, // ~25 hours
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
  golf: {
    metricType: "time",
  },
  racket_sports: {
    metricType: "time",
  },
  team_sports: {
    metricType: "time",
  },
  climbing: {
    metricType: "time",
  },
  ebike: {
    metricType: "distance",
  },
  watersports: {
    metricType: "distance",
  },
  winter_sports: {
    metricType: "distance",
  },
  skating: {
    metricType: "distance",
  },
  wheelchair: {
    metricType: "distance",
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

/** Maximum number of non-zero Y-axis ticks (keeps gridlines clean) */
const MAX_Y_TICKS = 5;

/**
 * Generate Y-axis tick values for a chart.
 *
 * Creates an array of evenly-spaced tick values from 0 to beyond maxValue,
 * using the sport-appropriate interval. Doubles the interval as needed to
 * keep the total to at most MAX_Y_TICKS non-zero ticks (3-5 gridlines).
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
  let interval = getChartInterval(maxValue, config);

  // Double interval until we have at most MAX_Y_TICKS non-zero ticks
  while (maxValue > 0 && Math.ceil(maxValue / interval) > MAX_Y_TICKS) {
    interval *= 2;
  }

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

/**
 * Check if a sport uses time as its primary metric.
 *
 * @param sport - Sport key
 * @returns true if the sport tracks time
 */
export function isTimeMetricSport(sport: string): boolean {
  const config = getMetricConfig(sport);
  return config.id === "time";
}

/**
 * Mapping from proto MetricType enum to base config keys.
 * This bridges the cross-language contract (proto) with the frontend config system.
 */
const METRIC_TYPE_TO_CONFIG_KEY: Record<MetricType, string> = {
  [MetricType.METRIC_TYPE_UNSPECIFIED]: "distance", // fallback
  [MetricType.METRIC_TYPE_DISTANCE_METERS]: "distance",
  [MetricType.METRIC_TYPE_TIME_MINUTES]: "time",
  [MetricType.METRIC_TYPE_ELEVATION_METERS]: "elevation",
  [MetricType.METRIC_TYPE_ACTIVITIES]: "sessions",
  [MetricType.UNRECOGNIZED]: "distance", // fallback
};

/**
 * Mapping from API string metric IDs to MetricType enum.
 * The API uses string IDs like "distance_meters" in sportConfig.metrics arrays.
 */
const METRIC_STRING_TO_TYPE: Record<string, MetricType> = {
  distance_meters: MetricType.METRIC_TYPE_DISTANCE_METERS,
  time_minutes: MetricType.METRIC_TYPE_TIME_MINUTES,
  elevation_meters: MetricType.METRIC_TYPE_ELEVATION_METERS,
  activities: MetricType.METRIC_TYPE_ACTIVITIES,
};

/**
 * Get metric configuration by metric ID (string or enum).
 *
 * This function bridges the API metric IDs (used in sportConfig.metrics arrays)
 * with the frontend MetricConfig system. It applies user unit preferences for
 * distance (miles/km) and elevation (feet/meters).
 *
 * @param metricId - Metric identifier, either:
 *   - String from API: "distance_meters", "time_minutes", "elevation_meters", "activities"
 *   - MetricType enum value
 * @param userSettings - Optional user settings for unit preferences
 * @returns MetricConfig with appropriate units applied
 *
 * @example
 * ```ts
 * // Using string ID from API
 * const config = getMetricConfigByMetricId("distance_meters", userSettings);
 * // Returns distance config with miles/km based on user preference
 *
 * // Using enum for type safety
 * const config = getMetricConfigByMetricId(MetricType.METRIC_TYPE_ELEVATION_METERS, userSettings);
 * // Returns elevation config with feet/meters based on user preference
 * ```
 */
export function getMetricConfigByMetricId(
  metricId: string | MetricType,
  userSettings?: UserSettings
): MetricConfig {
  // Convert string to MetricType if needed
  const metricType =
    typeof metricId === "string"
      ? (METRIC_STRING_TO_TYPE[metricId] ?? MetricType.METRIC_TYPE_UNSPECIFIED)
      : metricId;

  // Get the base config key from the metric type
  const configKey = METRIC_TYPE_TO_CONFIG_KEY[metricType];
  const baseConfig = BASE_METRIC_CONFIGS[configKey];

  // Apply unit overrides based on user preferences
  if (!userSettings) {
    return baseConfig;
  }

  // Distance: apply miles/km preference
  if (configKey === "distance" && userSettings.distanceUnit === "kilometers") {
    return {
      ...baseConfig,
      unit: "kilometers",
      chartLabel: "km",
      chartAxisLabel: "km",
      perDayLabel: "km / day",
    };
  }

  // Elevation: apply feet/meters preference
  if (configKey === "elevation" && userSettings.elevationUnit === "meters") {
    return {
      ...baseConfig,
      unit: "meters",
      chartLabel: "m",
      chartAxisLabel: "m",
      perDayLabel: "m / day",
    };
  }

  return baseConfig;
}

/**
 * Get the CumulativeMetricsEntry field name for a metric ID.
 *
 * The proto CumulativeMetricsEntry has fields: distance, elevation, time, activities.
 * This maps from API metric IDs to those field names.
 *
 * @param metricId - API metric ID string
 * @returns Field name in CumulativeMetricsEntry
 */
export function getMetricFieldName(
  metricId: string
): "distance" | "elevation" | "time" | "activities" {
  switch (metricId) {
    case "distance_meters":
      return "distance";
    case "elevation_meters":
      return "elevation";
    case "time_minutes":
      return "time";
    case "activities":
      return "activities";
    default:
      return "distance";
  }
}

/**
 * Get human-readable label for a metric ID.
 * Used in UI elements like dropdown labels.
 *
 * @param metricId - API metric ID string
 * @returns Display label (e.g., "Distance", "Time", "Elevation", "Sessions")
 */
export function getMetricDisplayLabel(metricId: string): string {
  switch (metricId) {
    case "distance_meters":
      return "Distance";
    case "elevation_meters":
      return "Elevation";
    case "time_minutes":
      return "Time";
    case "activities":
      return "Sessions";
    default:
      return metricId;
  }
}
