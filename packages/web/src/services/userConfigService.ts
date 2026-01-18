import type { AuthService } from "./auth/AuthService";
import type { DatabaseService } from "./database/DatabaseService";
import { getFirebaseAuthService } from "./auth/FirebaseAuthService";
import { getFirestoreService } from "./database/FirestoreService";
import { isDatabaseError } from "./database/DatabaseService";
import type {
  UserConfig,
  SportGoalsForYear,
  GoalsForYear,
  AnnotationsForYear,
  Preferences,
  Metadata,
  Goal,
  Annotation,
} from "../types/generated/user_config";

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
 * Current schema version for user config
 * Increment when making breaking changes to the data structure
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
  private userId: string;
  private version: string;
  private authService: AuthService;
  private databaseService: DatabaseService;

  /**
   * @param userId - Optional userId to use for operations.
   *   - If not provided: uses authenticated user's UID, or "default" if not authenticated
   *   - If provided: uses the specified userId
   *   WARNING: Providing an explicit userId when authenticated will throw an error
   *   unless it matches the authenticated user's UID.
   * @param version - Config version (defaults to "v1")
   * @param options - Optional service dependencies (defaults to Firebase implementations)
   */
  constructor(userId?: string, version: string = "v1", options?: UserConfigServiceOptions) {
    // Use provided services or default to Firebase implementations
    this.authService = options?.authService ?? getFirebaseAuthService();
    this.databaseService = options?.databaseService ?? getFirestoreService();

    const currentUser = this.authService.getCurrentUser();

    // Resolve userId: explicit > auth user > "default"
    this.userId = userId ?? currentUser?.uid ?? "default";
    this.version = version;

    // CRITICAL: Validate userId matches authenticated user when explicitly provided
    if (currentUser && userId !== undefined) {
      if (currentUser.uid !== userId) {
        throw new Error(
          `UserConfigService: userId mismatch! ` +
            `Attempted to access config for userId="${userId}" ` +
            `but authenticated user is "${currentUser.uid}". ` +
            `This likely indicates a bug in how userId is being passed to UserConfigService.`
        );
      }
    }
  }

  /**
   * Get document path for this user's config
   */
  private getDocPath(): string {
    return `users/${this.userId}/config/${this.version}`;
  }

  /**
   * Validate schema version and warn if there's a mismatch
   */
  private validateSchemaVersion(config: UserConfig): void {
    if (!config.schemaVersion) {
      console.warn(`⚠️ User config is missing schema version. Expected: ${CURRENT_SCHEMA_VERSION}`);
      return;
    }

    if (config.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.warn(
        `⚠️ Schema version mismatch! Config has: ${config.schemaVersion}, Code expects: ${CURRENT_SCHEMA_VERSION}. ` +
          `Data will be auto-upgraded on next write.`
      );
    }
  }

  /**
   * Get the full user configuration
   */
  async getConfig(): Promise<UserConfig | null> {
    try {
      const config = await this.databaseService.getDocument<UserConfig>(this.getDocPath());

      if (config) {
        this.validateSchemaVersion(config);
      }
      return config;
    } catch (error) {
      console.error("Error fetching user config:", error);
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

      // Ensure schema version is updated for existing configs
      if (config.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        config.schemaVersion = CURRENT_SCHEMA_VERSION;
      }

      // Update specific section
      if (year !== undefined && sport !== undefined && configType === "goals") {
        // Goals with year and sport - nested structure
        if (!config.goals) {
          config.goals = {};
        }
        if (!config.goals[year.toString()]) {
          config.goals[year.toString()] = { sports: {} };
        }
        if (!config.goals[year.toString()].sports) {
          config.goals[year.toString()].sports = {};
        }
        config.goals[year.toString()].sports[sport] = data as GoalsForYear;
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

      // Use merge to avoid overwriting other fields
      await this.databaseService.setDocument(this.getDocPath(), config, { merge: true });
    } catch (error) {
      console.error("Error updating user config:", error);
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
      console.error("Error deleting user config:", error);
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
      (config) => {
        if (config) {
          this.validateSchemaVersion(config);
        }
        callback(config);
      },
      (error) => {
        console.error("Error in config subscription:", error);
        callback(null);
      }
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

      const section = config[configType];
      if (!section) {
        callback(null);
        return;
      }

      // Handle goals with year and sport
      if (year !== undefined && sport !== undefined && configType === "goals") {
        const goalsSection = section as { [key: string]: SportGoalsForYear };
        const yearGoals = goalsSection[year.toString()];
        if (!yearGoals) {
          callback(null);
          return;
        }
        callback(yearGoals.sports[sport] || null);
      }
      // Handle goals with year only (return all sports)
      else if (year !== undefined && configType === "goals") {
        const goalsSection = section as { [key: string]: SportGoalsForYear };
        callback(goalsSection[year.toString()] || null);
      }
      // Handle annotations with year
      else if (year !== undefined && configType === "annotations") {
        const annotationsSection = section as { [key: string]: AnnotationsForYear };
        callback(annotationsSection[year.toString()] || null);
      }
      // Return full section (all years)
      else {
        callback(section);
      }
    });
  }
}

// Default instance for convenience (uses authenticated user's UID, or "default" if not authenticated)
export const defaultConfigService = new UserConfigService();

// Re-export protobuf types for convenience
export type {
  UserConfig,
  SportGoalsForYear,
  GoalsForYear,
  AnnotationsForYear,
  Preferences,
  Metadata,
  Goal,
  Annotation,
};
