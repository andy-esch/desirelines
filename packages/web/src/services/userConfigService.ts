import { z } from "zod";
import type { AuthService } from "./auth/AuthService";
import type { DatabaseService } from "./database/DatabaseService";
import { FirebaseAuthService } from "./auth/FirebaseAuthService";
import { FirestoreService } from "./database/FirestoreService";
import { isDatabaseError } from "./database/DatabaseService";
import { logger } from "../lib/logger";
import type {
  UserConfig,
  SportGoalsForYear,
  GoalsForYear as ProtoGoalsForYear,
  AnnotationsForYear,
  Preferences,
  Metadata,
  Goal,
  Annotation,
} from "../types/generated/user_config";

/**
 * Web-side `GoalsForYear` shape.
 *
 * Extends the protobuf-generated type with `storageVersion`, an optional
 * marker that records the unit convention of `goal.value`:
 *   undefined / 1 → legacy display units (miles, hours)
 *   2             → canonical units (meters, minutes)
 *
 * The proto schema is intentionally not updated for this — only the web client
 * cares about display vs. canonical units, and the Firestore Zod schema
 * (`GoalsForYearSchema`) is `.passthrough()`, so the extra field round-trips.
 */
export interface GoalsForYear extends ProtoGoalsForYear {
  storageVersion?: number;
}

/**
 * Zod schemas for runtime validation of Firestore UserConfig documents.
 * Mirrors the proto-generated types in types/generated/user_config.ts.
 *
 * Firestore is schemaless — documents written before a proto field was added
 * won't have that field. These helpers apply proto default semantics so missing
 * fields resolve to the same default value the proto would assign, while still
 * validating types when the field is present.
 *
 * All object schemas use .passthrough() so unknown fields survive the
 * read-modify-write cycle in updateConfigSection without silent data loss.
 */

// Proto-default-aware field helpers: missing → proto default, present → type-checked
const proto = {
  string: () => z.string().optional().default(""),
  number: () => z.number().optional().default(0),
  int: () => z.number().int().optional().default(0),
  boolean: () => z.boolean().optional().default(false),
  stringArray: () => z.array(z.string()).optional().default([]),
};

const ChartDefaultsSchema = z
  .object({
    showAverage: proto.boolean(),
    showGoals: proto.boolean(),
  })
  .passthrough();

const PreferencesSchema = z
  .object({
    theme: proto.string(),
    defaultYear: proto.int(),
    chartDefaults: ChartDefaultsSchema.optional(),
    distanceUnit: proto.string(),
    elevationUnit: proto.string(),
    defaultSport: proto.string(),
    timezone: proto.string(),
    visibleSports: proto.stringArray(),
  })
  .passthrough();

const MetadataSchema = z
  .object({
    createdAt: proto.string(),
    lastSyncedDevice: proto.string(),
    configTypes: proto.stringArray(),
  })
  .passthrough();

const GoalSchema = z
  .object({
    id: proto.string(),
    value: proto.int(),
    label: proto.string(),
    createdAt: proto.string(),
    updatedAt: proto.string(),
    metric: proto.string(),
  })
  .passthrough();

const GoalsForYearSchema = z
  .object({
    goals: z.array(GoalSchema).optional().default([]),
    // `storageVersion` marks the unit convention of `goal.value`:
    //   undefined / 1 → legacy display units (miles, hours)
    //   2             → canonical units (meters, minutes)
    // Migration logic upgrades legacy payloads and stamps version 2 going forward.
    storageVersion: z.number().int().optional(),
  })
  .passthrough();

/** Canonical storage version for goal values (meters for distance, minutes for time). */
export const GOAL_STORAGE_VERSION = 2;

const SportGoalsForYearSchema = z
  .object({
    sports: z.record(z.string(), GoalsForYearSchema).optional().default({}),
  })
  .passthrough();

const AnnotationSchema = z
  .object({
    id: proto.string(),
    startDate: proto.string(),
    endDate: proto.string(),
    label: proto.string(),
    description: proto.string(),
    stravaActivityId: proto.string(),
    type: proto.int(),
    createdAt: proto.string(),
    updatedAt: proto.string(),
  })
  .passthrough();

const AnnotationsForYearSchema = z
  .object({
    annotations: z.array(AnnotationSchema).optional().default([]),
  })
  .passthrough();

