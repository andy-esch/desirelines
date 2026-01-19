import { MILES_TO_METERS } from "./units";
import type { GoalsForYear } from "../services/userConfigService";

/**
 * Goal Unit Migration
 *
 * Migrates goals from legacy format (stored in miles) to new format (stored in meters).
 * This is a one-time migration that runs when goals are loaded.
 *
 * Detection: Uses localStorage to track which year/sport combos have been migrated.
 * We can't modify the protobuf schema easily, so we track migration status separately.
 */

const GOAL_UNIT_MIGRATION_PREFIX = "desirelines_goals_meters_migrated_";

/**
 * Check if goals for a year/sport have been migrated to meters
 */
export function isGoalUnitMigrated(year: number, sport: string): boolean {
  const key = `${GOAL_UNIT_MIGRATION_PREFIX}${year}_${sport}`;
  return localStorage.getItem(key) !== null;
}

/**
 * Mark goals for a year/sport as migrated to meters
 */
export function markGoalUnitMigrated(year: number, sport: string): void {
  const key = `${GOAL_UNIT_MIGRATION_PREFIX}${year}_${sport}`;
  localStorage.setItem(key, new Date().toISOString());
}

/**
 * Convert goals from miles to meters (one-time migration)
 *
 * @param goals - Goals in legacy format (values in miles)
 * @returns Goals with values converted to meters
 */
export function convertGoalsFromMilesToMeters(goals: GoalsForYear): GoalsForYear {
  return {
    goals: goals.goals.map((goal) => ({
      ...goal,
      value: Math.round(goal.value * MILES_TO_METERS),
    })),
  };
}

/**
 * Heuristic to detect if a goal value is likely already in meters.
 *
 * If value > 50,000, it's almost certainly already meters:
 * - 50,000 miles = ~80,000 km = 2x around the earth (unrealistic yearly goal)
 * - 50,000 meters = ~31 miles (very small for a distance goal)
 *
 * This prevents double-migration if localStorage flag is lost.
 */
const METERS_HEURISTIC_THRESHOLD = 50000;

function isLikelyAlreadyMeters(goals: GoalsForYear): boolean {
  return goals.goals.some((goal) => goal.value > METERS_HEURISTIC_THRESHOLD);
}

/**
 * Check if goals need migration and convert if necessary
 *
 * This function:
 * 1. Checks if migration has already been done (via localStorage flag)
 * 2. Uses heuristic to detect if values are already in meters (safety check)
 * 3. If not, converts goal values from miles to meters
 * 4. Returns the (possibly converted) goals and a flag indicating if save is needed
 *
 * @param goals - Goals loaded from Firestore
 * @param year - Year for migration tracking
 * @param sport - Sport for migration tracking
 * @returns Object with converted goals and whether they need to be saved
 */
export function migrateGoalUnitsIfNeeded(
  goals: GoalsForYear,
  year: number,
  sport: string
): { goals: GoalsForYear; needsSave: boolean } {
  // If already migrated (localStorage flag), return as-is
  if (isGoalUnitMigrated(year, sport)) {
    return { goals, needsSave: false };
  }

  // Safety heuristic: if any goal value > 50,000, assume already in meters
  // This prevents double-migration if localStorage flag was lost
  if (isLikelyAlreadyMeters(goals)) {
    // eslint-disable-next-line no-console
    console.log(
      `[Migration] Goals for ${year}/${sport} appear to already be in meters (value > ${METERS_HEURISTIC_THRESHOLD}), skipping conversion`
    );
    // Mark as migrated so we don't check again
    markGoalUnitMigrated(year, sport);
    return { goals, needsSave: false };
  }

  // Not migrated - convert from miles to meters
  const convertedGoals = convertGoalsFromMilesToMeters(goals);

  // eslint-disable-next-line no-console
  console.log(`[Migration] Converting goals for ${year}/${sport} from miles to meters`);

  return { goals: convertedGoals, needsSave: true };
}
