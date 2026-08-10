import { MILES_TO_METERS, hoursToMinutes } from "./units";
import { logger } from "../lib/logger";
import { GOAL_STORAGE_VERSION, type GoalsForYear } from "../services/userConfigService";

/**
 * Goal Unit Migration
 *
 * Migrates goals from legacy display-unit storage to canonical-unit storage:
 *   distance sports: miles → meters
 *   time sports:     hours → minutes
 *
 * Detection order in `migrateGoalUnitsIfNeeded`:
 *   1. `storageVersion === GOAL_STORAGE_VERSION` on the payload → trust it,
 *      skip everything else. This is the authoritative signal going forward.
 *   2. localStorage flag for this user/year/sport is set → migration ran
 *      previously but didn't stamp version (pre-version-field code). Stamp now.
 *   3. Value-range heuristic (see thresholds below) → if every value is
 *      already in the canonical range, assume canonical; otherwise convert.
 *
 * Recovery hatch — known caveat
 * ------------------------------
 * The prefix below is versioned (`_v2_`); bumping it forces every user back
 * through paths 2 and 3, which is the only way to repair Firestore docs that
 * shipped with raw display values (e.g. via the demo→Firestore copy bug).
 *
 * Path 3 (the heuristic) has a narrow but real false-negative window: a user
 * whose goals are all *already* canonical AND all small enough to look like
 * display values gets double-migrated (e.g. 16,093 m → 25,899,000 m). The
 * boundary is `> DISTANCE_METERS_HEURISTIC` for distance (≈ 31 mi) and
 * `> TIME_MINUTES_HEURISTIC` for time (≈ 17 hr). Realistic yearly goals sit
 * above these thresholds, so the window is hypothetical — but if a user ever
 * reports goal values that look ~1609× too big, delete their
 * `desirelines_goals_canonical_v2_migrated_<uid>_<year>_<sport>` localStorage
 * entry; their next load will re-run the migration and the heuristic should
 * stamp the (now-grown) values as canonical correctly. Long-term, once
 * `storageVersion: 2` has saturated the active user base the prefix bump can
 * be reverted entirely and path 1 becomes the only signal.
 */

const GOAL_UNIT_MIGRATION_PREFIX = "desirelines_goals_canonical_v2_migrated_";

/**
 * Build the localStorage key for migration tracking.
 * Includes userId to isolate migration state per user on shared devices.
 */
function getMigrationKey(userId: string, year: number, sport: string): string {
  return `${GOAL_UNIT_MIGRATION_PREFIX}${userId}_${year}_${sport}`;
}

/**
 * Check if goals for a user/year/sport have been migrated to canonical units
 */
export function isGoalUnitMigrated(userId: string, year: number, sport: string): boolean {
  return localStorage.getItem(getMigrationKey(userId, year, sport)) !== null;
}

/**
 * Mark goals for a user/year/sport as migrated to canonical units
 */
export function markGoalUnitMigrated(userId: string, year: number, sport: string): void {
  localStorage.setItem(getMigrationKey(userId, year, sport), new Date().toISOString());
}

/**
 * Convert goals from display units to canonical storage units, stamping the
 * resulting payload with the current storageVersion so future loads can skip
 * the heuristic and trust the marker.
 *
 * Distance sports: miles → meters. Time sports: hours → minutes.
 * The caller decides which kind based on the sport's primary metric.
 */
function convertGoalsToCanonical(goals: GoalsForYear, kind: "distance" | "time"): GoalsForYear {
  return {
    ...goals,
    goals: goals.goals.map((goal) => ({
      ...goal,
      // `factor` used to be hoisted as `kind === "distance" ? MILES_TO_METERS : 0`,
      // but the 0 arm was unreachable: it was only ever read inside this same
      // distance branch.
      value:
        kind === "distance"
          ? Math.round(goal.value * MILES_TO_METERS)
          : Math.round(hoursToMinutes(goal.value)),
    })),
    storageVersion: GOAL_STORAGE_VERSION,
  };
}

/** Stamp an existing canonical payload with the storageVersion marker. */
function stampVersion(goals: GoalsForYear): GoalsForYear {
  return { ...goals, storageVersion: GOAL_STORAGE_VERSION };
}

/**
 * Distance heuristic: any value > 50,000 is almost certainly already meters.
 *   - 50,000 miles ≈ 2x around the earth (unrealistic yearly goal)
 *   - 50,000 meters ≈ 31 miles (small but plausible)
 * Prevents double-migration if the localStorage flag was lost.
 */
const DISTANCE_METERS_HEURISTIC = 50000;

/**
 * Time heuristic: any value > 1,000 is almost certainly already minutes.
 *   - 1,000 hours/year ≈ 2.7 hrs/day (extreme but conceivable for yoga)
 *   - 1,000 minutes/year ≈ 17 hrs/year (trivially low)
 * Same role as the distance threshold above.
 */
const TIME_MINUTES_HEURISTIC = 1000;

function isLikelyAlreadyCanonical(goals: GoalsForYear, kind: "distance" | "time"): boolean {
  const threshold = kind === "distance" ? DISTANCE_METERS_HEURISTIC : TIME_MINUTES_HEURISTIC;
  return goals.goals.some((goal) => goal.value > threshold);
}

/**
 * Check if goals need migration and convert if necessary.
 *
 * @param goals - Goals loaded from Firestore
 * @param userId - User ID for migration tracking
 * @param year - Year for migration tracking
 * @param sport - Sport for migration tracking
 * @param kind - "distance" for distance sports (miles → meters) or "time" for
 *   time sports (hours → minutes). Sports with neither (sessions) are no-ops
 *   and shouldn't call this function.
 */
export function migrateGoalUnitsIfNeeded(
  goals: GoalsForYear,
  userId: string,
  year: number,
  sport: string,
  kind: "distance" | "time"
): { goals: GoalsForYear; needsSave: boolean } {
  // Self-describing: if the payload says it's at the current canonical
  // version, trust the marker and skip every other check.
  if (goals.storageVersion === GOAL_STORAGE_VERSION) {
    return { goals, needsSave: false };
  }

  // Legacy path: data without a storageVersion stamp. The localStorage flag
  // and value-range heuristic remain as the recovery hatch for that data.
  if (isGoalUnitMigrated(userId, year, sport)) {
    // Migration ran on a previous load but the payload was never stamped
    // (pre-version-field code). Stamp it now so subsequent loads skip the
    // legacy path entirely.
    return { goals: stampVersion(goals), needsSave: true };
  }

  // Safety heuristic: if any goal value is in the "canonical" range, assume
  // already migrated. Prevents double-migration if localStorage flag was lost.
  if (isLikelyAlreadyCanonical(goals, kind)) {
    logger.info(
      `[Migration] Goals for ${year}/${sport} appear to already be in canonical units, stamping version marker`
    );
    markGoalUnitMigrated(userId, year, sport);
    return { goals: stampVersion(goals), needsSave: true };
  }

  // Not migrated - convert from display to canonical
  const convertedGoals = convertGoalsToCanonical(goals, kind);

  logger.info(
    `[Migration] Converting goals for ${year}/${sport} from display to canonical (${kind})`
  );

  return { goals: convertedGoals, needsSave: true };
}
