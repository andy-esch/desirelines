import { useEffect, useRef } from "react";
import {
  migrateGoalUnitsIfNeeded,
  markGoalUnitMigrated,
  isGoalUnitMigrated,
} from "../utils/migration";
import type { GoalsForYear } from "../services/userConfigService";
import { logger } from "../lib/logger";

/**
 * One-time migration hook: converts goals from legacy display-unit storage to
 * canonical storage (meters for distance sports, minutes for time sports).
 *
 * Runs once per userId/year/sport when goals are first loaded. Uses a ref to
 * prevent re-triggering within the same component lifecycle, and a versioned
 * localStorage flag to prevent re-triggering across page loads. Sports with no
 * canonical-unit metric (sessions, etc.) are a no-op.
 *
 * @param goalsData   - Goals loaded from Firestore/localStorage
 * @param userId      - Authenticated user's UID (for per-user migration tracking)
 * @param year        - Year for migration tracking
 * @param sport       - Sport key for migration tracking
 * @param hasDistance - True if this sport's primary metric is distance
 * @param isTime      - True if this sport's primary metric is time
 * @param updateGoals - Async save function (from useUserConfig)
 */
export function useGoalMigration(
  goalsData: GoalsForYear | null,
  userId: string,
  year: number,
  sport: string,
  hasDistance: boolean,
  isTime: boolean,
  updateGoals: (goals: GoalsForYear) => Promise<void>
): void {
  // Track which context was last migrated so we re-run when year/sport changes
  const lastMigratedContext = useRef<string | null>(null);

  useEffect(() => {
    const context = `${userId}_${year}_${sport}`;
    if (!goalsData || lastMigratedContext.current === context) return;

    // Only distance and time sports have a display↔canonical conversion. Sports
    // backed by sessions (or anything else without a unit) need no migration.
    const kind: "distance" | "time" | null = hasDistance
      ? "distance"
      : isTime
        ? "time"
        : null;
    if (kind === null) return;

    if (!isGoalUnitMigrated(userId, year, sport) && goalsData.goals.length > 0) {
      lastMigratedContext.current = context;
      const { goals: migratedGoals, needsSave } = migrateGoalUnitsIfNeeded(
        goalsData,
        userId,
        year,
        sport,
        kind
      );

      if (needsSave) {
        updateGoals(migratedGoals)
          .then(() => markGoalUnitMigrated(userId, year, sport))
          .catch((error) => {
            // Error is surfaced by useUserConfig; don't mark as migrated so it retries.

            logger.error(`Failed to save migrated goals for ${year}/${sport}:`, error);
          });
      } else {
        markGoalUnitMigrated(userId, year, sport);
      }
    }
  }, [goalsData, userId, year, sport, hasDistance, isTime, updateGoals]);
}
