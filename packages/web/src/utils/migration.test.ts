import { describe, it, expect, beforeEach } from "vitest";
import { isGoalUnitMigrated, markGoalUnitMigrated, migrateGoalUnitsIfNeeded } from "./migration";
import {
  GOAL_STORAGE_VERSION,
  UserConfigSchema,
  UserConfigService,
  type GoalsForYear,
  type UserConfig,
} from "../services/userConfigService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MILES_TO_METERS, hoursToMinutes } from "./units";

const USER_ID = "user-abc";
const YEAR = 2026;

function makeGoals(values: number[], extra: Partial<GoalsForYear> = {}): GoalsForYear {
  return {
    goals: values.map((value, i) => ({
      id: String(i + 1),
      value,
      label: `Goal ${i + 1}`,
      metric: "",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    })),
    ...extra,
  };
}

describe("migrateGoalUnitsIfNeeded — detection order", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("short-circuits when payload already carries storageVersion === 2", () => {
    // Self-describing canonical data: trust the marker, skip every other check.
    const goals = makeGoals([3862425, 4828032], { storageVersion: GOAL_STORAGE_VERSION });
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    expect(result.needsSave).toBe(false);
    expect(result.goals).toBe(goals); // same reference — no transformation
  });

  it("does not stamp existing version when version is already current", () => {
    // Guard against pointless rewrites when the data is already correctly marked.
    const goals = makeGoals([3862425], { storageVersion: GOAL_STORAGE_VERSION });
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    expect(result.needsSave).toBe(false);
  });

  it("stamps the version without converting when the localStorage flag is set", () => {
    // Pre-version-field code marked migration via localStorage. The payload is
    // already canonical but lacks the version marker — stamp it on next write.
    markGoalUnitMigrated(USER_ID, YEAR, "cycling");
    const goals = makeGoals([3862425, 4828032]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    expect(result.needsSave).toBe(true);
    expect(result.goals.storageVersion).toBe(GOAL_STORAGE_VERSION);
    // Values unchanged — only the marker is new.
    expect(result.goals.goals[0]?.value).toBe(3862425);
    expect(result.goals.goals[1]?.value).toBe(4828032);
  });

  it("stamps via heuristic when distance values look canonical (>50k m)", () => {
    // No version, no flag — but values are clearly in meters. Mark and skip.
    const goals = makeGoals([3862425, 80000]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    expect(result.needsSave).toBe(true);
    expect(result.goals.storageVersion).toBe(GOAL_STORAGE_VERSION);
    expect(result.goals.goals[0]?.value).toBe(3862425); // unchanged
    expect(isGoalUnitMigrated(USER_ID, YEAR, "cycling")).toBe(true);
  });

  it("stamps via heuristic when time values look canonical (>1k min)", () => {
    // 6000 min = 100 hr/year — realistic yoga canonical value.
    const goals = makeGoals([6000, 9000]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "yoga", "time");

    expect(result.needsSave).toBe(true);
    expect(result.goals.storageVersion).toBe(GOAL_STORAGE_VERSION);
    expect(result.goals.goals[0]?.value).toBe(6000); // unchanged
  });

  it("converts and stamps when distance values look like miles (≤50k)", () => {
    // 2400 mi looks like a display-unit value — convert miles → meters.
    const goals = makeGoals([2400, 3000]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    expect(result.needsSave).toBe(true);
    expect(result.goals.storageVersion).toBe(GOAL_STORAGE_VERSION);
    expect(result.goals.goals[0]?.value).toBe(Math.round(2400 * MILES_TO_METERS));
    expect(result.goals.goals[1]?.value).toBe(Math.round(3000 * MILES_TO_METERS));
  });

  it("converts and stamps when time values look like hours (≤1k)", () => {
    // 100 hr → 6000 min. Mid-bucket: heuristic correctly flags as display.
    const goals = makeGoals([100, 150]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "yoga", "time");

    expect(result.needsSave).toBe(true);
    expect(result.goals.storageVersion).toBe(GOAL_STORAGE_VERSION);
    expect(result.goals.goals[0]?.value).toBe(Math.round(hoursToMinutes(100)));
    expect(result.goals.goals[1]?.value).toBe(Math.round(hoursToMinutes(150)));
  });

  it("uses `some()` semantics — one canonical value rescues the whole batch", () => {
    // Mixed goals: [2000 mi, 80000 m]. 80000 > 50000 → looks canonical
    // → assume all canonical, don't convert. Documents the known false-
    // negative window: a mixed batch survives intact rather than getting
    // partially corrupted.
    const goals = makeGoals([2000, 80000]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    expect(result.goals.goals[0]?.value).toBe(2000); // unconverted
    expect(result.goals.goals[1]?.value).toBe(80000); // unconverted
    expect(result.goals.storageVersion).toBe(GOAL_STORAGE_VERSION);
  });
});

/**
 * Integration: migration output × write-side schema validation.
 *
 * `UserConfigService.updateConfigSection` now validates the merged document
 * against `UserConfigSchema` before writing. `useGoalMigration` only marks a
 * user/year/sport as migrated on a successful save — so any payload that
 * fails validation triggers a retry loop on every page load forever.
 *
 * These tests pin that every branch of `migrateGoalUnitsIfNeeded` produces a
 * payload that survives the writer. If you change the migration's output
 * shape (new fields, dropped fields, type changes), one of these will catch
 * a silent regression before it reaches production.
 */
describe("migration output survives write-side validation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Wrap a GoalsForYear in a minimally-valid UserConfig so the schema parse runs end-to-end. */
  function wrapInConfig(goals: GoalsForYear, sport: string): UserConfig {
    return {
      schemaVersion: "2.1",
      userId: USER_ID,
      lastUpdated: "2025-01-01T00:00:00.000Z",
      goals: { [String(YEAR)]: { sports: { [sport]: goals } } },
      annotations: {},
    };
  }

  it("conversion branch: converted distance goals validate", () => {
    const goals = makeGoals([2400, 3000]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    const parsed = UserConfigSchema.safeParse(wrapInConfig(result.goals, "cycling"));
    expect(parsed.success).toBe(true);
  });

  it("conversion branch: converted time goals validate", () => {
    const goals = makeGoals([100, 150]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "yoga", "time");

    const parsed = UserConfigSchema.safeParse(wrapInConfig(result.goals, "yoga"));
    expect(parsed.success).toBe(true);
  });

  it("heuristic branch: stamped (but unconverted) goals validate", () => {
    const goals = makeGoals([3862425, 80000]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    const parsed = UserConfigSchema.safeParse(wrapInConfig(result.goals, "cycling"));
    expect(parsed.success).toBe(true);
  });

  it("flag branch: pre-versioned canonical goals stamp + validate", () => {
    markGoalUnitMigrated(USER_ID, YEAR, "cycling");
    const goals = makeGoals([3862425, 4828032]);
    const result = migrateGoalUnitsIfNeeded(goals, USER_ID, YEAR, "cycling", "distance");

    const parsed = UserConfigSchema.safeParse(wrapInConfig(result.goals, "cycling"));
    expect(parsed.success).toBe(true);
  });

  it("partial legacy data: missing proto fields still survive validation", () => {
    // Construct a payload that came from pre-proto code: goals lacking
    // `metric`, `createdAt`, and `updatedAt`. This shape can't exist in
    // current TypeScript so we deliberately cast through `unknown`. The
    // production read path fills these via Zod defaults, but if any code
    // ever hands the migration a raw partial, the migration must still
    // produce a validatable payload.
    const partialGoals = {
      goals: [
        { id: "1", value: 2400, label: "Conservative" },
        { id: "2", value: 3000, label: "Target" },
      ],
    } as unknown as GoalsForYear;

    const result = migrateGoalUnitsIfNeeded(partialGoals, USER_ID, YEAR, "cycling", "distance");

    // The merged config is what UserConfigService writes — validate that exact
    // shape, not just the goals subtree.
    const parsed = UserConfigSchema.safeParse(wrapInConfig(result.goals, "cycling"));
    expect(parsed.success).toBe(true);
  });

  it("end-to-end: migrated goals write successfully through UserConfigService", async () => {
    // Pipe a converted payload through the real UserConfigService → mock DB
    // with the production schema guard active. If the migration ever produces
    // something invalid, the write will throw and this test fails — exactly
    // the production behaviour we're protecting against.
    const databaseService = new MockDatabaseService();
    const authService = new MockAuthService({
      uid: USER_ID,
      email: null,
      displayName: null,
      photoURL: null,
    });
    const service = new UserConfigService(USER_ID, "v1", { authService, databaseService });

    const legacy = makeGoals([2400, 3000]);
    const { goals: migrated } = migrateGoalUnitsIfNeeded(
      legacy,
      USER_ID,
      YEAR,
      "cycling",
      "distance"
    );

    await expect(
      service.updateConfigSection("goals", migrated, YEAR, "cycling")
    ).resolves.toBeUndefined();

    // Confirm the doc landed in the mock DB with the canonical values intact.
    const stored = (await databaseService.getDocument(`users/${USER_ID}/config/v1`)) as UserConfig;
    const writtenGoals = stored.goals?.[String(YEAR)]?.sports.cycling?.goals;
    expect(writtenGoals).toBeDefined();
    expect(writtenGoals?.[0]?.value).toBe(Math.round(2400 * MILES_TO_METERS));
    expect(writtenGoals?.[1]?.value).toBe(Math.round(3000 * MILES_TO_METERS));
  });
});
