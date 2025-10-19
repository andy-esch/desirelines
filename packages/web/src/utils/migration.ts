import { UserConfigService } from "../services/userConfigService";

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
 * @returns true if migration was performed, false if skipped
 */
export async function migrateGoalsToFirestore(
  configService: UserConfigService,
  year: number
): Promise<boolean> {
  const localStorageKey = `desirelines_goals_${year}`;
  const migrationFlagKey = `${localStorageKey}_migrated`;

  try {
    // Check if already migrated
    if (localStorage.getItem(migrationFlagKey)) {
      console.log(`Goals for ${year} already migrated to Firestore`);
      return false;
    }

    // Load data from localStorage
    const localData = localStorage.getItem(localStorageKey);
    if (!localData) {
      console.log(`No localStorage data to migrate for ${year}`);
      return false;
    }

    const goals = JSON.parse(localData);

    // Check if Firestore already has data (avoid overwriting)
    const existingGoals = await configService.getConfigSection("goals", year);
    if (existingGoals && Array.isArray(existingGoals) && existingGoals.length > 0) {
      console.log(`Firestore already has goals for ${year}, skipping migration`);
      // Mark as migrated even though we didn't migrate (to avoid repeated checks)
      localStorage.setItem(migrationFlagKey, new Date().toISOString());
      return false;
    }

    // Migrate to Firestore
    await configService.updateConfigSection("goals", goals, year);
    console.log(`✓ Successfully migrated goals for ${year} to Firestore`);

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
 * @param years - Array of years to migrate (defaults to 2023-2025)
 * @returns Object with migration results per year
 */
export async function migrateAllGoalsToFirestore(
  configService: UserConfigService,
  years: number[] = [2023, 2024, 2025]
): Promise<Record<number, boolean>> {
  const results: Record<number, boolean> = {};

  for (const year of years) {
    results[year] = await migrateGoalsToFirestore(configService, year);
  }

  const migratedCount = Object.values(results).filter(Boolean).length;
  if (migratedCount > 0) {
    console.log(`✓ Migrated ${migratedCount} year(s) of goals to Firestore`);
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
