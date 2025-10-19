import { doc, getDoc, setDoc, deleteDoc, onSnapshot, Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";
import type {
  UserConfig,
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
   * Get goals for a specific year
   */
  async getConfigSection(configType: "goals", year: number): Promise<GoalsForYear | null>;
  /**
   * Get all goals
   */
  async getConfigSection(configType: "goals"): Promise<{ [key: string]: GoalsForYear } | null>;
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
    year?: number
  ): Promise<
    | GoalsForYear
    | AnnotationsForYear
    | Preferences
    | { [key: string]: GoalsForYear | AnnotationsForYear }
    | null
  > {
    const config = await this.getConfig();
    if (!config) return null;

    const section = config[configType];
    if (!section) return null;

    // If year specified and section is year-keyed
    if (year !== undefined && configType === "goals") {
      const goalsSection = section as { [key: string]: GoalsForYear };
      return goalsSection[year.toString()] || null;
    } else if (year !== undefined && configType === "annotations") {
      const annotationsSection = section as { [key: string]: AnnotationsForYear };
      return annotationsSection[year.toString()] || null;
    }

    return section;
  }

  /**
   * Update goals for a specific year
   */
  async updateConfigSection(configType: "goals", data: GoalsForYear, year: number): Promise<void>;
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
    year?: number
  ): Promise<void> {
    try {
      const docRef = this.getDocRef();
      const existingConfig = await this.getConfig();

      const config: UserConfig = existingConfig || {
        schemaVersion: "1.0",
        userId: this.userId,
        lastUpdated: new Date().toISOString(),
        goals: {},
        annotations: {},
      };

      // Update specific section
      if (year !== undefined && configType !== "preferences") {
        // Year-keyed data (goals, annotations)
        if (!config[configType]) {
          config[configType] = {};
        }
        config[configType][year.toString()] = data as GoalsForYear | AnnotationsForYear;
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
   * Subscribe to goals for a specific year
   */
  subscribeToConfigSection(
    configType: "goals",
    callback: (data: GoalsForYear | null) => void,
    year: number
  ): Unsubscribe;
  /**
   * Subscribe to all goals
   */
  subscribeToConfigSection(
    configType: "goals",
    callback: (data: { [key: string]: GoalsForYear } | null) => void
  ): Unsubscribe;
  /**
   * Subscribe to annotations for a specific year
   */
  subscribeToConfigSection(
    configType: "annotations",
    callback: (data: AnnotationsForYear | null) => void,
    year: number
  ): Unsubscribe;
  /**
   * Subscribe to all annotations
   */
  subscribeToConfigSection(
    configType: "annotations",
    callback: (data: { [key: string]: AnnotationsForYear } | null) => void
  ): Unsubscribe;
  /**
   * Subscribe to preferences
   */
  subscribeToConfigSection(
    configType: "preferences",
    callback: (data: Preferences | null) => void
  ): Unsubscribe;
  /**
   * Implementation
   */
  subscribeToConfigSection(
    configType: "goals" | "annotations" | "preferences",
    callback: (data: any) => void,
    year?: number
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

      // If year specified and section is year-keyed
      if (year !== undefined && configType === "goals") {
        const goalsSection = section as { [key: string]: GoalsForYear };
        callback(goalsSection[year.toString()] || null);
      } else if (year !== undefined && configType === "annotations") {
        const annotationsSection = section as { [key: string]: AnnotationsForYear };
        callback(annotationsSection[year.toString()] || null);
      } else {
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
  GoalsForYear,
  AnnotationsForYear,
  Preferences,
  Metadata,
  Goal,
  Annotation,
};
