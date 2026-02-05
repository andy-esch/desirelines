/**
 * Demo Mode Configuration
 *
 * Defines how demo data is generated for each sport.
 * Each sport has a "fill level" that determines how much data is shown.
 */

export type FillLevel = "full" | "partial" | "empty";

export type DemoSport = "cycling" | "running" | "yoga" | "hiking" | "workout";

export interface DemoSportConfig {
  /** How much data to generate */
  fillLevel: FillLevel;
  /** Percentage of days with activity (0-1) */
  activityRate: number;
  /** Average distance per activity in meters */
  avgDistanceMeters: number;
  /** Variance in distance (multiplier, e.g., 0.3 = +/- 30%) */
  distanceVariance: number;
  /** Average duration per activity in seconds */
  avgDurationSeconds: number;
  /** Variance in duration */
  durationVariance: number;
  /** Average elevation per activity in meters (optional) */
  avgElevationMeters?: number;
  /** Demo goal values (in display units: miles for cycling/running, hours for yoga) */
  goals: {
    conservative: number;
    target: number;
    stretch: number;
  };
}

/**
 * Demo configuration for each sport.
 *
 * - Cycling: Full data (~80% of days) - shows the "happy path"
 * - Running: Partial data (~30% of days, clustered recently) - shows mid-year start
 * - Yoga: Empty - shows the beautiful empty state
 */
export const DEMO_SPORT_CONFIG: Record<DemoSport, DemoSportConfig> = {
  cycling: {
    fillLevel: "full",
    activityRate: 0.6, // ~60% of days have activity
    avgDistanceMeters: 40000, // ~25 miles average
    distanceVariance: 0.4,
    avgDurationSeconds: 5400, // 1.5 hours
    durationVariance: 0.3,
    avgElevationMeters: 300,
    goals: {
      conservative: 2000, // miles
      target: 2500,
      stretch: 3000,
    },
  },
  running: {
    fillLevel: "partial",
    activityRate: 0.25, // ~25% of days, but clustered in recent months
    avgDistanceMeters: 8000, // ~5 miles average
    distanceVariance: 0.5,
    avgDurationSeconds: 2700, // 45 minutes
    durationVariance: 0.3,
    avgElevationMeters: 50,
    goals: {
      conservative: 500, // miles
      target: 750,
      stretch: 1000,
    },
  },
  yoga: {
    fillLevel: "empty",
    activityRate: 0.15, // ~15% of days
    avgDistanceMeters: 0,
    distanceVariance: 0,
    avgDurationSeconds: 3600, // 1 hour
    durationVariance: 0.2,
    goals: {
      conservative: 100, // hours
      target: 150,
      stretch: 200,
    },
  },
  hiking: {
    fillLevel: "full",
    activityRate: 0.15, // ~15% of days (weekend warrior)
    avgDistanceMeters: 12000, // ~7.5 miles average
    distanceVariance: 0.5,
    avgDurationSeconds: 10800, // 3 hours
    durationVariance: 0.4,
    avgElevationMeters: 500,
    goals: {
      conservative: 200, // miles
      target: 300,
      stretch: 400,
    },
  },
  workout: {
    fillLevel: "full",
    activityRate: 0.4, // ~40% of days
    avgDistanceMeters: 0, // Time-based sport
    distanceVariance: 0,
    avgDurationSeconds: 3600, // 1 hour
    durationVariance: 0.3,
    goals: {
      conservative: 150, // hours
      target: 200,
      stretch: 250,
    },
  },
};

/**
 * Get the display name for a sport
 */
export const DEMO_SPORT_LABELS: Record<DemoSport, string> = {
  cycling: "Cycling",
  running: "Running",
  yoga: "Yoga",
  hiking: "Hiking",
  workout: "Workout",
};

/**
 * Strava activity types for demo data
 */
export const DEMO_STRAVA_TYPES: Record<DemoSport, string> = {
  cycling: "Ride",
  running: "Run",
  yoga: "Yoga",
  hiking: "Hike",
  workout: "Workout",
};
