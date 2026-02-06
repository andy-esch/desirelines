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
 * Runs once per year/sport when goals are first loaded. Uses a ref to prevent
 * re-triggering within the same component lifecycle, and a localStorage flag
 * to prevent re-triggering across page loads.
 *
 * Only applies to distance-based sports; non-distance sports are a no-op.
 *
 * @param goalsData   - Goals loaded from Firestore/localStorage
 * @param year        - Year for migration tracking
 * @param sport       - Sport key for migration tracking
 * @param hasDistance  - Whether this sport uses distance as its primary metric
 * @param updateGoals - Async save function (from useUserConfig)
 */
export function useGoalMigration(
  goalsData: GoalsForYear | null,
  year: number,
  sport: string,
  hasDistance: boolean,
  updateGoals: (goals: GoalsForYear) => Promise<void>
): void {
  const migrationTriggered = useRef(false);

  useEffect(() => {
    if (!goalsData || migrationTriggered.current) return;
    if (!hasDistance) return;

    if (!isGoalUnitMigrated(year, sport) && goalsData.goals.length > 0) {
      migrationTriggered.current = true;
      const { goals: migratedGoals, needsSave } = migrateGoalUnitsIfNeeded(
        goalsData,
        year,
        sport
      );

      if (needsSave) {
        updateGoals(migratedGoals).then(() => {
          markGoalUnitMigrated(year, sport);
        });
      } else {
        markGoalUnitMigrated(year, sport);
      }
    }
  }, [goalsData, year, sport, hasDistance, updateGoals]);
}
