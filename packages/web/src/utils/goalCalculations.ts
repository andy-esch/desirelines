import type { DistanceEntry, PacingEntry } from "../types/activity";
import { toLocalDateString } from "./dateUtils";
import {
  goalDisplayToMeters,
  goalMetersToDisplay,
  hoursToMinutes,
  minutesToHours,
  type DistanceUnit,
} from "./units";

export type DistanceTimeseries = DistanceEntry[];
export type PacingTimeseries = PacingEntry[];

/** Context needed to convert a goal value between display units and canonical storage units. */
export interface GoalUnitContext {
  /** True for distance-based sports (storage = meters, display = miles/km). */
  hasDistance: boolean;
  /** True for time-based sports (storage = minutes, display = hours). */
  isTime: boolean;
  /** User's preferred distance display unit. */
  distanceUnit: DistanceUnit;
}

/**
 * Convert a goal value from display units (miles/km/hours) to canonical storage
 * units (meters/minutes). Storage values are unit-stable across user preference
 * changes; display values follow the user's current setting.
 *
 * Sports without a distance or time primary metric (sessions, etc.) are
 * stored as-is — the value is already unitless.
 */
export function goalToStorage(displayValue: number, ctx: GoalUnitContext): number {
  if (ctx.hasDistance) return Math.round(goalDisplayToMeters(displayValue, ctx.distanceUnit));
  if (ctx.isTime) return Math.round(hoursToMinutes(displayValue));
  return displayValue;
}

/** Inverse of `goalToStorage`. */
export function goalToDisplay(storageValue: number, ctx: GoalUnitContext): number {
  if (ctx.hasDistance) return Math.round(goalMetersToDisplay(storageValue, ctx.distanceUnit));
  if (ctx.isTime) return Math.round(minutesToHours(storageValue));
  return storageValue;
}

/**
 * Convert a whole goal to canonical storage units, carrying its metadata through.
 *
 * Only `value` changes; `id`, `label`, `metric`, `createdAt` and `updatedAt` are
 * preserved exactly. These wrappers exist because the same six-field literal was
 * hand-written at three call sites, which is a standing invitation to drop a field
 * on one of them — a real hazard here, since a missing `metric` or `createdAt`
 * persists straight to Firestore.
 */
export function toStoredGoal<T extends { value: number }>(goal: T, ctx: GoalUnitContext): T {
  return { ...goal, value: goalToStorage(goal.value, ctx) };
}

/** Inverse of `toStoredGoal`. */
export function toDisplayGoal<T extends { value: number }>(goal: T, ctx: GoalUnitContext): T {
  return { ...goal, value: goalToDisplay(goal.value, ctx) };
}

/**
 * Calculate the number of days in a year using UTC to avoid DST issues
 * @param year - The year to calculate for
 * @returns 365 for regular years, 366 for leap years
 */
