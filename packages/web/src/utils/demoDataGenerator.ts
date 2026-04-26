/**
 * Demo Data Generator
 *
 * Generates realistic-looking demo data for the demo experience.
 * Fill levels are coordinated per session (stored in sessionStorage) to ensure
 * consistent data across all components within a browser session.
 * Refreshing the page generates a new random distribution.
 *
 * Supports any sport from the API's sport_types.json - unknown sports get
 * sensible defaults based on their has_distance/has_elevation properties.
 */

import type { MetricsEntry, ActivitySummary } from "../api/activities";
import {
  DEMO_SPORT_CONFIG,
  DEMO_STRAVA_TYPES,
  type DemoSportConfig,
  type FillLevel,
} from "../constants/demoConfig";
import { generateActivityName } from "./activityNameGenerator";
import { toLocalDateString } from "./dateUtils";
import { logNormal, poisson } from "./distributions";
import type { SportMetricsInfo } from "./sportConfig";

// Re-export types for consumers
export type { FillLevel };

/**
 * Tuning parameters for distribution calibration.
 * Used by the Dashboard to override per-sport config defaults at runtime.
 */
export interface TuningParams {
  distanceSigma?: number;
  durationSigma?: number;
  activitiesPerWeek?: number;
  /** Scale factor applied to each sport's configured activitiesPerWeek (e.g., 1.5 = 50% more).
   *  Used by the dashboard panel so each sport keeps its own base rate. */
  activitiesPerWeekMultiplier?: number;
  /** Override per-activity average distance (meters) */
  avgDistanceMeters?: number;
  /** Override per-activity average duration (seconds) */
  avgDurationSeconds?: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Fill level probability thresholds.
 * Distribution: 60% full, 15% partial, 25% empty
 * Note: generateCoordinatedFillLevels() caps empty at 1 sport max,
 * so effective distribution is ~75% with data, ~25% empty (max 1).
 */
const FILL_LEVEL_THRESHOLDS = {
  FULL: 0.6, // 0 to 0.6 = full (60%)
  PARTIAL: 0.75, // 0.6 to 0.75 = partial (15%)
  // 0.75 to 1.0 = empty (25%, capped at 1)
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

/**
 * Session storage key for coordinated fill levels.
 * Ensures consistent demo experience within a browser session.
 */
const SESSION_FILL_LEVELS_KEY = "demo-fill-levels";

/**
 * Session storage key for cached activity counts.
 * Avoids regenerating full metrics arrays just to get counts.
 */
const SESSION_ACTIVITY_COUNTS_KEY = "demo-activity-counts";

// =============================================================================
// Session Storage for Fill Levels
// =============================================================================

interface StoredFillLevels {
  sports: string[];
  levels: Record<string, FillLevel>;
}

/**
 * Get coordinated fill levels from session storage, or generate and store new ones.
 * This ensures all demo components see the same fill levels within a session.
 *
 * @param sports - List of sports to generate levels for. If the stored sports
 *                 don't match, new levels are generated.
 */
export function getSessionFillLevels(sports?: string[]): Record<string, FillLevel> {
  const targetSports = sports ?? getDemoSports();
  // Sort a copy to avoid mutating the input array
  const targetKey = [...targetSports].sort().join(",");

  // Try to read from session storage
  try {
    const stored = sessionStorage.getItem(SESSION_FILL_LEVELS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StoredFillLevels> | null;
      // Validate structure before using
      if (Array.isArray(parsed?.sports) && parsed?.levels && typeof parsed.levels === "object") {
        // Sort a copy to avoid mutating stored data
        const storedKey = [...parsed.sports].sort().join(",");

        // If sports match, use stored levels
        if (storedKey === targetKey) {
          return parsed.levels;
        }
      }
      // Sports changed or invalid data - regenerate
    }
  } catch {
    // Session storage not available or invalid data - generate fresh
  }

  // Generate new coordinated levels and store them
  const levels = generateCoordinatedFillLevelsForSports(targetSports);
  try {
    const toStore: StoredFillLevels = { sports: [...targetSports], levels };
    sessionStorage.setItem(SESSION_FILL_LEVELS_KEY, JSON.stringify(toStore));
  } catch {
    // Storage full or not available - still return the levels
  }
  return levels;
}

/**
 * Get the fill level for a specific sport from session storage.
 * Falls back to "full" if sport not found (safe default for demo).
 *
 * @param sport - Sport key
 * @param allSports - Optional list of all sports (for generating coordinated levels)
 */
function getSessionFillLevelForSport(sport: string, allSports?: string[]): FillLevel {
  const levels = getSessionFillLevels(allSports);
  return levels[sport] ?? "full";
}

// =============================================================================
// Cached Activity Counts
// =============================================================================

interface CachedActivityCounts {
  year: number;
  sportsKey: string;
  counts: Record<string, number>;
}

/**
 * Options for getDemoActivityCounts
 */
export interface GetDemoActivityCountsOptions {
  /** Sports to get counts for (defaults to getDemoSports()) */
  sports?: string[] | undefined;
  /** Sport info for generating defaults for unknown sports */
  sportInfoMap?: Record<string, SportMetricsInfo> | undefined;
}

/**
 * Get cached activity counts for demo sports.
 * Generates and caches counts on first call for each year/sports combination.
 * This avoids regenerating full metrics arrays just to get sidebar counts.
 *
 * @param year - The year to get counts for
 * @param options - Optional sports list and sport info
 * @returns Record of sport to activity count
 */
export function getDemoActivityCounts(
  year: number,
  options?: GetDemoActivityCountsOptions
): Record<string, number> {
  const sports = options?.sports ?? getDemoSports();
  const sportsKey = [...sports].sort().join(",");

  // Try to read from cache
  try {
    const stored = sessionStorage.getItem(SESSION_ACTIVITY_COUNTS_KEY);
    if (stored) {
      const cached = JSON.parse(stored) as Partial<CachedActivityCounts> | null;
      if (
        cached?.year === year &&
        cached?.sportsKey === sportsKey &&
        cached?.counts &&
        typeof cached.counts === "object"
      ) {
        return cached.counts;
      }
    }
  } catch {
    // Cache miss or invalid data
  }

  // Get coordinated fill levels for these sports
  const fillLevels = getSessionFillLevels(sports);
  const counts: Record<string, number> = {};

  for (const sport of sports) {
    const fillLevel = fillLevels[sport] ?? "full";

    if (fillLevel === "empty") {
      counts[sport] = 0;
    } else {
      const sportInfo = options?.sportInfoMap?.[sport];
      const metrics = generateDemoMetrics(sport, year, {
        sportInfo,
        allSports: sports,
        overrideFillLevel: fillLevel,
      });
      const lastEntry = metrics[metrics.length - 1];
      counts[sport] = lastEntry?.activities ?? 0;
    }
  }

  // Cache for this year/sports
  try {
    const toCache: CachedActivityCounts = { year, sportsKey, counts };
    sessionStorage.setItem(SESSION_ACTIVITY_COUNTS_KEY, JSON.stringify(toCache));
  } catch {
    // Storage full or not available
  }

  return counts;
}

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
 * Generate coordinated fill levels for a list of sports.
 * Ensures at most ONE sport has empty state (for better demo UX).
 *
 * @param sports - List of sport keys to generate levels for
 * @returns Record of sport to fill level
 */
export function generateCoordinatedFillLevelsForSports(
  sports: string[]
): Record<string, FillLevel> {
  // First pass: generate random fill levels
  const levels: Record<string, FillLevel> = {};
  for (const sport of sports) {
    levels[sport] = randomFillLevel();
  }

  // Second pass: ensure at most one is empty
  const emptyCount = Object.values(levels).filter((l) => l === "empty").length;

  if (emptyCount > 1) {
    // Pick one to stay empty, upgrade the rest to full (not partial, since partial looks sparse)
    const emptySports = sports.filter((s) => levels[s] === "empty");
    const keepEmpty = emptySports[Math.floor(Math.random() * emptySports.length)];

    for (const sport of emptySports) {
      if (sport !== keepEmpty) {
        levels[sport] = "full";
      }
    }
  }

  return levels;
}

/**
 * Generate coordinated fill levels for default demo sports.
 * @deprecated Use generateCoordinatedFillLevelsForSports with explicit sport list
 */
export function generateCoordinatedFillLevels(): Record<string, FillLevel> {
  return generateCoordinatedFillLevelsForSports(getDemoSports());
}

/**
 * Generate a value with uniform variance (used for elevation).
 */
function withUniformVariance(base: number, variance: number): number {
  const multiplier = 1 + (Math.random() * 2 - 1) * variance;
  return Math.max(0, base * multiplier);
}

/**
 * Sample a value from a log-normal distribution.
 * Falls back to uniform variance if sigma is not provided.
 */
function sampleValue(mean: number, sigma: number): number {
  if (mean <= 0) return 0;
  return logNormal(mean, sigma);
}

/**
 * Generate a Poisson-based activity schedule for a date range.
 * Returns a Set of day-of-year indices that have activities.
 *
 * When a restPattern is provided, weeks cycle through on/off phases:
 * e.g. { onWeeks: 3, offWeeks: 1 } → 3 active weeks, then 1 rest week, repeat.
 */
function generateActivitySchedule(
  startDay: number,
  endDay: number,
  activitiesPerWeek: number,
  year: number,
  restPattern?: { onWeeks: number; offWeeks: number }
): Set<number> {
  const activityDays = new Set<number>();
  const cycleLength = restPattern ? restPattern.onWeeks + restPattern.offWeeks : 0;

  // Iterate week by week (7-day blocks)
  let weekIndex = 0;
  for (let weekStart = startDay; weekStart <= endDay; weekStart += 7) {
    // Check if this is a rest week
    if (restPattern && cycleLength > 0) {
      const positionInCycle = weekIndex % cycleLength;
      if (positionInCycle >= restPattern.onWeeks) {
        // Rest week — skip activity generation
        weekIndex++;
        continue;
      }
    }

    const weekEnd = Math.min(weekStart + 6, endDay);
    const daysInWeek = weekEnd - weekStart + 1;
    // Scale lambda for partial weeks at boundaries
    const lambda = activitiesPerWeek * (daysInWeek / 7);
    const count = Math.min(poisson(lambda), daysInWeek);

    // Pick `count` random days from this week (uniform, no duplicates)
    const weekDays: number[] = [];
    for (let d = weekStart; d <= weekEnd; d++) {
      weekDays.push(d);
    }
    // Fisher-Yates shuffle, pick first `count`
    for (let i = weekDays.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = weekDays[i];
      const b = weekDays[j];
      if (a !== undefined && b !== undefined) {
        weekDays[i] = b;
        weekDays[j] = a;
      }
    }
    for (let i = 0; i < count; i++) {
      const day = weekDays[i];
      if (day !== undefined) activityDays.add(day);
    }

    weekIndex++;
  }
  // Suppress unused parameter lint — year reserved for future seasonal weighting
  void year;
  return activityDays;
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
 * Format a date as ISO timestamp
 */
function formatTimestamp(date: Date): string {
  return date.toISOString();
}

// =============================================================================
// Sport Config Helpers
// =============================================================================

/**
 * Default config for distance-based sports (running, hiking, etc.)
 */
const DEFAULT_DISTANCE_SPORT_CONFIG: DemoSportConfig = {
  fillLevel: "full",
  activityRate: 0.3,
  avgDistanceMeters: 10000, // ~6 miles
  distanceVariance: 0.4,
  avgDurationSeconds: 3600, // 1 hour
  durationVariance: 0.3,
  avgElevationMeters: 100,
  goals: { conservative: 500, target: 750, stretch: 1000 },
};

/**
 * Default config for time-based sports (yoga, workout, etc.)
 */
const DEFAULT_TIME_SPORT_CONFIG: DemoSportConfig = {
  fillLevel: "full",
  activityRate: 0.25,
  avgDistanceMeters: 0,
  distanceVariance: 0,
  avgDurationSeconds: 3600, // 1 hour
  durationVariance: 0.3,
  goals: { conservative: 100, target: 150, stretch: 200 }, // hours
};

/**
 * Get demo config for a sport.
 *
 * Returns the hardcoded config if available, otherwise generates sensible
 * defaults based on sport properties from the API config.
 *
 * @param sport - Sport key
 * @param sportInfo - Optional sport info from API (has_distance, has_elevation)
 */
export function getDemoConfigForSport(
  sport: string,
  sportInfo?: SportMetricsInfo
): DemoSportConfig {
  // Use hardcoded config if available
  if (sport in DEMO_SPORT_CONFIG) {
    return DEMO_SPORT_CONFIG[sport as keyof typeof DEMO_SPORT_CONFIG];
  }

  // Generate defaults based on sport properties
  const hasDistance = sportInfo?.hasDistance ?? false;
  const hasElevation = sportInfo?.hasElevation ?? false;

  if (hasDistance) {
    return {
      ...DEFAULT_DISTANCE_SPORT_CONFIG,
      avgElevationMeters: hasElevation ? 100 : undefined,
    };
  }

  return DEFAULT_TIME_SPORT_CONFIG;
}

/**
 * Get Strava type for a sport.
 * Falls back to capitalized sport name if not in the mapping.
 */
function getStravaTypeForSport(sport: string): string {
  if (sport in DEMO_STRAVA_TYPES) {
    return DEMO_STRAVA_TYPES[sport as keyof typeof DEMO_STRAVA_TYPES];
  }
  // Capitalize first letter as fallback
  return sport.charAt(0).toUpperCase() + sport.slice(1);
}

// =============================================================================
// Demo Data Generation
// =============================================================================

/**
 * Options for generateDemoMetrics
 */
export interface GenerateDemoMetricsOptions {
  /** Override fill level (for testing) */
  overrideFillLevel?: FillLevel | undefined;
  /** Sport info from API (for generating defaults for unknown sports) */
  sportInfo?: SportMetricsInfo | undefined;
  /** All sports in the session (for coordinated fill levels) */
  allSports?: string[] | undefined;
  /** Tuning overrides for distribution parameters */
  tuningParams?: TuningParams | undefined;
}

/**
 * Generate cumulative metrics for a sport.
 *
 * Returns an array of MetricsEntry representing cumulative totals per day.
 * The data grows realistically from Jan 1 to "today".
 *
 * Fill level is coordinated per session (stored in sessionStorage) to ensure
 * consistent demo experience. Override with explicit fill level for testing.
 *
 * Supports any sport - unknown sports get sensible defaults based on sportInfo.
 */
export function generateDemoMetrics(
  sport: string,
  year: number,
  options?: GenerateDemoMetricsOptions | FillLevel
): MetricsEntry[] {
  // Handle legacy signature: generateDemoMetrics(sport, year, fillLevel)
  const opts: GenerateDemoMetricsOptions =
    typeof options === "string" ? { overrideFillLevel: options } : (options ?? {});

  const config = getDemoConfigForSport(sport, opts.sportInfo);

  // Use override if provided, otherwise use session-coordinated fill level
  const fillLevel = opts.overrideFillLevel ?? getSessionFillLevelForSport(sport, opts.allSports);

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

  // Resolve distribution parameters (tuning > config > defaults)
  const distSigma = opts.tuningParams?.distanceSigma ?? config.distanceSigma ?? 0.4;
  const durSigma = opts.tuningParams?.durationSigma ?? config.durationSigma ?? 0.3;
  const baseApw =
    opts.tuningParams?.activitiesPerWeek ?? config.activitiesPerWeek ?? config.activityRate * 7;
  const apw = baseApw * (opts.tuningParams?.activitiesPerWeekMultiplier ?? 1);

  // Determine start offset for partial fill
  let startDayOffset = 0;
  if (fillLevel === "partial") {
    const daysInYear = getDayOfYear(endDate);
    startDayOffset = Math.floor(daysInYear * PARTIAL_FILL_CONFIG.YEAR_START_OFFSET);
  }

  // Effective activities/week for partial fill
  const effectiveApw =
    fillLevel === "partial" ? apw * PARTIAL_FILL_CONFIG.ACTIVITY_RATE_MULTIPLIER : apw;

  // Pre-compute Poisson-based activity schedule
  const startDay = startDayOffset + 1;
  const endDay = getDayOfYear(endDate);
  const activityDays = generateActivitySchedule(
    startDay,
    endDay,
    effectiveApw,
    year,
    config.restPattern
  );

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

    if (activityDays.has(dayOfYear)) {
      // Generate activity values using log-normal distributions
      const avgDist = opts.tuningParams?.avgDistanceMeters ?? config.avgDistanceMeters;
      const avgDur = opts.tuningParams?.avgDurationSeconds ?? config.avgDurationSeconds;
      const distance = sampleValue(avgDist, distSigma);
      const duration = sampleValue(avgDur, durSigma);
      const elevation = config.avgElevationMeters
        ? withUniformVariance(config.avgElevationMeters, ACTIVITY_PARAMS.ELEVATION_VARIANCE)
        : 0;

      cumulativeDistance += distance;
      cumulativeTime += duration;
      cumulativeElevation += elevation;
      cumulativeActivities += 1;
    }

    // Add entry for this day (cumulative values)
    const entry: MetricsEntry = {
      date: toLocalDateString(currentDate),
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
 * Options for generateDemoActivities
 */
export interface GenerateDemoActivitiesOptions {
  /** Number of activities to generate */
  count?: number | undefined;
  /** Override fill level (for testing) */
  overrideFillLevel?: FillLevel | undefined;
  /** Sport info from API (for generating defaults for unknown sports) */
  sportInfo?: SportMetricsInfo | undefined;
  /** All sports in the session (for coordinated fill levels) */
  allSports?: string[] | undefined;
}

/**
 * Generate a list of recent activities for a sport.
 *
 * Returns activities from the last few weeks with realistic names and values.
 * Fill level is coordinated per session for consistent demo experience.
 *
 * Supports any sport - unknown sports get sensible defaults based on sportInfo.
 */
export function generateDemoActivities(
  sport: string,
  year: number,
  countOrOptions?: number | GenerateDemoActivitiesOptions,
  overrideFillLevel?: FillLevel
): ActivitySummary[] {
  // Handle both old and new signatures
  const opts: GenerateDemoActivitiesOptions =
    typeof countOrOptions === "number"
      ? { count: countOrOptions, overrideFillLevel }
      : (countOrOptions ?? {});

  const count = opts.count ?? 20;
  const config = getDemoConfigForSport(sport, opts.sportInfo);

  // Use override if provided, otherwise use session-coordinated fill level
  const fillLevel = opts.overrideFillLevel ?? getSessionFillLevelForSport(sport, opts.allSports);

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

    // Generate activity using log-normal distributions
    const distSigma = config.distanceSigma ?? 0.4;
    const durSigma = config.durationSigma ?? 0.3;
    const distance = sampleValue(config.avgDistanceMeters, distSigma);
    const duration = sampleValue(config.avgDurationSeconds, durSigma);
    const elevation = config.avgElevationMeters
      ? withUniformVariance(config.avgElevationMeters, ACTIVITY_PARAMS.ELEVATION_VARIANCE)
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
      name: generateActivityName(sport, hour),
      type: getStravaTypeForSport(sport),
      sport: sport,
      startDateLocal: formatTimestamp(activityDate),
      distanceMeters: Math.round(distance),
      movingTimeSeconds: Math.round(duration),
      elevationMeters: elevation ? Math.round(elevation) : undefined,
    });

    activitiesGenerated++;
  }

  // Sort by date descending (most recent first)
  activities.sort(
    (a, b) => new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
  );

  return activities;
}

/**
 * Generate demo goals for a sport.
 *
 * Returns goal values in display units (miles for distance sports, hours for time sports).
 * Supports any sport - unknown sports get sensible defaults.
 */
export function generateDemoGoals(
  sport: string,
  sportInfo?: SportMetricsInfo
): {
  conservative: number;
  target: number;
  stretch: number;
} {
  const config = getDemoConfigForSport(sport, sportInfo);
  return config.goals;
}

/**
 * Get default demo sports (from hardcoded config).
 * For dynamic sports, use the API's sport config instead.
 */
export function getDemoSports(): string[] {
  return Object.keys(DEMO_SPORT_CONFIG);
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
 * Options for generateDemoDailyData
 */
export interface GenerateDemoDailyDataOptions {
  /** Override fill level (for testing) */
  overrideFillLevel?: FillLevel | undefined;
  /** Sport info from API (for generating defaults for unknown sports) */
  sportInfo?: SportMetricsInfo | undefined;
  /** All sports in the session (for coordinated fill levels) */
  allSports?: string[] | undefined;
  /** Tuning overrides for distribution parameters */
  tuningParams?: TuningParams | undefined;
}

/**
 * Generate demo daily data for a sport within a date range.
 *
 * Returns a Record<string, DemoDailyActivity> keyed by date (YYYY-MM-DD).
 * Only includes days that have activity (sparse map).
 *
 * Fill level is coordinated per session for consistent demo experience.
 * Supports any sport - unknown sports get sensible defaults based on sportInfo.
 */
export function generateDemoDailyData(
  sport: string,
  fromDate: string,
  toDate: string,
  options?: GenerateDemoDailyDataOptions | FillLevel
): Record<string, DemoDailyActivity> {
  // Handle legacy signature
  const opts: GenerateDemoDailyDataOptions =
    typeof options === "string" ? { overrideFillLevel: options } : (options ?? {});

  const config = getDemoConfigForSport(sport, opts.sportInfo);

  // Use override if provided, otherwise use session-coordinated fill level
  const fillLevel = opts.overrideFillLevel ?? getSessionFillLevelForSport(sport, opts.allSports);

  // Empty fill level returns no data
  if (fillLevel === "empty") {
    return {};
  }

  const result: Record<string, DemoDailyActivity> = {};

  // Parse date range
  const fromParts = fromDate.split("-").map(Number);
  const toParts = toDate.split("-").map(Number);
  const [fromYear = 0, fromMonth = 1, fromDay = 1] = fromParts;
  const [toYear = 0, toMonth = 1, toDay = 1] = toParts;
  const startDate = new Date(fromYear, fromMonth - 1, fromDay);
  const endDate = new Date(toYear, toMonth - 1, toDay);

  // Don't generate for future dates
  const today = new Date();
  const effectiveEnd = endDate > today ? today : endDate;

  // Resolve distribution parameters
  const distSigma = opts.tuningParams?.distanceSigma ?? config.distanceSigma ?? 0.4;
  const durSigma = opts.tuningParams?.durationSigma ?? config.durationSigma ?? 0.3;
  const baseApw =
    opts.tuningParams?.activitiesPerWeek ?? config.activitiesPerWeek ?? config.activityRate * 7;
  const apw = baseApw * (opts.tuningParams?.activitiesPerWeekMultiplier ?? 1);

  let startDayOffset = 0;
  if (fillLevel === "partial") {
    const totalDays = Math.ceil((effectiveEnd.getTime() - startDate.getTime()) / ONE_DAY_MS);
    startDayOffset = Math.floor(totalDays * PARTIAL_FILL_CONFIG.YEAR_START_OFFSET);
  }

  const effectiveApw =
    fillLevel === "partial" ? apw * PARTIAL_FILL_CONFIG.ACTIVITY_RATE_MULTIPLIER : apw;

  // Pre-compute Poisson-based activity schedule (using day indices relative to range)
  const totalDays = Math.ceil((effectiveEnd.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
  const scheduleStart = startDayOffset + 1;
  const activityDays = generateActivitySchedule(
    scheduleStart,
    totalDays,
    effectiveApw,
    fromYear,
    config.restPattern
  );

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

    if (activityDays.has(dayIndex)) {
      // Generate 1-2 activities for this day
      const numActivities = Math.random() < 0.2 ? 2 : 1;
      const activityIds: number[] = [];

      let totalDistance = 0;
      let totalTime = 0;
      let totalElevation = 0;

      const avgDist = opts.tuningParams?.avgDistanceMeters ?? config.avgDistanceMeters;
      const avgDur = opts.tuningParams?.avgDurationSeconds ?? config.avgDurationSeconds;
      for (let i = 0; i < numActivities; i++) {
        activityIds.push(activityIdCounter++);
        totalDistance += sampleValue(avgDist, distSigma);
        totalTime += sampleValue(avgDur, durSigma);
        if (config.avgElevationMeters) {
          totalElevation += withUniformVariance(
            config.avgElevationMeters,
            ACTIVITY_PARAMS.ELEVATION_VARIANCE
          );
        }
      }

      const dateStr = toLocalDateString(currentDate);
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
