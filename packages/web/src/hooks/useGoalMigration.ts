import { useEffect, useRef } from "react";
import {
  migrateGoalUnitsIfNeeded,
  markGoalUnitMigrated,
  isGoalUnitMigrated,
} from "../utils/migration";
import type { GoalsForYear } from "../services/userConfigService";

/**
 * One-time migration hook: converts goals from legacy miles format to meters.
 *
 * Runs once per userId/year/sport when goals are first loaded. Uses a ref to prevent
 * re-triggering within the same component lifecycle, and a localStorage flag
 * (scoped by userId) to prevent re-triggering across page loads.
 *
 * Only applies to distance-based sports; non-distance sports are a no-op.
 *
 * @param goalsData   - Goals loaded from Firestore/localStorage
 * @param userId      - Authenticated user's UID (for per-user migration tracking)
 * @param year        - Year for migration tracking
 * @param sport       - Sport key for migration tracking
 * @param hasDistance  - Whether this sport uses distance as its primary metric
 * @param updateGoals - Async save function (from useUserConfig)
 */
export function useGoalMigration(
  goalsData: GoalsForYear | null,
  userId: string,
  year: number,
  sport: string,
  hasDistance: boolean,
  updateGoals: (goals: GoalsForYear) => Promise<void>
): void {
  // Track which context was last migrated so we re-run when year/sport changes
  const lastMigratedContext = useRef<string | null>(null);

  useEffect(() => {
    const context = `${userId}_${year}_${sport}`;
    if (!goalsData || lastMigratedContext.current === context) return;
    if (!hasDistance) return;

    if (!isGoalUnitMigrated(userId, year, sport) && goalsData.goals.length > 0) {
      lastMigratedContext.current = context;
      const { goals: migratedGoals, needsSave } = migrateGoalUnitsIfNeeded(
        goalsData,
        userId,
        year,
        sport
      );

      if (needsSave) {
        updateGoals(migratedGoals)
          .then(() => markGoalUnitMigrated(userId, year, sport))
          .catch((error) => {
            // Error is surfaced by useUserConfig; don't mark as migrated so it retries.

            console.error(`Failed to save migrated goals for ${year}/${sport}:`, error);
          });
      } else {
        markGoalUnitMigrated(userId, year, sport);
      }
    }
  }, [goalsData, userId, year, sport, hasDistance, updateGoals]);
}
