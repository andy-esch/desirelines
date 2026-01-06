/**
 * Demo Data Generator
 *
 * Generates realistic-looking demo data for the demo experience.
 * Data is generated fresh on each call, creating variety between page loads.
 */

import type { MetricsEntry, ActivitySummary } from "../api/activities";
import {
  DEMO_SPORT_CONFIG,
  DEMO_STRAVA_TYPES,
  type DemoSport,
  type FillLevel,
} from "../constants/demoConfig";

// Re-export types for consumers
export type { DemoSport, FillLevel };

// =============================================================================
// Constants
// =============================================================================

/**
 * Fill level probability thresholds.
 * Distribution: 50% full, 30% partial, 20% empty
 */
const FILL_LEVEL_THRESHOLDS = {
  FULL: 0.5, // 0 to 0.5 = full (50%)
  PARTIAL: 0.8, // 0.5 to 0.8 = partial (30%)
  // 0.8 to 1.0 = empty (20%)
} as const;

/**
 * Partial fill level configuration.
 * When fill level is "partial", activities start later and are less frequent.
 */
const PARTIAL_FILL_CONFIG = {
  ACTIVITY_RATE_MULTIPLIER: 0.5, // Half the normal activity rate
  YEAR_START_OFFSET: 0.6, // Start activities after 60% of the year
} as const;

/**
 * Activity generation parameters.
 */
const ACTIVITY_PARAMS = {
  WEEKEND_BONUS: 1.3, // 30% more likely to exercise on weekends
  ELEVATION_VARIANCE: 0.5, // ±50% variance for elevation
  HOUR_RANGE_START: 6, // Activities start at 6 AM
  HOUR_RANGE_SPAN: 14, // Activities can occur over 14 hours (6 AM to 8 PM)
} as const;

/**
 * Activity list generation limits.
 */
const ACTIVITY_LIST_LIMITS = {
  PARTIAL_MAX_DAYS_BACK: 60, // Only show recent 60 days for partial fill
  FULL_MAX_DAYS_BACK: 180, // Show up to 180 days for full fill
} as const;

/**
 * Milliseconds in one day - used for date arithmetic.
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Randomly select a fill level for demo variety.
 * Weighted distribution: 50% full, 30% partial, 20% empty
 */
function randomFillLevel(): FillLevel {
  const r = Math.random();
  if (r < FILL_LEVEL_THRESHOLDS.FULL) return "full";
  if (r < FILL_LEVEL_THRESHOLDS.PARTIAL) return "partial";
  return "empty";
}

/**
 * Generate coordinated fill levels for all sports.
 * Ensures at most ONE sport has empty state (for better demo UX).
 *
 * @returns Record of sport to fill level
 */
export function generateCoordinatedFillLevels(): Record<DemoSport, FillLevel> {
  const sports = getDemoSports();

  // First pass: generate random fill levels
  const levels: Record<string, FillLevel> = {};
  for (const sport of sports) {
    levels[sport] = randomFillLevel();
  }

  // Second pass: ensure at most one is empty
  const emptyCount = Object.values(levels).filter((l) => l === "empty").length;

  if (emptyCount > 1) {
    // Pick one to stay empty, upgrade the rest to partial
    const emptySports = sports.filter((s) => levels[s] === "empty");
    const keepEmpty = emptySports[Math.floor(Math.random() * emptySports.length)];

    for (const sport of emptySports) {
      if (sport !== keepEmpty) {
        levels[sport] = "partial";
      }
    }
  }

  return levels as Record<DemoSport, FillLevel>;
}

/**
 * Get a random element from an array
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a value with variance
 */
function withVariance(base: number, variance: number): number {
  const multiplier = 1 + (Math.random() * 2 - 1) * variance;
  return Math.max(0, base * multiplier);
}

/**
 * Get the number of days from start of year to a given date
 */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Format a date as YYYY-MM-DD (using local date, not UTC)
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a date as ISO timestamp
 */
