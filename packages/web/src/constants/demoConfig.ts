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
  /** Percentage of days with activity (0-1). Fallback when activitiesPerWeek is not set. */
  activityRate: number;
  /** Average distance per activity in meters */
  avgDistanceMeters: number;
  /** Variance in distance (multiplier, e.g., 0.3 = +/- 30%). Fallback for uniform variance. */
  distanceVariance: number;
  /** Average duration per activity in seconds */
  avgDurationSeconds: number;
  /** Variance in duration. Fallback for uniform variance. */
  durationVariance: number;
  /** Average elevation per activity in meters (optional) */
  avgElevationMeters?: number | undefined;
  /** Demo goal values (in display units: miles for cycling/running, hours for yoga) */
  goals: {
    conservative: number;
    target: number;
    stretch: number;
  };
  /** Avg activities per week (Poisson lambda). Falls back to activityRate * 7. */
  activitiesPerWeek?: number | undefined;
  /** Log-normal sigma for distance spread (default 0.4) */
  distanceSigma?: number | undefined;
  /** Log-normal sigma for duration spread (default 0.3) */
  durationSigma?: number | undefined;
  /** Weekly volume in display units (miles for distance sports, hours for time sports).
   *  Used by the tuning panel — avgDistanceMeters/avgDurationSeconds are derived from this. */
  weeklyVolume?: number | undefined;
  /** Rest/training cycle pattern. onWeeks active, then offWeeks rest (no activities).
   *  Omit for always-on sports (e.g., yoga). */
  restPattern?: { onWeeks: number; offWeeks: number } | undefined;
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
    activityRate: 0.57, // 4/7 ≈ 57% of days
    avgDistanceMeters: 32187, // 80 mi/wk ÷ 4 rides = 20 mi/ride
    distanceVariance: 0.4,
    avgDurationSeconds: 4800, // ~1.3 hr (20 mi @ ~15 mph)
    durationVariance: 0.3,
    avgElevationMeters: 300,
    goals: {
      conservative: 3500,
      target: 4000,
      stretch: 5000,
    },
    activitiesPerWeek: 4,
    distanceSigma: 0.4,
    durationSigma: 0.3,
    weeklyVolume: 80, // miles
    restPattern: { onWeeks: 4, offWeeks: 1 },
  },
  running: {
    fillLevel: "partial",
    activityRate: 0.43, // 3/7 ≈ 43% of days
    avgDistanceMeters: 6437, // 12 mi/wk ÷ 3 runs = 4 mi/run
    distanceVariance: 0.5,
    avgDurationSeconds: 2400, // ~40 min (4 mi @ ~10 min/mi)
    durationVariance: 0.3,
    avgElevationMeters: 50,
    goals: {
      conservative: 500,
      target: 625,
      stretch: 800,
    },
    activitiesPerWeek: 3,
    distanceSigma: 0.5,
    durationSigma: 0.3,
    weeklyVolume: 12, // miles
    restPattern: { onWeeks: 3, offWeeks: 1 },
  },
  yoga: {
    fillLevel: "empty",
    activityRate: 0.29, // 2/7 ≈ 29% of days
    avgDistanceMeters: 0,
    distanceVariance: 0,
    avgDurationSeconds: 3600, // 2 hr/wk ÷ 2 sessions = 1 hr
    durationVariance: 0.2,
    goals: {
      conservative: 80,
      target: 100,
      stretch: 150,
    },
    activitiesPerWeek: 2,
    durationSigma: 0.2,
    weeklyVolume: 2, // hours
  },
  hiking: {
    fillLevel: "full",
    activityRate: 0.14, // 1/7 ≈ 14% of days
    avgDistanceMeters: 12875, // 8 mi/wk ÷ 1 hike = 8 mi
    distanceVariance: 0.5,
    avgDurationSeconds: 10800, // ~3 hours
    durationVariance: 0.4,
    avgElevationMeters: 500,
    goals: {
      conservative: 300,
      target: 400,
      stretch: 500,
    },
    activitiesPerWeek: 1,
    distanceSigma: 0.5,
    durationSigma: 0.4,
    weeklyVolume: 8, // miles
    restPattern: { onWeeks: 1, offWeeks: 5 },
  },
  workout: {
    fillLevel: "full",
    activityRate: 0.43, // 3/7 ≈ 43% of days
    avgDistanceMeters: 0,
    distanceVariance: 0,
    avgDurationSeconds: 3600, // 3 hr/wk ÷ 3 sessions = 1 hr
    durationVariance: 0.3,
    goals: {
      conservative: 120,
      target: 156,
      stretch: 200,
    },
    activitiesPerWeek: 3,
    durationSigma: 0.3,
    weeklyVolume: 3, // hours
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
