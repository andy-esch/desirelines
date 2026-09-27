/**
 * Integration tests for UserConfigService
 *
 * These tests use Firebase emulators to test actual Firestore operations
 * and authentication flows. They verify:
 * - Real read/write operations work correctly
 * - Runtime assertions catch userId mismatches
 * - Cross-user data isolation works
 * - Authentication state is properly handled
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signInAnonymously, signOut } from "firebase/auth";
import { doc, getDoc, deleteDoc } from "firebase/firestore";
import type { GoalsForYear, AnnotationsForYear, Preferences } from "../types/generated/user_config";
import { AnnotationType } from "../types/generated/user_config";
import { testAuth, testDb } from "../test/integration-setup";

// Mock the firebase module to use our test emulator instances
vi.mock("../lib/firebase", () => ({
  auth: testAuth,
  db: testDb,
  waitForAuthReady: vi.fn().mockResolvedValue(undefined),
}));

import { UserConfigService } from "./userConfigService";
import { selectSection } from "./config/sections";

// One section as saved, read back through the whole document, as the store reads it.
const readGoals = async (service: UserConfigService, year: number, sport: string) =>
  selectSection(await service.getConfig(), { section: "goals", year, sport });
const readAnnotations = async (service: UserConfigService, year: number) =>
  selectSection(await service.getConfig(), { section: "annotations", year });
const readPreferences = async (service: UserConfigService) =>
  selectSection(await service.getConfig(), { section: "preferences" });

describe("UserConfigService Integration Tests", () => {
  let currentUserId: string | null = null;

  beforeEach(async () => {
    // Sign out before each test to start fresh
    if (testAuth.currentUser) {
      await signOut(testAuth);
    }
    currentUserId = null;
  });

  afterEach(async () => {
    // Clean up test data after each test
    if (currentUserId) {
      try {
        const configRef = doc(testDb, `users/${currentUserId}/config/v1`);
        await deleteDoc(configRef);
      } catch {
        // Ignore errors if document doesn't exist
      }
    }

    // Sign out after cleanup
    if (testAuth.currentUser) {
      await signOut(testAuth);
    }
  });

  describe("Authentication and userId resolution", () => {
    it("should auto-resolve userId to authenticated user's UID", async () => {
      // Sign in anonymously (creates user with random UID)
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      // Create service without explicit userId (should auto-resolve)
      const service = new UserConfigService();

      // Write some data
      const testGoals: GoalsForYear = {
        goals: [
          {
            id: "test-goal-1",
            value: 1000,
            label: "Test goal",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
        ],
      };
      await service.updateConfigSection("goals", testGoals, 2025, "cycling");

      // Verify data was written to correct path (user's UID, not "default")
      const configRef = doc(testDb, `users/${currentUserId}/config/v1`);
      const configSnap = await getDoc(configRef);

      expect(configSnap.exists()).toBe(true);
      const config = configSnap.data();
      expect(config?.goals?.["2025"]?.sports?.cycling).toEqual(testGoals);
    });

    it("should throw error when explicit userId doesn't match authenticated user", async () => {
      // Sign in as user
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      // Try to create service with different userId
      expect(() => {
        new UserConfigService("different-user-id");
      }).toThrow("userId mismatch");
    });

    it("should allow creating service when not authenticated (fixture mode)", async () => {
      // Don't sign in - no authenticated user
      expect(testAuth.currentUser).toBeNull();

      // Should not throw - falls back to "default"
      const service = new UserConfigService();
      expect(service).toBeDefined();
    });
  });

  describe("CRUD operations", () => {
    it("should write and read goals configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Write goals
      const testGoals: GoalsForYear = {
        goals: [
          {
            id: "goal-1",
            value: 1000,
            label: "Conservative",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
          {
            id: "goal-2",
            value: 1500,
            label: "Target",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
        ],
      };
      await service.updateConfigSection("goals", testGoals, 2025, "cycling");

      // Read back
      const retrieved = await readGoals(service, 2025, "cycling");

      expect(retrieved).toEqual(testGoals);
    });

    it("should write and read annotations configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Write annotations
      const testAnnotations: AnnotationsForYear = {
        annotations: [
          {
            id: "annotation-1",
            startDate: "2025-06-01",
            endDate: "",
            label: "Test event",
            description: "",
            stravaActivityId: "",
            type: AnnotationType.ANNOTATION_TYPE_EVENT,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
      await service.updateConfigSection("annotations", testAnnotations, 2025);

      // Read back
      const retrieved = await readAnnotations(service, 2025);

      expect(retrieved).toEqual(testAnnotations);
    });

    it("should write and read preferences configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Write preferences. The theme has its own writer, and a preferences save leaves
      // it as stored rather than writing the one it carries.
      const testPrefs: Preferences = {
        theme: "arcade",
        defaultYear: 2025,
        distanceUnit: "miles",
        elevationUnit: "feet",
        defaultSport: "cycling",
        timezone: "",
        visibleSports: [],
      };
      await service.updateTheme("arcade");
      await service.updateConfigSection("preferences", { ...testPrefs, theme: "" });

      // Read back
      const retrieved = await readPreferences(service);

      expect(retrieved).toEqual(testPrefs);
    });

    it("should write the theme alone, creating the document and keeping other preferences", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // A new user: the rules require schemaVersion, userId and lastUpdated on create.
      await service.updateTheme("miami");
      expect((await readPreferences(service))?.theme).toBe("miami");

      await service.updateConfigSection("preferences", {
        theme: "",
        defaultYear: 2025,
        distanceUnit: "kilometers",
        elevationUnit: "meters",
        defaultSport: "running",
        timezone: "Europe/Paris",
        visibleSports: ["running"],
      });
      await service.updateTheme("arcade");

      expect(await readPreferences(service)).toEqual({
        theme: "arcade",
        defaultYear: 2025,
        distanceUnit: "kilometers",
        elevationUnit: "meters",
        defaultSport: "running",
        timezone: "Europe/Paris",
        visibleSports: ["running"],
      });
    });

    it("should update existing configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Initial write
      const initialGoals: GoalsForYear = {
        goals: [
          {
            id: "goal-initial",
            value: 1000,
            label: "Initial",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
        ],
      };
      await service.updateConfigSection("goals", initialGoals, 2025, "cycling");

      // Update
      const updatedGoals: GoalsForYear = {
        goals: [
          {
            id: "goal-updated",
            value: 2000,
            label: "Updated",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
        ],
      };
      await service.updateConfigSection("goals", updatedGoals, 2025, "cycling");

      // Verify update
      const retrieved = await readGoals(service, 2025, "cycling");
      expect(retrieved).toEqual(updatedGoals);
    });

    describe("concurrent saves to different sections", () => {
      const goals = (id: string): GoalsForYear => ({
        goals: [
          {
            id,
            value: 1000,
            label: id,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            metric: "",
          },
        ],
      });
      const prefs = (distanceUnit: string): Preferences => ({
        theme: "",
        defaultYear: 2025,
        distanceUnit,
        elevationUnit: "feet",
        defaultSport: "cycling",
        timezone: "",
        visibleSports: [],
      });

      // Each pair starts together, so a save that read the document first would read it
      // before the other's write, and put that stale copy back when it landed second.
      it("keeps both first saves of a new account", async () => {
        const userCred = await signInAnonymously(testAuth);
        currentUserId = userCred.user.uid;
        const service = new UserConfigService();

        await Promise.all([
          service.updateConfigSection("goals", goals("cycling"), 2025, "cycling"),
          service.updateConfigSection("preferences", prefs("kilometers")),
        ]);

        expect(await readGoals(service, 2025, "cycling")).toEqual(goals("cycling"));
        expect((await readPreferences(service))?.distanceUnit).toBe("kilometers");
      });

      it("keeps a preferences change saved alongside a goals save", async () => {
        const userCred = await signInAnonymously(testAuth);
        currentUserId = userCred.user.uid;
        const service = new UserConfigService();
        await service.updateConfigSection("preferences", prefs("miles"));

        await Promise.all([
          service.updateConfigSection("preferences", prefs("kilometers")),
          service.updateConfigSection("goals", goals("running"), 2025, "running"),
        ]);

        expect((await readPreferences(service))?.distanceUnit).toBe("kilometers");
        expect(await readGoals(service, 2025, "running")).toEqual(goals("running"));
      });
    });

    it("should return null for non-existent configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Try to read data that doesn't exist
      const retrieved = await readGoals(service, 2025, "cycling");

      expect(retrieved).toBeNull();
    });
  });

  describe("Cross-user isolation", () => {
    it("should not allow user A to see user B's data", async () => {
      // User A signs in and writes data
      const userACredential = await signInAnonymously(testAuth);
      const userAId = userACredential.user.uid;
      currentUserId = userAId; // For cleanup

      const serviceA = new UserConfigService();
      const userAGoals: GoalsForYear = {
        goals: [
          {
            id: "goal-user-a",
            value: 9999,
            label: "User A data",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
        ],
      };
      await serviceA.updateConfigSection("goals", userAGoals, 2025, "cycling");

      // Verify user A can read their own data
      const userAData = await readGoals(serviceA, 2025, "cycling");
      expect(userAData).toEqual(userAGoals);

      // Sign out user A
      await signOut(testAuth);

      // User B signs in
      const userBCredential = await signInAnonymously(testAuth);
      const userBId = userBCredential.user.uid;

      const serviceB = new UserConfigService();

      // User B tries to read their own data (should be null - they have no data)
      const userBData = await readGoals(serviceB, 2025, "cycling");
      expect(userBData).toBeNull();

      // User B tries to access user A's data directly (should fail with permission error)
      const userAConfigRef = doc(testDb, `users/${userAId}/config/v1`);
      await expect(getDoc(userAConfigRef)).rejects.toThrow();

      // Clean up user B's potential data
      try {
        const userBConfigRef = doc(testDb, `users/${userBId}/config/v1`);
        await deleteDoc(userBConfigRef);
      } catch {
        // Ignore - no data to clean
      }
    });
  });

  describe("Real-time subscriptions", () => {
    it("should receive updates via subscription", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Set up the document listener the store uses, and read the section from each copy.
      const updates: (GoalsForYear | null)[] = [];
      const unsubscribe = service.subscribeToConfig(
        (config) => {
          updates.push(config?.goals?.["2025"]?.sports?.["cycling"] ?? null);
        },
        (error) => {
          throw error;
        }
      );

      // Wait for initial null callback
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Write data
      const testGoals: GoalsForYear = {
        goals: [
          {
            id: "goal-subscription",
            value: 1000,
            label: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metric: "",
          },
        ],
      };
      await service.updateConfigSection("goals", testGoals, 2025, "cycling");

      // Wait for subscription update
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Cleanup
      unsubscribe();

      // Verify we received updates
      expect(updates.length).toBeGreaterThan(0);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate).toEqual(testGoals);
    });
  });
});