function getDaysInYear(year: number): number {
  // Use UTC dates to avoid DST issues
  const startOfYearUTC = Date.UTC(year, 0, 1);
  const endOfYearUTC = Date.UTC(year, 11, 31);
  // Math.floor for consistency, +1 for inclusive counting (Jan 1 to Dec 31)
  return Math.floor((endOfYearUTC - startOfYearUTC) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Create a UTC date for a specific day of the year and return as YYYY-MM-DD string
 * Uses UTC throughout to avoid timezone-related off-by-one errors
 */
function dayOfYearToDateString(year: number, dayOfYear: number): string {
  // Create date in UTC to avoid local timezone issues
  const utcDate = new Date(Date.UTC(year, 0, dayOfYear));
  return utcDate.toISOString().split("T")[0] ?? "";
}

/**
 * Pace ratio thresholds for determining goal status.
 * paceRatio = currentValue / proratedGoal (where 1.0 = exactly on pace).
 *
 * Used by GoalSummaryTable (sport page) and GoalProgressCard (dashboard).
 */
export const PACE_THRESHOLDS = {
  AHEAD: 1.1,
  ON_TRACK: 0.9,
  SLIGHTLY_BEHIND: 0.75,
  BEHIND: 0.5,
} as const;

/**
 * Extract the target goal value from a list of goal entries.
 * Prefers the goal labeled "Target", falls back to the middle value when sorted.
 * Returns null if the array is empty.
 */
export function getTargetGoalValue(
  goals: ReadonlyArray<{ value: number; label?: string }>
): number | null {
  if (goals.length === 0) return null;
  const targetEntry = goals.find((g) => g.label === "Target");
  if (targetEntry) return targetEntry.value;
  const sorted = [...goals].sort((a, b) => a.value - b.value);
  return sorted[Math.floor(sorted.length / 2)]?.value ?? null;
}

/**
 * Individual goal — aligned with proto `Goal` so a display-layer goal can
 * round-trip to Firestore without late-stage field bolt-on.
 *
 * `value` is display-unit in the UI layer and storage-unit (meters / minutes
 * / unitless) once converted by `goalToStorage`. The shape itself is
 * identical across both layers, which is what closes the bug class from
 * 2026-03-23 (partial goal writes leaking into Firestore).
 */
export interface Goal {
  /** Unique identifier */
  id: string;
  /**
   * Display-unit value in the UI layer (miles/km for distance sports, hours
   * for time sports, raw count otherwise). Converted to canonical storage
   * units via `goalToStorage` before persisting.
   */
  value: number;
  /** User label; default "" matches the proto string default. */
  label: string;
  /** Sport metric key (e.g. "distance_meters", "time_minutes", "activities"). */
  metric: string;
  /** ISO timestamp stamped at goal creation. */
  createdAt: string;
  /** ISO timestamp stamped on every modification. */
  updatedAt: string;
}

/**
 * Array of goals (1-5 goals)
 */
export type Goals = Goal[];

/**
 * Build a fresh `Goal` with all proto fields populated.
 *
 * Centralises the "what's a complete goal?" answer so every caller (default
 * generation, hand-add via UI, demo seeds) goes through the same constructor
 * — no caller can accidentally produce a partial goal.
 *
 * `now` is injectable for deterministic tests; defaults to the wall clock.
 */
export function buildGoal(
  fields: { id: string; value: number; label: string; metric: string },
  now: string = new Date().toISOString()
): Goal {
  return {
    id: fields.id,
    value: fields.value,
    label: fields.label,
    metric: fields.metric,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Calculate a straight "desire line" with daily goal from Jan 1 to Dec 31
 *
 * On day 1 (Jan 1), goal is targetDistance/daysInYear (not 0)
 * On day N, goal is targetDistance * N / daysInYear
 *
 * @param targetDistance - End-of-year goal (e.g., 2000, 2500, 3000 miles)
 * @param year - Year to calculate for (handles leap years)
 * @param maxDate - Don't plot beyond this date (typically today)
 * @returns Timeseries with linear progression from day 1
 */
export function calculateDesireLine(
  targetDistance: number,
  year: number,
  maxDate: Date
): DistanceTimeseries {
  const daysInYear = getDaysInYear(year);
  const line: DistanceTimeseries = [];

  const maxDateStr = toLocalDateString(maxDate);

  for (let dayOfYear = 1; dayOfYear <= daysInYear; dayOfYear++) {
    const dateStr = dayOfYearToDateString(year, dayOfYear);

    // Include up to and including maxDate
    if (dateStr > maxDateStr) break;

    // Goal for day N: complete N days worth of distance
    const targetForDay = (targetDistance * dayOfYear) / daysInYear;
    line.push({ x: dateStr, y: targetForDay });
  }

  return line;
}

/**
 * Calculate "current average" line - projects current pace to end of year
 *
 * Slope = (distance traveled so far) / (days elapsed)
 * Projected end distance = slope * daysInYear
 *
 * @param distanceTraveled - Actual cumulative distance data
 * @param year - Year to calculate for
 * @param maxDate - Don't plot beyond this date
 * @returns Timeseries with linear projection of current average pace
 */
export function calculateCurrentAverageLine(
  distanceTraveled: DistanceTimeseries,
  year: number,
  maxDate: Date
): DistanceTimeseries {
  if (distanceTraveled.length === 0) return [];

  // Preserve the sparse-array guard for strict parity: estimateYearEndDistance
  // returns 0 on a missing last entry (→ a zero line), whereas this projection
  // should yield an empty line.
  const lastEntry = distanceTraveled[distanceTraveled.length - 1];
  if (!lastEntry) return [];

  // Projected year-end distance at current pace (single source of truth).
  const projectedEndDistance = estimateYearEndDistance(distanceTraveled, year);

  // Use same line calculation as desire lines
  return calculateDesireLine(projectedEndDistance, year, maxDate);
}

/**
 * Helper: Estimate end-of-year distance based on current pace
 */
export function estimateYearEndDistance(
  distanceTraveled: DistanceTimeseries,
  year: number
): number {
  if (distanceTraveled.length === 0) return 0;

  const lastEntry = distanceTraveled[distanceTraveled.length - 1];
  if (!lastEntry) return 0;

  const currentDistance = lastEntry.y;
  const daysElapsed = distanceTraveled.length;
  const daysInYear = getDaysInYear(year);

  return (currentDistance / daysElapsed) * daysInYear;
}

/**
 * Every input to `generateDefaultGoals`: the estimate to build from, the sport
 * context, the rounding knobs, and an injectable clock for tests.
 *
 * One object rather than positional args because the required sport context
 * used to sit behind two optionals, so callers wrote
 * `generateDefaultGoals(estimate, undefined, undefined, { metric })` to reach
 * it — and that shape is how goals once silently reset to cycling-shaped
 * defaults on every sport. Named fields make the sport context impossible to
 * skip past.
 */
export interface GenerateDefaultGoalsOptions {
  /** Estimated year-end distance/value, in display units. */
  estimatedDistance: number;
  /** Sport metric key (e.g. "distance_meters", "time_minutes"). Required. */
  metric: string;
  /** Rounding increment for the generated goals. */
  granularity?: number;
  /** Minimum base value, so a sport with no data still gets meaningful goals
   *  rather than 0/0/granularity. Defaults to `granularity`. */
  minValue?: number;
  /** ISO timestamp to stamp on createdAt/updatedAt. Defaults to wall clock; injectable for tests. */
  now?: string;
}

/**
 * Helper: Generate default goals based on estimated year-end distance.
 *
 * Returns 3 default goals (Conservative, Target, Stretch), all guaranteed to be
 * greater than 0 and unique. Every goal carries full proto metadata (`metric`,
 * `createdAt`, `updatedAt`) so the result can be written to Firestore without
 * further enrichment.
 *
 * See `GenerateDefaultGoalsOptions` for the inputs.
 */
export function generateDefaultGoals({
  estimatedDistance,
  metric,
  granularity = 100,
  minValue,
  now,
}: GenerateDefaultGoalsOptions): Goals {
  // Ensure we have a meaningful base value for goal generation
  // minValue prevents meaningless goals (like 0, 0, 100) when there's no data
  const effectiveMin = minValue ?? granularity;
  const effectiveDistance = Math.max(estimatedDistance, effectiveMin);

  const rounded = Math.ceil(effectiveDistance / granularity) * granularity;

  // Conservative goal: one step below target
  // Edge case: if rounded equals granularity, use half-granularity to keep goals unique
  let conservativeValue: number;
  if (rounded > granularity) {
    conservativeValue = rounded - granularity;
  } else {
    // rounded == granularity (edge case with small estimates)
    // Use half of granularity to ensure uniqueness and > 0
    conservativeValue = Math.max(1, Math.round(granularity / 2));
  }

  const timestamp = now ?? new Date().toISOString();

  return [
    buildGoal({ id: "1", value: conservativeValue, label: "Conservative", metric }, timestamp),
    buildGoal({ id: "2", value: rounded, label: "Target", metric }, timestamp),
    buildGoal({ id: "3", value: rounded + granularity, label: "Stretch", metric }, timestamp),
  ];
}

/**
 * Validate a single goal value
 * Returns error message if invalid, null if valid
 *
 * Only validates that value is a positive integer.
 * Increment buttons use sport-specific granularity, but manual text entry
 * allows any positive value for flexibility.
 */
export function validateGoalValue(value: number): string | null {
  if (!Number.isInteger(value)) {
    return "Goal must be a whole number";
  }

  if (value <= 0) {
    return "Goal must be greater than 0";
  }

  return null;
}

/**
 * Validate goals array
 * - Must have 1-5 goals
 * - All goal values must be greater than 0
 * - All goal values must be unique
 */
export function validateGoals(goals: Goals): { valid: boolean; error?: string } {
  if (goals.length === 0) {
    return { valid: false, error: "At least one goal required" };
  }
  if (goals.length > 5) {
    return { valid: false, error: "Maximum 5 goals allowed" };
  }

  // Check for zero or negative values
  const invalidValue = goals.find((g) => g.value <= 0);
  if (invalidValue) {
    return { valid: false, error: "Goal values must be greater than 0" };
  }

  const values = goals.map((g) => g.value);
  const uniqueValues = new Set(values);
  if (values.length !== uniqueValues.size) {
    return { valid: false, error: "All goal values must be unique" };
  }

  return { valid: true };
}

/**
 * Calculate actual pacing from cumulative metric data
 *
 * Pacing = cumulative value / days elapsed (per-day average in the data's own
 * units — miles/day for distance sports, hours/day for time sports, etc.).
 *
 * @param distanceTraveled - Actual cumulative metric data
 * @param maxDate - Don't plot beyond this date
 * @returns Timeseries with actual average pace over time
 */
export function calculateActualPacing(
  distanceTraveled: DistanceTimeseries,
  maxDate: Date
): PacingTimeseries {
  const pacing: PacingTimeseries = [];
  const maxDateStr = toLocalDateString(maxDate);

  for (let i = 0; i < distanceTraveled.length; i++) {
    const entry = distanceTraveled[i];
    if (!entry) continue;

    const dateStr = entry.x;

    if (dateStr > maxDateStr) break;

    // Average pace = cumulative distance / days elapsed
    const daysElapsed = i + 1;
    const avgPace = entry.y / daysElapsed;

    pacing.push({ x: dateStr, y: avgPace });
  }

  return pacing;
}

/**
 * Calculate dynamic pacing goal - pace needed NOW to reach goal by year end
 *
 * For each day: pacing = (targetDistance - currentDistance) / daysRemaining
 * This adjusts dynamically as distance accumulates
 *
 * @param distanceTraveled - Actual cumulative distance data
 * @param targetDistance - End-of-year distance goal
 * @param year - Year to calculate for
 * @param maxDate - Don't plot beyond this date
 * @returns Timeseries with dynamic pacing needed to achieve goal
 */
export function calculateDynamicPacingGoal(
  distanceTraveled: DistanceTimeseries,
  targetDistance: number,
  year: number,
  maxDate: Date
): PacingTimeseries {
  const daysInYear = getDaysInYear(year);
  const pacing: PacingTimeseries = [];
  const maxDateStr = toLocalDateString(maxDate);

  for (let i = 0; i < distanceTraveled.length; i++) {
    const entry = distanceTraveled[i];
    if (!entry) continue;

    const dateStr = entry.x;

    if (dateStr > maxDateStr) break;

    const daysElapsed = i + 1;
    const currentDistance = entry.y;
    const distanceRemaining = targetDistance - currentDistance;
    const daysRemaining = daysInYear - daysElapsed;

    // If no days remaining, pace is 0 (year is over)
    // If distance remaining is negative, pace is 0 (goal already achieved)
    const requiredPace =
      daysRemaining > 0 && distanceRemaining > 0 ? distanceRemaining / daysRemaining : 0;

    pacing.push({ x: dateStr, y: requiredPace });
  }

  return pacing;
}
