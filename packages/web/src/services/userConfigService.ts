import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  FirestoreError,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
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
 * Convert Firestore errors to user-friendly error messages
 */
function createUserFriendlyError(error: unknown, operation: string): Error {
  // Check if it's a Firestore error
  if (error && typeof error === "object" && "code" in error) {
    const firestoreError = error as FirestoreError;

    switch (firestoreError.code) {
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
        // For unknown Firestore errors, include the code for debugging
        return new Error(
          `Failed to ${operation}: ${firestoreError.message} (${firestoreError.code})`
        );
    }
  }

  // For non-Firestore errors, return generic message
  return error instanceof Error ? error : new Error(`Failed to ${operation}: Unknown error`);
}

/**
 * Current schema version for user config
 * Increment when making breaking changes to the data structure
 */
const CURRENT_SCHEMA_VERSION = "2.0";

/**
 * Service for managing user configuration in Firestore
 * Supports versioned configs with real-time sync
 */
export class UserConfigService {
  private userId: string;
  private version: string;

  /**
   * @param userId - Optional userId to use for Firestore operations.
   *   - If not provided: uses authenticated user's UID, or "default" if not authenticated
   *   - If provided: uses the specified userId
   *   WARNING: Providing an explicit userId when authenticated will throw an error
   *   unless it matches the authenticated user's UID. This prevents accidental
   *   cross-user data access.
   * @param version - Config version (defaults to "v1")
   */
  constructor(userId?: string, version: string = "v1") {
    const currentUser = auth.currentUser;

    // Resolve userId: explicit > auth user > "default"
    this.userId = userId ?? currentUser?.uid ?? "default";
    this.version = version;

    // CRITICAL: Validate userId matches authenticated user when explicitly provided
    // This prevents bugs where an explicit userId doesn't match the auth state
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
   * Get Firestore document reference for this user's config
   */
  private getDocRef() {
    return doc(db, "users", this.userId, "config", this.version);
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
      const docRef = this.getDocRef();
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const config = docSnap.data() as UserConfig;
        this.validateSchemaVersion(config);
        return config;
      }
      return null;
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
      const docRef = this.getDocRef();
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
      await setDoc(docRef, config, { merge: true });
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
      const docRef = this.getDocRef();
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error deleting user config:", error);
      throw createUserFriendlyError(error, "delete your settings");
    }
  }

  /**
   * Subscribe to real-time config updates
   * Returns an unsubscribe function to stop listening
   */
  subscribeToConfig(callback: (config: UserConfig | null) => void): Unsubscribe {
    const docRef = this.getDocRef();

    return onSnapshot(
      docRef,
      (doc) => {
        if (doc.exists()) {
          const config = doc.data() as UserConfig;
          this.validateSchemaVersion(config);
          callback(config);
        } else {
          callback(null);
        }
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
  ): Unsubscribe {
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
