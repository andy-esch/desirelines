import type { Preferences } from "../types/generated/user_config";

export type DistanceUnit = "miles" | "kilometers" | "meters";
export type ElevationUnit = "meters" | "feet";
export type ActivityUnit = "sessions";
export type DurationUnit = "minutes" | "hours";
export type MetricUnit = DistanceUnit | ElevationUnit | ActivityUnit | DurationUnit;

// Valid values for runtime validation
const VALID_DISTANCE_UNITS: readonly DistanceUnit[] = ["miles", "kilometers", "meters"];
const VALID_ELEVATION_UNITS: readonly ElevationUnit[] = ["meters", "feet"];

/**
 * Type guard to validate if a string is a valid DistanceUnit
 */
function isValidDistanceUnit(value: unknown): value is DistanceUnit {
  return typeof value === "string" && VALID_DISTANCE_UNITS.includes(value as DistanceUnit);
}

/**
 * Type guard to validate if a string is a valid ElevationUnit
 */
function isValidElevationUnit(value: unknown): value is ElevationUnit {
  return typeof value === "string" && VALID_ELEVATION_UNITS.includes(value as ElevationUnit);
}

// Conversion constants
export const METERS_TO_MILES = 0.000621371;
export const METERS_TO_KM = 0.001;
export const METERS_TO_FEET = 3.28084;
export const MILES_TO_METERS = 1609.344;
export const KM_TO_METERS = 1000;

/**
 * Convert meters to display unit (miles, kilometers, or meters)
 */
export function convertDistance(meters: number, unit: DistanceUnit): number {
  switch (unit) {
    case "miles":
      return meters * METERS_TO_MILES;
    case "kilometers":
      return meters * METERS_TO_KM;
    case "meters":
      return meters;
  }
}

/**
 * Convert display unit back to meters (for storage)
 * This is the reverse of convertDistance()
 */
export function convertToMeters(value: number, unit: DistanceUnit): number {
  switch (unit) {
    case "miles":
      return value * MILES_TO_METERS;
    case "kilometers":
      return value * KM_TO_METERS;
    case "meters":
      return value;
  }
}

export function convertElevation(meters: number, unit: ElevationUnit): number {
  switch (unit) {
    case "feet":
      return meters * METERS_TO_FEET;
    case "meters":
      return meters;
  }
}

export function formatDistance(meters: number, unit: DistanceUnit, decimals = 1): string {
  const value = convertDistance(meters, unit);
  const label = getDistanceLabel(unit);
  return `${value.toFixed(decimals)} ${label}`;
}

