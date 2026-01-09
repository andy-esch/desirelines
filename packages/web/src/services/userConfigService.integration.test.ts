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
import type {
  GoalsForYear,
  SportGoalsForYear,
  AnnotationsForYear,
  Preferences,
} from "../types/generated/user_config";
import { AnnotationType } from "../types/generated/user_config";
import { testAuth, testDb } from "../test/integration-setup";

// Mock the firebase module to use our test emulator instances
vi.mock("../lib/firebase", () => ({
  auth: testAuth,
  db: testDb,
  waitForAuthReady: vi.fn().mockResolvedValue(undefined),
}));

import { UserConfigService } from "./userConfigService";

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
          },
          {
            id: "goal-2",
            value: 1500,
            label: "Target",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
      await service.updateConfigSection("goals", testGoals, 2025, "cycling");

      // Read back
      const retrieved = await service.getConfigSection("goals", 2025, "cycling");

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
      const retrieved = await service.getConfigSection("annotations", 2025);

      expect(retrieved).toEqual(testAnnotations);
    });

    it("should write and read preferences configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Write preferences
      const testPrefs: Preferences = {
        theme: "dark",
        defaultYear: 2025,
        distanceUnit: "miles",
        elevationUnit: "feet",
        defaultSport: "cycling",
        timezone: "",
        visibleSports: [],
      };
      await service.updateConfigSection("preferences", testPrefs);

      // Read back
      const retrieved = await service.getConfigSection("preferences");

      expect(retrieved).toEqual(testPrefs);
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
          },
        ],
      };
      await service.updateConfigSection("goals", updatedGoals, 2025, "cycling");

      // Verify update
      const retrieved = await service.getConfigSection("goals", 2025, "cycling");
      expect(retrieved).toEqual(updatedGoals);
    });

    it("should return null for non-existent configuration", async () => {
      const userCred = await signInAnonymously(testAuth);
      currentUserId = userCred.user.uid;

      const service = new UserConfigService();

      // Try to read data that doesn't exist
      const retrieved = await service.getConfigSection("goals", 2025, "cycling");

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
          },
        ],
      };
      await serviceA.updateConfigSection("goals", userAGoals, 2025, "cycling");

      // Verify user A can read their own data
      const userAData = await serviceA.getConfigSection("goals", 2025, "cycling");
      expect(userAData).toEqual(userAGoals);

      // Sign out user A
      await signOut(testAuth);

      // User B signs in
      const userBCredential = await signInAnonymously(testAuth);
      const userBId = userBCredential.user.uid;

      const serviceB = new UserConfigService();

      // User B tries to read their own data (should be null - they have no data)
      const userBData = await serviceB.getConfigSection("goals", 2025, "cycling");
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

      // Set up subscription
      const updates: (
        | GoalsForYear
        | SportGoalsForYear
        | AnnotationsForYear
        | Preferences
        | { [key: string]: SportGoalsForYear }
        | { [key: string]: AnnotationsForYear }
        | null
      )[] = [];
      const unsubscribe = service.subscribeToConfigSection(
        "goals",
        (data) => {
          updates.push(data);
        },
        2025,
        "cycling"
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
      const lastUpdate = updates[updates.length - 1] as GoalsForYear;
      expect(lastUpdate).toEqual(testGoals);
    });
  });
});
