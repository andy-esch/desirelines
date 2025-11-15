/**
 * Sport-specific danger zone thresholds for pace requirements
 *
 * These thresholds represent the maximum sustainable pace for each sport.
 * Goals requiring pace above these thresholds are marked as being in the
 * "Zone of Unachievability" - technically possible but extremely difficult
 * to sustain over an extended period.
 *
 * Future enhancement (Task 8): Move these to sport configuration JSON
 * to allow customization per sport and user preferences.
 */

interface DangerZoneThresholds {
  [sport: string]: number;
}

export const DANGER_ZONE_THRESHOLDS: DangerZoneThresholds = {
  // Distance-based sports (miles/day or km/day)
  cycling: 20, // miles/day - very high but possible for serious cyclists
  running: 10, // miles/day - marathon pace (~26mi) requires rest days

  // Time-based sports (minutes/day)
  yoga: 120, // minutes/day - 2 hours/day is very high commitment
};

/**
 * Get the danger threshold for a given sport
 * Returns a default value if sport not configured
 */
export function getDangerThreshold(sport: string): number {
  return DANGER_ZONE_THRESHOLDS[sport] || 20; // Default to 20 if sport not found
}
