import type { Preferences } from "../types/generated/user_config";

/**
 * Common timezones for the timezone selector.
 * Covers major US, European, and Asia-Pacific zones.
 */
export const COMMON_TIMEZONES = [
  { value: "", label: "Browser Default" },
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Chicago", label: "Central Time (US)" },
  { value: "America/Denver", label: "Mountain Time (US)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Central European" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "China" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;

/**
 * Default user preferences.
 * Used when no preferences exist yet in Firestore.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  defaultYear: new Date().getFullYear(),
  distanceUnit: "miles",
  elevationUnit: "feet",
  defaultSport: "cycling",
  timezone: "",
  visibleSports: ["cycling", "running", "yoga", "hiking", "workout"],
};

/**
 * Distance unit options for settings.
 */
export const DISTANCE_UNIT_OPTIONS = [
  { value: "miles", label: "Miles" },
  { value: "kilometers", label: "Kilometers" },
] as const;

/**
 * Elevation unit options for settings.
 */
export const ELEVATION_UNIT_OPTIONS = [
  { value: "feet", label: "Feet" },
  { value: "meters", label: "Meters" },
] as const;