function formatTimestamp(date: Date): string {
  return date.toISOString();
}

/**
 * Generate cumulative metrics for a sport.
 *
 * Returns an array of MetricsEntry representing cumulative totals per day.
 * The data grows realistically from Jan 1 to "today".
 *
 * Fill level is randomly selected on each call unless overridden,
 * creating variety between page loads.
 */
export function generateDemoMetrics(
  sport: DemoSport,
  year: number,
  overrideFillLevel?: FillLevel
): MetricsEntry[] {
  const config = DEMO_SPORT_CONFIG[sport];

  // Use override if provided, otherwise randomly select fill level
  const fillLevel = overrideFillLevel ?? randomFillLevel();

  // Empty fill level returns no data
  if (fillLevel === "empty") {
    return [];
  }

  const today = new Date();
  const currentYear = today.getFullYear();

  // Determine end date
  let endDate: Date;
  if (year < currentYear) {
    // Past year: full year of data
    endDate = new Date(year, 11, 31);
  } else if (year === currentYear) {
    // Current year: up to today
    endDate = today;
  } else {
    // Future year: no data
    return [];
  }

  const startDate = new Date(year, 0, 1);

  // Adjust activity rate based on fill level
  let effectiveActivityRate = config.activityRate;
  let startDayOffset = 0;

  if (fillLevel === "partial") {
    // Partial: lower activity rate, start later in the year
    effectiveActivityRate = config.activityRate * PARTIAL_FILL_CONFIG.ACTIVITY_RATE_MULTIPLIER;
    // Start activities after configured offset
    const daysInYear = getDayOfYear(endDate);
    startDayOffset = Math.floor(daysInYear * PARTIAL_FILL_CONFIG.YEAR_START_OFFSET);
  }

  const metrics: MetricsEntry[] = [];
  let cumulativeDistance = 0;
  let cumulativeTime = 0;
  let cumulativeElevation = 0;
  let cumulativeActivities = 0;

  // Generate day by day using timestamp arithmetic (avoids Date mutation)
  const endTime = endDate.getTime();
  for (let currentTime = startDate.getTime(); currentTime <= endTime; currentTime += ONE_DAY_MS) {
    const currentDate = new Date(currentTime);
    const dayOfYear = getDayOfYear(currentDate);

    // Determine if this day has activity
    let hasActivity = false;
    if (dayOfYear > startDayOffset) {
      // Weekly pattern: more likely on weekends
      const dayOfWeek = currentDate.getDay();
      const weekendBonus = dayOfWeek === 0 || dayOfWeek === 6 ? ACTIVITY_PARAMS.WEEKEND_BONUS : 1.0;

      hasActivity = Math.random() < effectiveActivityRate * weekendBonus;
    }

    if (hasActivity) {
      // Generate activity for this day
      const distance = withVariance(config.avgDistanceMeters, config.distanceVariance);
      const duration = withVariance(config.avgDurationSeconds, config.durationVariance);
      const elevation = config.avgElevationMeters
        ? withVariance(config.avgElevationMeters, ACTIVITY_PARAMS.ELEVATION_VARIANCE)
        : 0;

      cumulativeDistance += distance;
      cumulativeTime += duration;
      cumulativeElevation += elevation;
      cumulativeActivities += 1;
    }

    // Add entry for this day (cumulative values)
    const entry: MetricsEntry = {
      date: formatDate(currentDate),
      distance: Math.round(cumulativeDistance),
      time: Math.round(cumulativeTime / 60), // Convert to minutes
      activities: cumulativeActivities,
    };

    if (config.avgElevationMeters) {
      entry.elevation = Math.round(cumulativeElevation);
    }

    metrics.push(entry);
  }

  return metrics;
}

/**
 * Generate a list of recent activities for a sport.
 *
 * Returns activities from the last few weeks with realistic names and values.
 * Fill level is randomly selected on each call unless overridden.
 */