export function formatImpactPct(pct: number | null): string {
  if (pct == null) return "—";
  if (pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

export function formatElevation(meters: number, unit: ElevationUnit, decimals = 0): string {
  const value = convertElevation(meters, unit);
  const label = getElevationLabel(unit);
  // Group thousands (e.g. "16,158 ft") for readability on large gains.
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${label}`;
}

export function getDistanceLabel(unit: DistanceUnit): string {
  switch (unit) {
    case "miles":
      return "mi";
    case "kilometers":
      return "km";
    case "meters":
      return "m";
  }
}

function getElevationLabel(unit: ElevationUnit): string {
  switch (unit) {
    case "feet":
      return "ft";
    case "meters":
      return "m";
  }
}

/**
 * True when the active unit represents activity counts rather than a measurable
 * quantity. Centralizes the rule so chart/KPI components branch on the same check.
 */
export function isSessionsUnit(unit: MetricUnit): boolean {
  return unit === "sessions";
}

/**
 * Resolve the display unit a given metric should render in, applying the user's
 * distance/elevation preferences. Single source of truth for the
 * metric-ID → display-unit mapping used by both authenticated and demo pages.
 *
 * @param metric - Metric ID (e.g. "distance_meters", "time_minutes")
 * @param userSettings - User's unit preferences
 * @param fallback - Unit to return when `metric` is not a known ID
 */
export function getDisplayUnitForMetric(
  metric: string,
  userSettings: Pick<UserSettings, "distanceUnit" | "elevationUnit">,
  fallback: MetricUnit = "miles"
): MetricUnit {
  switch (metric) {
    case "distance_meters":
      return userSettings.distanceUnit;
    case "elevation_meters":
      return userSettings.elevationUnit;
    case "time_minutes":
      return "hours";
    case "activities":
      return "sessions";
    default:
      return fallback;
  }
}

/**
 * Get the abbreviated display label for any metric unit. Used for chart axes
 * and compact numeric subtitles where space is at a premium.
 *
 * Distance abbreviates (miles → mi, kilometers → km). Time abbreviates too
 * (hours → hrs, minutes → min). Sessions and feet stay as-is since those
 * are already short.
 */
export function getMetricUnitLabel(unit: MetricUnit): string {
  switch (unit) {
    case "miles":
    case "kilometers":
    case "meters":
      return getDistanceLabel(unit);
    case "hours":
      return "hrs";
    case "minutes":
      return "min";
    case "feet":
    case "sessions":
      return unit;
  }
}

export type MetricType = "distance" | "time" | "sessions";

/**
 * Split a fractional quantity into a whole part and a remainder in 60ths,
 * carrying a remainder that rounds up to 60 back into the whole part.
 *
 * Rounding the remainder on its own is what produces "1 hr 60 min" and
 * "7:60/mi": `Math.round(0.999 * 60)` is 60, which is not a valid minute or
 * second value. The returned pair always satisfies `0 <= rem < 60`.
 */
export function splitSexagesimal(value: number): { whole: number; rem: number } {
  const whole = Math.floor(value);
  const rem = Math.round((value - whole) * 60);
  return rem === 60 ? { whole: whole + 1, rem: 0 } : { whole, rem };
}

/**
 * Format hours as a human-friendly duration string.
 * Examples: "1 hr 13 min", "45 min", "2 hr"
 */
export function formatHoursMinutes(hours: number): string {
  const { whole: h, rem: m } = splitSexagesimal(hours);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/**
 * Format a metric value for compact display, including the unit label.
 * Distance: 1 decimal for < 100, locale-formatted integer for >= 100, with unit.
 * Time: human-friendly duration (e.g., "1 hr 13 min") — unit is baked into the format.
 * Sessions: rounded integer with unit.
 */
export function formatMetricDisplayValue(
  value: number,
  metricType: MetricType,
  unitLabel: string
): string {
  switch (metricType) {
    case "distance":
      return `${value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)} ${unitLabel}`;
    case "time":
      return formatHoursMinutes(value);
    case "sessions":
      return `${Math.round(value).toString()} ${unitLabel}`;
  }
}

// Default user settings (can be loaded from Firestore later)
export interface UserSettings {
  distanceUnit: DistanceUnit;
  elevationUnit: ElevationUnit;
  defaultSport: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  distanceUnit: "miles", // US default
  elevationUnit: "feet", // US default
  defaultSport: "cycling", // User's main sport
};

/**
 * Time conversion helpers
 *
 * API returns time in minutes. We display in hours.
 * Goals are stored in minutes (matching API units) and displayed in hours.
 */

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

export function hoursToMinutes(hours: number): number {
  return hours * 60;
}

/**
 * Goal unit conversion helpers
 *
 * Goals are stored in METERS (canonical unit) and converted to display units
 * (miles/km) based on user preference. This ensures goals remain correct when
 * the user switches their unit preference.
 */

/**
 * Convert a goal value from meters (storage) to display units
 */
export function goalMetersToDisplay(meters: number, unit: DistanceUnit): number {
  return convertDistance(meters, unit);
}

/**
 * Convert a goal value from display units to meters (for storage)
 */
export function goalDisplayToMeters(value: number, unit: DistanceUnit): number {
  return convertToMeters(value, unit);
}

/**
 * Get user settings from preferences with fallback to defaults
 * This allows preferences to override hard-coded defaults.
 * Invalid enum values are safely ignored and fall back to defaults.
 */
export function getUserSettings(preferences?: Preferences | null): UserSettings {
  if (!preferences) {
    return DEFAULT_USER_SETTINGS;
  }

  return {
    distanceUnit: isValidDistanceUnit(preferences.distanceUnit)
      ? preferences.distanceUnit
      : DEFAULT_USER_SETTINGS.distanceUnit,
    elevationUnit: isValidElevationUnit(preferences.elevationUnit)
      ? preferences.elevationUnit
      : DEFAULT_USER_SETTINGS.elevationUnit,
    defaultSport: preferences.defaultSport || DEFAULT_USER_SETTINGS.defaultSport,
  };
}
