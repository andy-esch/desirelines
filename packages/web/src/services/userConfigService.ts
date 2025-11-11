import { doc, getDoc, setDoc, deleteDoc, onSnapshot, Unsubscribe } from "firebase/firestore";
import { db } from "../lib/firebase";
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
 * Service for managing user configuration in Firestore
 * Supports versioned configs with real-time sync
 */
export class UserConfigService {
  private userId: string;
  private version: string;

  constructor(userId: string = "default", version: string = "v1") {
    this.userId = userId;
    this.version = version;
  }

  /**
   * Get Firestore document reference for this user's config
   */
  private getDocRef() {
    return doc(db, "users", this.userId, "config", this.version);
  }

  /**
   * Get the full user configuration
   */
  async getConfig(): Promise<UserConfig | null> {
    try {
      const docRef = this.getDocRef();
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return docSnap.data() as UserConfig;
      }
      return null;
    } catch (error) {
      console.error("Error fetching user config:", error);
      throw error;
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
        schemaVersion: "2.0",
        userId: this.userId,
        lastUpdated: new Date().toISOString(),
        goals: {},
        annotations: {},
      };

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
      throw error;
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
      throw error;
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
          callback(doc.data() as UserConfig);
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

// Default instance for convenience
export const defaultConfigService = new UserConfigService("default", "v1");

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