export function generateDemoActivities(
  sport: DemoSport,
  year: number,
  count: number = 20,
  overrideFillLevel?: FillLevel
): ActivitySummary[] {
  const config = DEMO_SPORT_CONFIG[sport];

  // Use override if provided, otherwise randomly select fill level
  const fillLevel = overrideFillLevel ?? randomFillLevel();

  // Empty fill level returns no activities
  if (fillLevel === "empty") {
    return [];
  }

  const today = new Date();
  const currentYear = today.getFullYear();

  // Only generate activities for current or past years
  if (year > currentYear) {
    return [];
  }

  const activities: ActivitySummary[] = [];
  let activityId = 1000000000 + Math.floor(Math.random() * 100000000);

  // Determine date range for activities
  let endDate: Date;
  if (year < currentYear) {
    endDate = new Date(year, 11, 31);
  } else {
    endDate = today;
  }

  // Generate activities going backwards from end date using timestamp arithmetic
  let currentTime = endDate.getTime();
  let activitiesGenerated = 0;
  const yearStart = new Date(year, 0, 1).getTime();

  // Adjust for partial fill - only recent activities
  const maxDaysBack =
    fillLevel === "partial"
      ? ACTIVITY_LIST_LIMITS.PARTIAL_MAX_DAYS_BACK
      : ACTIVITY_LIST_LIMITS.FULL_MAX_DAYS_BACK;
  const maxActivities = Math.min(count, maxDaysBack);

  while (activitiesGenerated < maxActivities) {
    // Skip some days based on activity rate (going backwards)
    const daysToSkip = Math.ceil(1 / (config.activityRate || 0.3));
    const daysBack = Math.floor(Math.random() * daysToSkip + 1);
    currentTime -= daysBack * ONE_DAY_MS;

    // Stop if we've gone before the start of the year
    if (currentTime < yearStart) {
      break;
    }

    // Generate activity
    const distance = withVariance(config.avgDistanceMeters, config.distanceVariance);
    const duration = withVariance(config.avgDurationSeconds, config.durationVariance);
    const elevation = config.avgElevationMeters
      ? withVariance(config.avgElevationMeters, ACTIVITY_PARAMS.ELEVATION_VARIANCE)
      : undefined;

    // Pick a time of day and create the activity date
    const hour =
      Math.floor(Math.random() * ACTIVITY_PARAMS.HOUR_RANGE_SPAN) +
      ACTIVITY_PARAMS.HOUR_RANGE_START;
    const minute = Math.floor(Math.random() * 60);
    const activityDate = new Date(currentTime);
    activityDate.setHours(hour, minute, 0, 0);

    activities.push({
      id: activityId++,
      name: randomChoice(config.activityNames),
      type: DEMO_STRAVA_TYPES[sport],
      sport: sport,
      start_date_local: formatTimestamp(activityDate),
      distance_meters: Math.round(distance),
      moving_time_seconds: Math.round(duration),
      elevation_meters: elevation ? Math.round(elevation) : undefined,
    });

    activitiesGenerated++;
  }

  // Sort by date descending (most recent first)
  activities.sort(
    (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
  );

  return activities;
}

/**
 * Generate demo goals for a sport.
 *
 * Returns goal values in display units (miles for distance sports, hours for time sports).
 */
export function generateDemoGoals(sport: DemoSport): {
  conservative: number;
  target: number;
  stretch: number;
} {
  return DEMO_SPORT_CONFIG[sport].goals;
}

/**
 * Get all demo sports (derived from config)
 */
export function getDemoSports(): DemoSport[] {
  return Object.keys(DEMO_SPORT_CONFIG) as DemoSport[];
}

/**
 * Daily activity data for demo mode (matches DailyActivity API type).
 */
export interface DemoDailyActivity {
  distanceMeters?: number;
  timeMinutes?: number;
  elevationMeters?: number;
  activities: number;
  activityIds: number[];
}

/**
 * Generate demo daily data for a sport within a date range.
 *
 * Returns a Record<string, DemoDailyActivity> keyed by date (YYYY-MM-DD).
 * Only includes days that have activity (sparse map).
 *
 * Fill level is randomly selected on each call unless overridden.
 */
export function generateDemoDailyData(
  sport: DemoSport,
  fromDate: string,
  toDate: string,
  overrideFillLevel?: FillLevel
): Record<string, DemoDailyActivity> {
  const config = DEMO_SPORT_CONFIG[sport];

  // Use override if provided, otherwise randomly select fill level
  const fillLevel = overrideFillLevel ?? randomFillLevel();

  // Empty fill level returns no data
  if (fillLevel === "empty") {
    return {};
  }

  const result: Record<string, DemoDailyActivity> = {};

  // Parse date range
  const [fromYear, fromMonth, fromDay] = fromDate.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDate.split("-").map(Number);
  const startDate = new Date(fromYear, fromMonth - 1, fromDay);
  const endDate = new Date(toYear, toMonth - 1, toDay);

  // Don't generate for future dates
  const today = new Date();
  const effectiveEnd = endDate > today ? today : endDate;

  // Adjust activity rate based on fill level
  let effectiveActivityRate = config.activityRate;
  let startDayOffset = 0;

  if (fillLevel === "partial") {
    effectiveActivityRate = config.activityRate * PARTIAL_FILL_CONFIG.ACTIVITY_RATE_MULTIPLIER;
    // For partial, only show recent activities
    const totalDays = Math.ceil((effectiveEnd.getTime() - startDate.getTime()) / ONE_DAY_MS);
    startDayOffset = Math.floor(totalDays * PARTIAL_FILL_CONFIG.YEAR_START_OFFSET);
  }

  let activityIdCounter = 2000000000 + Math.floor(Math.random() * 100000000);
  let dayIndex = 0;

  // Generate day by day
  for (
    let currentTime = startDate.getTime();
    currentTime <= effectiveEnd.getTime();
    currentTime += ONE_DAY_MS
  ) {
    dayIndex++;
    const currentDate = new Date(currentTime);

    // Skip days before start offset (for partial fill)
    if (dayIndex <= startDayOffset) {
      continue;
    }

    // Determine if this day has activity
    const dayOfWeek = currentDate.getDay();
    const weekendBonus = dayOfWeek === 0 || dayOfWeek === 6 ? ACTIVITY_PARAMS.WEEKEND_BONUS : 1.0;
    const hasActivity = Math.random() < effectiveActivityRate * weekendBonus;

    if (hasActivity) {
      // Generate 1-2 activities for this day
      const numActivities = Math.random() < 0.2 ? 2 : 1;
      const activityIds: number[] = [];

      let totalDistance = 0;
      let totalTime = 0;
      let totalElevation = 0;

      for (let i = 0; i < numActivities; i++) {
        activityIds.push(activityIdCounter++);
        totalDistance += withVariance(config.avgDistanceMeters, config.distanceVariance);
        totalTime += withVariance(config.avgDurationSeconds, config.durationVariance);
        if (config.avgElevationMeters) {
          totalElevation += withVariance(
            config.avgElevationMeters,
            ACTIVITY_PARAMS.ELEVATION_VARIANCE
          );
        }
      }

      const dateStr = formatDate(currentDate);
      const entry: DemoDailyActivity = {
        timeMinutes: Math.round(totalTime / 60),
        activities: numActivities,
        activityIds,
      };

      // Only include distance/elevation for sports that have them
      if (config.avgDistanceMeters > 0) {
        entry.distanceMeters = Math.round(totalDistance);
      }
      if (config.avgElevationMeters) {
        entry.elevationMeters = Math.round(totalElevation);
      }

      result[dateStr] = entry;
    }
  }

  return result;
}
