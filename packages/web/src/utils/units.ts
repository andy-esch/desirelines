import type { Preferences } from "../types/generated/user_config";

export type DistanceUnit = "miles" | "kilometers" | "meters";
export type ElevationUnit = "meters" | "feet";
export type ActivityUnit = "sessions";
export type DurationUnit = "minutes" | "hours";
export type MetricUnit = DistanceUnit | ElevationUnit | ActivityUnit | DurationUnit;

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

export function formatElevation(meters: number, unit: ElevationUnit, decimals = 0): string {
  const value = convertElevation(meters, unit);
  const label = getElevationLabel(unit);
  return `${value.toFixed(decimals)} ${label}`;
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

export function getElevationLabel(unit: ElevationUnit): string {
  switch (unit) {
    case "feet":
      return "ft";
    case "meters":
      return "m";
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
 * This allows preferences to override hard-coded defaults
 */
export function getUserSettings(preferences?: Preferences | null): UserSettings {
  if (!preferences) {
    return DEFAULT_USER_SETTINGS;
  }

  return {
    distanceUnit: (preferences.distanceUnit as DistanceUnit) || DEFAULT_USER_SETTINGS.distanceUnit,
    elevationUnit:
      (preferences.elevationUnit as ElevationUnit) || DEFAULT_USER_SETTINGS.elevationUnit,
    defaultSport: preferences.defaultSport || DEFAULT_USER_SETTINGS.defaultSport,
  };
}
