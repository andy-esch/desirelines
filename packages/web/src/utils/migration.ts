import { UserConfigService } from "../services/userConfigService";
import { MILES_TO_METERS } from "./units";
import type { GoalsForYear } from "../services/userConfigService";

/**
 * Migrate user data from localStorage to Firestore
 *
 * This utility handles one-time migration of existing localStorage data
 * to the new Firestore backend. It's designed to be idempotent and safe.
 *
 * Migration strategy:
 * 1. Check if Firestore already has data (skip if it does)
 * 2. Load data from localStorage
 * 3. Write to Firestore
 * 4. Mark localStorage as migrated (don't delete for safety)
 *
 * @param configService - UserConfigService instance
 * @param year - Year to migrate goals for
 * @param sport - Sport to migrate goals for (defaults to "cycling" for legacy data)
 * @returns true if migration was performed, false if skipped
 */
export async function migrateGoalsToFirestore(
  configService: UserConfigService,
  year: number,
  sport: string = "cycling"
): Promise<boolean> {
  const localStorageKey = `desirelines_goals_${year}`;
  const migrationFlagKey = `${localStorageKey}_migrated`;

  try {
    // Check if already migrated
    if (localStorage.getItem(migrationFlagKey)) {
      // eslint-disable-next-line no-console
      console.log(`Goals for ${year} already migrated to Firestore`);
      return false;
    }

    // Load data from localStorage
    const localData = localStorage.getItem(localStorageKey);
    if (!localData) {
      // eslint-disable-next-line no-console
      console.log(`No localStorage data to migrate for ${year}`);
      return false;
    }

    const goals = JSON.parse(localData);

    // Check if Firestore already has data (avoid overwriting)
    const existingGoals = await configService.getConfigSection("goals", year, sport);
    if (existingGoals && existingGoals.goals && existingGoals.goals.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`Firestore already has goals for ${year}/${sport}, skipping migration`);
      // Mark as migrated even though we didn't migrate (to avoid repeated checks)
      localStorage.setItem(migrationFlagKey, new Date().toISOString());
      return false;
    }

    // Migrate to Firestore
    await configService.updateConfigSection("goals", goals, year, sport);
    // eslint-disable-next-line no-console
    console.log(`✓ Successfully migrated goals for ${year}/${sport} to Firestore`);

    // Mark as migrated (but keep localStorage data as backup)
    localStorage.setItem(migrationFlagKey, new Date().toISOString());

    return true;
  } catch (error) {
    console.error(`Failed to migrate goals for ${year}:`, error);
    // Don't throw - migration failure shouldn't break the app
    return false;
  }
}

/**
 * Migrate all years of goals from localStorage to Firestore
 *
 * @param configService - UserConfigService instance
 * @param years - Array of years to migrate (defaults to current year and 2 prior)
 * @returns Object with migration results per year
 */
export async function migrateAllGoalsToFirestore(
  configService: UserConfigService,
  years: number[] = (() => {
    const currentYear = new Date().getFullYear();
    return [currentYear - 2, currentYear - 1, currentYear];
  })()
): Promise<Record<number, boolean>> {
  const results: Record<number, boolean> = {};

  for (const year of years) {
    results[year] = await migrateGoalsToFirestore(configService, year);
  }

  return results;
}

/**
 * Fallback: Load goals from localStorage if Firestore is unavailable
 *
 * @param year - Year to load goals for
 * @returns Goals from localStorage or null if not found
 */
export function loadGoalsFromLocalStorage<T>(year: number): T | null {
  try {
    const localStorageKey = `desirelines_goals_${year}`;
    const localData = localStorage.getItem(localStorageKey);

    if (localData) {
      return JSON.parse(localData);
    }

    return null;
  } catch (error) {
    console.error(`Error loading goals from localStorage for ${year}:`, error);
    return null;
  }
}

/**
 * Save goals to localStorage as a fallback/backup
 *
 * This can be used alongside Firestore for offline functionality
 * or as a safety backup during migration
 *
 * @param year - Year to save goals for
 * @param goals - Goals data to save
 */
export function saveGoalsToLocalStorage<T>(year: number, goals: T): void {
  try {
    const localStorageKey = `desirelines_goals_${year}`;
    localStorage.setItem(localStorageKey, JSON.stringify(goals));
  } catch (error) {
    console.error(`Error saving goals to localStorage for ${year}:`, error);
  }
}

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
