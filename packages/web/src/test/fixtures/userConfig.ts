import { MockAuthService } from "../../services/auth/MockAuthService";
import { MockDatabaseService } from "../../services/database/MockDatabaseService";
import { GOAL_STORAGE_VERSION } from "../../services/userConfigService";
import type { Goal } from "../../types/generated/user_config";

/** The signed-in athlete the account fixtures belong to. */
export const ACCOUNT_USER = {
  uid: "athlete-1",
  email: "athlete@example.com",
  displayName: "Athlete",
  photoURL: null,
};

/** Where `ACCOUNT_USER`'s config document lives. */
export const ACCOUNT_CONFIG_PATH = `users/${ACCOUNT_USER.uid}/config/v1`;

/** A stored goal, in storage units (meters for distance, minutes for time). */
export function storedGoal(id: string, value: number, label = id): Goal {
  return {
    id,
    value,
    label,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    metric: "distance_meters",
  };
}

/**
 * Services for `ACCOUNT_USER`, signed in, over an in-memory database holding the goals each
 * sport has saved for `year`. A sport left out has no goals saved, as for an athlete who
 * never set one.
 */
export function accountServices(year: number, goalsBySport: Record<string, Goal[]>) {
  const databaseService = new MockDatabaseService();
  databaseService.setMockData(ACCOUNT_CONFIG_PATH, {
    schemaVersion: "2.1",
    userId: ACCOUNT_USER.uid,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    goals: {
      [String(year)]: {
        sports: Object.fromEntries(
          Object.entries(goalsBySport).map(([sport, goals]) => [
            sport,
            { goals, storageVersion: GOAL_STORAGE_VERSION },
          ])
        ),
      },
    },
  });
  return { authService: new MockAuthService(ACCOUNT_USER), databaseService };
}