export const UserConfigSchema = z
  .object({
    schemaVersion: proto.string(),
    userId: proto.string(),
    lastUpdated: proto.string(),
    goals: z.record(z.string(), SportGoalsForYearSchema).optional().default({}),
    annotations: z.record(z.string(), AnnotationsForYearSchema).optional().default({}),
    preferences: PreferencesSchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .passthrough();

/**
 * Compile-time drift guard: tsc will error here if the Zod schema's output
 * type diverges from the proto-generated UserConfig (e.g., proto adds a
 * required field that the schema doesn't produce).
 *
 * If this line fails to compile after running `just proto-gen`, update the
 * schemas above to match the new proto fields.
 */
function _assertSchemaMatchesProto(_output: z.output<typeof UserConfigSchema>): UserConfig {
  return _output;
}
void _assertSchemaMatchesProto;

/**
 * Validate a config payload (parsed JSON) against the Zod schema for its type.
 *
 * Used by:
 *   - the localStorage→Firestore sign-in migration in useUserConfig, to reject
 *     malformed demo data before it's written into the source of truth
 *   - the demo-mode read path in useUserConfig, to reject corrupted localStorage
 *     blobs before they reach the rest of the app
 *
 * Returns a discriminated `{ ok: true, data } | { ok: false, error }` so the
 * caller can `logApiError(result.error)` for diagnostic context.
 */
export function parseConfigData(
  configType: "goals" | "annotations" | "preferences",
  data: unknown
):
  | { ok: true; data: GoalsForYear | AnnotationsForYear | Preferences }
  | { ok: false; error: z.ZodError } {
  if (configType === "goals") {
    const result = GoalsForYearSchema.safeParse(data);
    return result.success
      ? { ok: true, data: result.data as GoalsForYear }
      : { ok: false, error: result.error };
  }
  if (configType === "annotations") {
    const result = AnnotationsForYearSchema.safeParse(data);
    return result.success
      ? { ok: true, data: result.data as AnnotationsForYear }
      : { ok: false, error: result.error };
  }
  const result = PreferencesSchema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data as Preferences }
    : { ok: false, error: result.error };
}

/**
 * Convert database errors to user-friendly error messages
 */
function createUserFriendlyError(error: unknown, operation: string): Error {
  if (isDatabaseError(error)) {
    switch (error.code) {
      case "permission-denied":
        return new Error(
          "You do not have permission to access this data. Please sign in with an authorized account."
        );
      case "unauthenticated":
        return new Error("You must be signed in to save your data. Please sign in and try again.");
      case "not-found":
        return new Error("The requested data could not be found. It may have been deleted.");
      case "unavailable":
        return new Error(
          "Unable to connect to the server. Please check your internet connection and try again."
        );
      case "deadline-exceeded":
        return new Error("The operation took too long. Please try again.");
      case "resource-exhausted":
        return new Error("Too many requests. Please wait a moment and try again.");
      default:
        return new Error(`Failed to ${operation}: ${error.message} (${error.code})`);
    }
  }

  return error instanceof Error ? error : new Error(`Failed to ${operation}: Unknown error`);
}

/**
 * Current schema version stamped on user-config writes.
 *
 * Schema evolution is **additive-only**: new optional fields can be added at
 * any time, but existing fields are never removed, retyped, or semantically
 * repurposed in place. Under that rule, any prior-version document is still
 * valid under the current schema by definition, so no migration step runs
 * on read.
 *
 * The version is kept as an informational stamp (useful for telemetry and
 * for future "did we hit a snapshot point" debugging) and is bumped only
 * when we ship a new shape — bumping is record-keeping, not gating.
 *
 * If the additive-only rule ever needs to be broken, build a versioned
 * migration registry (`Record<fromVersion, (cfg) => UserConfig>`) keyed by
 * version pairs and run it on read. Not currently warranted — the app is
 * single-tenant and the frontend is the sole writer.
 */
const CURRENT_SCHEMA_VERSION = "2.1";

/**
 * Options for UserConfigService constructor
 */
export interface UserConfigServiceOptions {
  authService?: AuthService;
  databaseService?: DatabaseService;
}

/**
 * Service for managing user configuration
 * Supports versioned configs with real-time sync
 *
 * Uses dependency injection for auth and database services.
 * Defaults to Firebase implementations if not provided.
 */
export class UserConfigService {
  private explicitUserId: string | undefined;
  private version: string;
  private authService: AuthService;
  private databaseService: DatabaseService;

  /**
   * @param userId - Optional userId to use for operations.
   *   - If not provided: uses authenticated user's UID (re-evaluated on each operation); throws if not authenticated
   *   - If provided: uses the specified userId (fixed for the lifetime of this instance)
   *   WARNING: Providing an explicit userId when authenticated will throw an error
   *   unless it matches the authenticated user's UID.
   * @param version - Config version (defaults to "v1")
   * @param options - Optional service dependencies (defaults to Firebase implementations)
   */
  constructor(userId?: string, version: string = "v1", options?: UserConfigServiceOptions) {
    // Use provided services or default to Firebase implementations
    this.authService = options?.authService ?? new FirebaseAuthService();
    this.databaseService = options?.databaseService ?? new FirestoreService();

    this.explicitUserId = userId;
    this.version = version;

    // Validate at construction if explicit userId provided and user is authenticated
    if (userId !== undefined) {
      this.validateExplicitUserId(userId);
    }
  }

  /**
   * Validate that an explicit userId matches the authenticated user (if any)
   */
  private validateExplicitUserId(userId: string): void {
    const currentUser = this.authService.getCurrentUser();
    if (currentUser && currentUser.uid !== userId) {
      throw new Error(
        "UserConfigService: userId mismatch! " +
          "The provided userId does not match the authenticated user. " +
          "This likely indicates a bug in how userId is being passed to UserConfigService."
      );
    }
  }

  /**
   * Get the effective userId for operations.
   * If an explicit userId was provided at construction, uses that.
   * Otherwise, re-evaluates the current auth state on each call.
   */
  private getEffectiveUserId(): string {
    if (this.explicitUserId !== undefined) {
      // Re-validate on each call to catch auth state changes
      this.validateExplicitUserId(this.explicitUserId);
      return this.explicitUserId;
    }

    // Dynamic: use current auth user (reject unauthenticated operations)
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      throw new Error(
        "UserConfigService: No authenticated user. " +
          "Firestore operations require authentication. Use localStorage for unauthenticated users."
      );
    }
    return currentUser.uid;
  }

  /**
   * Get the current userId being used for operations.
   * Useful for debugging and logging.
   */
  get userId(): string {
    return this.getEffectiveUserId();
  }

  /**
   * Get document path for this user's config
   */
  private getDocPath(): string {
    return `users/${this.getEffectiveUserId()}/config/${this.version}`;
  }

  /**
   * Get the full user configuration
   */
  async getConfig(): Promise<UserConfig | null> {
    try {
      const config = await this.databaseService.getDocument<UserConfig>(this.getDocPath(), {
        schema: UserConfigSchema,
      });

      return config;
    } catch (error) {
      logger.error("Error fetching user config:", error);
      throw createUserFriendlyError(error, "load your settings");
    }
  }

  /**
   * Get goals for a specific year and sport
   */
  async getConfigSection(
    configType: "goals",
    year: number,
    sport: string
  ): Promise<GoalsForYear | null>;
  /**
   * Get all sports' goals for a specific year
   */
  async getConfigSection(configType: "goals", year: number): Promise<SportGoalsForYear | null>;
  /**
   * Get all goals (all years, all sports)
   */
  async getConfigSection(configType: "goals"): Promise<{ [key: string]: SportGoalsForYear } | null>;
  /**
   * Get annotations for a specific year
   */
  async getConfigSection(
    configType: "annotations",
    year: number
  ): Promise<AnnotationsForYear | null>;
  /**
   * Get all annotations
   */
  async getConfigSection(
    configType: "annotations"
  ): Promise<{ [key: string]: AnnotationsForYear } | null>;
  /**
   * Get preferences
   */
  async getConfigSection(configType: "preferences"): Promise<Preferences | null>;
  /**
   * Implementation
   */
  async getConfigSection(
    configType: "goals" | "annotations" | "preferences",
    year?: number,
    sport?: string
  ): Promise<
    | GoalsForYear
    | SportGoalsForYear
    | AnnotationsForYear
    | Preferences
    | { [key: string]: SportGoalsForYear | AnnotationsForYear }
    | null
  > {
    const config = await this.getConfig();
    if (!config) return null;

    return this.selectConfigSection(config, configType, year, sport);
  }

  /**
   * Drill into a config section by year/sport. Shared by getConfigSection
   * (which returns the value) and subscribeToConfigSection (which passes it to
   * a callback) so the goals/annotations nesting and the `as` casts live in
   * exactly one place. Returns null when the section or requested year is absent.
   */
  private selectConfigSection(
    config: UserConfig,
    configType: "goals" | "annotations" | "preferences",
    year?: number,
    sport?: string
  ):
    | GoalsForYear
    | SportGoalsForYear
    | AnnotationsForYear
    | Preferences
    | { [key: string]: SportGoalsForYear }
    | { [key: string]: AnnotationsForYear }
    | null {
    const section = config[configType];
    if (!section) return null;

    // Handle goals with year and sport
    if (year !== undefined && sport !== undefined && configType === "goals") {
      const goalsSection = section as { [key: string]: SportGoalsForYear };
      const yearGoals = goalsSection[year.toString()];
      if (!yearGoals) return null;
      return yearGoals.sports[sport] || null;
    }
    // Handle goals with year only (return all sports)
    else if (year !== undefined && configType === "goals") {
      const goalsSection = section as { [key: string]: SportGoalsForYear };
      return goalsSection[year.toString()] || null;
    }
    // Handle annotations with year
    else if (year !== undefined && configType === "annotations") {
      const annotationsSection = section as { [key: string]: AnnotationsForYear };
      return annotationsSection[year.toString()] || null;
    }

    return section;
  }

  /**
   * Update goals for a specific year and sport
   */
  async updateConfigSection(
    configType: "goals",
    data: GoalsForYear,
    year: number,
    sport: string
  ): Promise<void>;
  /**
   * Update annotations for a specific year
   */
  async updateConfigSection(
    configType: "annotations",
    data: AnnotationsForYear,
    year: number
  ): Promise<void>;
  /**
   * Update preferences
   */
  async updateConfigSection(configType: "preferences", data: Preferences): Promise<void>;
  /**
   * Implementation
   */
  async updateConfigSection(
    configType: "goals" | "annotations" | "preferences",
    data: GoalsForYear | AnnotationsForYear | Preferences,
    year?: number,
    sport?: string
  ): Promise<void> {
    try {
      const existingConfig = await this.getConfig();

      const config: UserConfig = existingConfig || {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        userId: this.userId,
        lastUpdated: new Date().toISOString(),
        goals: {},
        annotations: {},
      };

      // Always stamp the current schema version on write — informational
      // under the additive-only policy (see CURRENT_SCHEMA_VERSION doc).
      config.schemaVersion = CURRENT_SCHEMA_VERSION;

      // Update specific section
      if (year !== undefined && sport !== undefined && configType === "goals") {
        // Goals with year and sport - nested structure
        if (!config.goals) {
          config.goals = {};
        }
        const yearKey = year.toString();
        const yearGoals = (config.goals[yearKey] ??= { sports: {} });
        yearGoals.sports ??= {};
        yearGoals.sports[sport] = data as GoalsForYear;
      } else if (year !== undefined && configType === "annotations") {
        // Annotations with year (no sport dimension)
        if (!config.annotations) {
          config.annotations = {};
        }
        config.annotations[year.toString()] = data as AnnotationsForYear;
      } else if (configType === "preferences") {
        // Global data (preferences)
        config.preferences = data as Preferences;
      }

      // Update timestamp
      config.lastUpdated = new Date().toISOString();

      // Validate the merged document against UserConfigSchema before writing.
      // The schema-on-write guard catches the bug class from 2026-03-23 — a
      // numeric `Goal.metric` rejected on read but persisted earlier without
      // complaint. Validation happens on the full merged doc, not the partial
      // section, because the partial would always be incomplete by definition
      // (e.g. a goals-only update has no `userId` or `preferences`).
      //
      // Use merge to avoid overwriting other fields.
      await this.databaseService.setDocument(this.getDocPath(), config, {
        merge: true,
        schema: UserConfigSchema,
      });
    } catch (error) {
      logger.error("Error updating user config:", error);
      throw createUserFriendlyError(error, "save your changes");
    }
  }

  /**
   * Delete the entire config document
   */
  async deleteConfig(): Promise<void> {
    try {
      await this.databaseService.deleteDocument(this.getDocPath());
    } catch (error) {
      logger.error("Error deleting user config:", error);
      throw createUserFriendlyError(error, "delete your settings");
    }
  }

  /**
   * Subscribe to real-time config updates
   * Returns an unsubscribe function to stop listening
   */
  subscribeToConfig(callback: (config: UserConfig | null) => void): () => void {
    return this.databaseService.subscribeToDocument<UserConfig>(
      this.getDocPath(),
      callback,
      (error) => {
        logger.error("Error in config subscription:", error);
        callback(null);
      },
      { schema: UserConfigSchema }
    );
  }

  /**
   * Subscribe to a specific config section.
   *
   * For goals:
   * - With year + sport: callback receives GoalsForYear | null
   * - With year only: callback receives SportGoalsForYear | null (all sports for year)
   * - Without year: callback receives { [year: string]: SportGoalsForYear } | null (all years, all sports)
   *
   * For annotations:
   * - With year: callback receives AnnotationsForYear | null
   * - Without year: callback receives { [year: string]: AnnotationsForYear } | null
   *
   * For preferences:
   * - callback receives Preferences | null
   */
  subscribeToConfigSection(
    configType: "goals" | "annotations" | "preferences",
    callback: (
      data:
        | GoalsForYear
        | SportGoalsForYear
        | AnnotationsForYear
        | Preferences
        | { [key: string]: SportGoalsForYear }
        | { [key: string]: AnnotationsForYear }
        | null
    ) => void,
    year?: number,
    sport?: string
  ): () => void {
    return this.subscribeToConfig((config) => {
      if (!config) {
        callback(null);
        return;
      }

      callback(this.selectConfigSection(config, configType, year, sport));
    });
  }
}

// Re-export protobuf types for convenience.
// GoalsForYear is declared above (extends ProtoGoalsForYear with storageVersion).
export type {
  UserConfig,
  SportGoalsForYear,
  AnnotationsForYear,
  Preferences,
  Metadata,
  Goal,
  Annotation,
};
