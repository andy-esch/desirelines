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

/**
 * Create a random number generator.
 * Uses Math.random() for truly random data on each page load.
 */
function createRandom(): () => number {
  return () => Math.random();
}

/**
 * Randomly select a fill level for demo variety.
 * Weighted distribution: 50% full, 30% partial, 20% empty
 */
function randomFillLevel(random: () => number): FillLevel {
  const r = random();
  if (r < 0.5) return "full";
  if (r < 0.8) return "partial";
  return "empty";
}

/**
 * Generate coordinated fill levels for all sports.
 * Ensures at most ONE sport has empty state (for better demo UX).
 *
 * @returns Record of sport to fill level
 */
export function generateCoordinatedFillLevels(): Record<DemoSport, FillLevel> {
  const random = createRandom();
  const sports = getDemoSports();

  // First pass: generate random fill levels
  const levels: Record<string, FillLevel> = {};
  for (const sport of sports) {
    levels[sport] = randomFillLevel(random);
  }

  // Second pass: ensure at most one is empty
  const emptyCount = Object.values(levels).filter((l) => l === "empty").length;

  if (emptyCount > 1) {
    // Pick one to stay empty, upgrade the rest to partial
    const emptySports = sports.filter((s) => levels[s] === "empty");
    const keepEmpty = emptySports[Math.floor(random() * emptySports.length)];

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
function randomChoice<T>(arr: T[], random: () => number): T {
  return arr[Math.floor(random() * arr.length)];
}

/**
 * Generate a value with variance
 */
function withVariance(base: number, variance: number, random: () => number): number {
  const multiplier = 1 + (random() * 2 - 1) * variance;
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
  const random = createRandom();

  // Use override if provided, otherwise randomly select fill level
  const fillLevel = overrideFillLevel ?? randomFillLevel(random);

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
    effectiveActivityRate = config.activityRate * 0.5;
    // Start activities after ~60% of the year
    const daysInYear = getDayOfYear(endDate);
    startDayOffset = Math.floor(daysInYear * 0.6);
  }

  const metrics: MetricsEntry[] = [];
  let cumulativeDistance = 0;
  let cumulativeTime = 0;
  let cumulativeElevation = 0;
  let cumulativeActivities = 0;

  // Generate day by day
  const current = new Date(startDate);
  while (current <= endDate) {
    const dayOfYear = getDayOfYear(current);

    // Determine if this day has activity
    let hasActivity = false;
    if (dayOfYear > startDayOffset) {
      // Weekly pattern: less likely on certain days
      const dayOfWeek = current.getDay();
      const weekendBonus = dayOfWeek === 0 || dayOfWeek === 6 ? 1.3 : 1.0;

      hasActivity = random() < effectiveActivityRate * weekendBonus;
    }

    if (hasActivity) {
      // Generate activity for this day
      const distance = withVariance(config.avgDistanceMeters, config.distanceVariance, random);
      const duration = withVariance(config.avgDurationSeconds, config.durationVariance, random);
      const elevation = config.avgElevationMeters
        ? withVariance(config.avgElevationMeters, 0.5, random)
        : 0;

      cumulativeDistance += distance;
      cumulativeTime += duration;
      cumulativeElevation += elevation;
      cumulativeActivities += 1;
    }

    // Add entry for this day (cumulative values)
    const entry: MetricsEntry = {
      date: formatDate(current),
      distance: Math.round(cumulativeDistance),
      time: Math.round(cumulativeTime / 60), // Convert to minutes
      activities: cumulativeActivities,
    };

    if (config.avgElevationMeters) {
      entry.elevation = Math.round(cumulativeElevation);
    }

    metrics.push(entry);

    // Move to next day
    current.setDate(current.getDate() + 1);
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
  const random = createRandom();

  // Use override if provided, otherwise randomly select fill level
  const fillLevel = overrideFillLevel ?? randomFillLevel(random);

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
  let activityId = 1000000000 + Math.floor(random() * 100000000);

  // Determine date range for activities
  let endDate: Date;
  if (year < currentYear) {
    endDate = new Date(year, 11, 31);
  } else {
    endDate = today;
  }

  // Generate activities going backwards from end date
  const current = new Date(endDate);
  let activitiesGenerated = 0;

  // Adjust for partial fill - only recent activities
  // Cap activities to prevent generating too many (use maxDaysBack as upper bound)
  const maxDaysBack = fillLevel === "partial" ? 60 : 180;
  const maxActivities = Math.min(count, maxDaysBack);

  while (activitiesGenerated < maxActivities) {
    // Skip some days based on activity rate
    const daysToSkip = Math.ceil(1 / (config.activityRate || 0.3));
    current.setDate(current.getDate() - Math.floor(random() * daysToSkip + 1));

    // Stop if we've gone too far back
    if (current.getFullYear() < year) {
      break;
    }

    // Generate activity
    const distance = withVariance(config.avgDistanceMeters, config.distanceVariance, random);
    const duration = withVariance(config.avgDurationSeconds, config.durationVariance, random);
    const elevation = config.avgElevationMeters
      ? withVariance(config.avgElevationMeters, 0.5, random)
      : undefined;

    // Pick a time of day
    const hour = Math.floor(random() * 14) + 6; // 6am to 8pm
    const activityDate = new Date(current);
    activityDate.setHours(hour, Math.floor(random() * 60), 0, 0);

    activities.push({
      id: activityId++,
      name: randomChoice(config.activityNames, random),
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
