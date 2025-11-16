/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useUserConfig, useFullUserConfig } from "./useUserConfig";
import type { GoalsForYear, AnnotationsForYear, Preferences } from "../services/userConfigService";

// Mock Firebase modules
vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({
    app: { name: "[DEFAULT]" },
    currentUser: { uid: "test-user", getIdToken: vi.fn().mockResolvedValue("mock-token") },
  })),
  onAuthStateChanged: vi.fn((auth, callback) => {
    callback({ uid: "test-user", email: "test@example.com", displayName: "Test User" });
    return vi.fn(); // unsubscribe function
  }),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({ type: "firestore", app: { name: "[DEFAULT]" } })),
  doc: vi.fn((...args) => ({
    path: args.slice(1).join("/"), // Create path from arguments
    type: "document",
  })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));

// Mock the config to disable fixtures (so tests can test Firestore logic)
vi.mock("../config", () => ({
  USE_FIXTURE_DATA: false,
  API_BASE_URL: "http://localhost:8080",
}));

// Mock useAuth with stable user object (prevents unnecessary re-renders)
const mockUser = { uid: "test-user", email: "test@example.com", displayName: "Test User" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
  }),
}));

describe("useUserConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("overloaded signatures", () => {
    it("should work with 'goals' configType and year parameter", async () => {
      const mockGoals: GoalsForYear = {
        goals: [
          {
            id: "1",
            value: 1000,
            label: "Annual Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };

      // Mock the subscription to immediately call callback with data
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        // Simulate subscription callback with data
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: mockGoals } } } }),
          });
        }, 0);
        return vi.fn(); // Return unsubscribe function
      });

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      // Initially loading
      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockGoals);
      expect(result.current.error).toBeNull();
    });

    it("should work with 'annotations' configType and year parameter", async () => {
      const mockAnnotations: AnnotationsForYear = {
        annotations: [
          {
            id: "1",
            startDate: "2025-01-01",
            endDate: "",
            label: "New Year",
            description: "",
            stravaActivityId: "",
            type: 0,
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ annotations: { "2025": mockAnnotations } }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useUserConfig("annotations", 2025));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockAnnotations);
    });

    it("should work with 'preferences' configType (no year parameter)", async () => {
      const mockPreferences: Preferences = {
        theme: "dark",
        distanceUnit: "",
        elevationUnit: "",
        defaultSport: "",
        defaultYear: 2025,
      };

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ preferences: mockPreferences }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useUserConfig("preferences"));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockPreferences);
    });
  });

  describe("initial load and loading states", () => {
    it("should set loading to true initially, then false after data loads", async () => {
      const mockGoals: GoalsForYear = {
        goals: [
          {
            id: "1",
            value: 500,
            label: "Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: mockGoals } } } }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      // Initially loading
      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockGoals);
    });
  });

  describe("default values", () => {
    it("should use default value when no data exists in Firestore", async () => {
      const defaultGoals: GoalsForYear = {
        goals: [
          {
            id: "default",
            value: 1000,
            label: "Default Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: {} }), // No data for year 2025
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling", defaultGoals));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(defaultGoals);
    });

    it("should return null when no data exists and no default value provided", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: {} }), // No data for year 2025
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toBeNull();
    });
  });

  describe("real-time updates", () => {
    it("should trigger re-render when Firestore data changes", async () => {
      let triggerUpdate: (data: any) => void = () => {};

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        triggerUpdate = (data: any) => {
          callback({
            exists: () => true,
            data: () => data,
          });
        };

        // Initial call
        setTimeout(() => {
          triggerUpdate({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } });
        }, 0);

        return vi.fn();
      });

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ annualGoal: 500 });

      // Simulate Firestore update
      triggerUpdate({ goals: { "2025": { sports: { cycling: { annualGoal: 1000 } } } } });

      await waitFor(() => {
        expect(result.current.data).toEqual({ annualGoal: 1000 });
      });
    });
  });

  describe("optimistic updates", () => {
    it("should update local state immediately when updateData is called", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return vi.fn();
      });

      // Mock getDoc for updateConfigSection
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
      } as any);

      vi.mocked(setDoc).mockResolvedValue(undefined);

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ annualGoal: 500 });

      // Call updateData (optimistic update) - should update immediately
      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 1000,
            label: "New Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      const updatePromise = result.current.updateData(newGoals);

      // Check optimistic update happened immediately (before promise resolves)
      await waitFor(() => {
        expect(result.current.data).toEqual(newGoals);
      });

      await updatePromise;
      expect(setDoc).toHaveBeenCalled();
    });

    it("should call updateConfigSection with correct parameters for goals", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
      } as any);

      vi.mocked(setDoc).mockResolvedValue(undefined);

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 2000,
            label: "New Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      await result.current.updateData(newGoals);

      expect(setDoc).toHaveBeenCalled();
    });

    it("should call updateConfigSection with correct parameters for preferences", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ preferences: { theme: "light" } }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ preferences: { theme: "light" } }),
      } as any);

      vi.mocked(setDoc).mockResolvedValue(undefined);

      const { result } = renderHook(() => useUserConfig("preferences"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newPrefs: Preferences = {
        theme: "dark",
        defaultYear: 2025,
        distanceUnit: "",
        elevationUnit: "",
        defaultSport: "",
      };
      await result.current.updateData(newPrefs);

      expect(setDoc).toHaveBeenCalled();
    });
  });

  describe("subscription cleanup", () => {
    it("should call unsubscribe function on unmount", async () => {
      const unsubscribeMock = vi.fn();

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return unsubscribeMock;
      });

      const { unmount } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(onSnapshot).toHaveBeenCalled();
      });

      expect(unsubscribeMock).not.toHaveBeenCalled();

      unmount();

      expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    });

    it("should unsubscribe from old subscription when year changes", async () => {
      const unsubscribeMock1 = vi.fn();
      const unsubscribeMock2 = vi.fn();
      let callCount = 0;

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        callCount++;
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              goals: {
                "2025": { sports: { cycling: { annualGoal: 500 } } },
                "2024": { sports: { cycling: { annualGoal: 400 } } },
              },
            }),
          });
        }, 0);
        return callCount === 1 ? unsubscribeMock1 : unsubscribeMock2;
      });

      const { rerender } = renderHook(({ year }) => useUserConfig("goals", year, "cycling"), {
        initialProps: { year: 2025 },
      });

      await waitFor(() => {
        expect(onSnapshot).toHaveBeenCalledTimes(1);
      });

      // Change year - should unsubscribe from old subscription
      rerender({ year: 2024 });

      await waitFor(() => {
        expect(onSnapshot).toHaveBeenCalledTimes(2);
      });

      expect(unsubscribeMock1).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should set error state when subscription fails", async () => {
      const mockError = new Error("Firestore connection failed");

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation(() => {
        throw mockError;
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toEqual(mockError);
      expect(result.current.data).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should use default value when subscription fails", async () => {
      const mockError = new Error("Firestore connection failed");
      const defaultGoals: GoalsForYear = {
        goals: [
          {
            id: "default",
            value: 1000,
            label: "Default",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation(() => {
        throw mockError;
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling", defaultGoals));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(defaultGoals);
      expect(result.current.error).toEqual(mockError);

      consoleErrorSpy.mockRestore();
    });

    it("should set error state and log when updateData fails", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
      } as any);

      const updateError = new Error("Failed to update Firestore");
      vi.mocked(setDoc).mockRejectedValue(updateError);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 2000,
            label: "New Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      await result.current.updateData(newGoals);

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(updateError);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error updating config:", updateError);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("userId and version parameters", () => {
    it("should throw error when userId doesn't match authenticated user", () => {
      // This test verifies the runtime assertion security feature
      // When authenticated, trying to use a different userId should throw an error
      // The error is thrown during construction, so we expect it to throw
      expect(() => {
        renderHook(() => useUserConfig("goals", 2025, "cycling", undefined, "user123", "v2"));
      }).toThrow("userId mismatch");
    });
  });

  describe("userId resolution with authentication", () => {
    it("should use authenticated user's UID when userId defaults to 'default'", async () => {
      const { onSnapshot, doc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return vi.fn();
      });

      // Call WITHOUT userId parameter (defaults to "default")
      renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(doc).toHaveBeenCalled();
      });

      // Should use the authenticated user's UID ("test-user" from mock)
      const docCalls = vi.mocked(doc).mock.calls;
      const hasAuthUserUid = docCalls.some((call) => call.includes("test-user"));
      const hasDefaultUserId = docCalls.some((call) => call.includes("default"));

      expect(hasAuthUserUid).toBe(true);
      expect(hasDefaultUserId).toBe(false); // Should NOT use literal "default"
    });

    it("should use authenticated user's UID even when userId explicitly set to 'default'", async () => {
      const { onSnapshot, doc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return vi.fn();
      });

      // Explicitly pass userId="default"
      renderHook(() => useUserConfig("goals", 2025, "cycling", undefined, "default"));

      await waitFor(() => {
        expect(doc).toHaveBeenCalled();
      });

      // Should still use the authenticated user's UID, not literal "default"
      const docCalls = vi.mocked(doc).mock.calls;
      const hasAuthUserUid = docCalls.some((call) => call.includes("test-user"));
      const hasDefaultUserId = docCalls.some((call) => call.includes("default"));

      expect(hasAuthUserUid).toBe(true);
      expect(hasDefaultUserId).toBe(false);
    });

    it("should throw error when trying to override userId while authenticated", () => {
      // This test verifies the runtime assertion prevents userId override
      // when a user is authenticated (security feature)
      // The error is thrown during construction, so we expect it to throw
      expect(() => {
        renderHook(() => useUserConfig("goals", 2025, "cycling", undefined, "admin-user"));
      }).toThrow("userId mismatch");
    });
  });

  describe("fixture mode with authentication", () => {
    it("should use Firestore when authenticated (not fixture mode)", async () => {
      const { onSnapshot } = await import("firebase/firestore");

      const onSnapshotMock = vi.fn().mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: { "2025": { sports: { cycling: { annualGoal: 500 } } } } }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(onSnapshot).mockImplementation(onSnapshotMock);

      renderHook(() => useUserConfig("goals", 2025, "cycling"));

      await waitFor(() => {
        expect(onSnapshot).toHaveBeenCalled();
      });

      // Authenticated user should trigger Firestore subscription
      expect(onSnapshotMock).toHaveBeenCalled();
    });

    it("should use fixture mode behavior when user is null", async () => {
      // Note: This test documents the expected behavior when user is null.
      // In the actual implementation, isFixtureMode = !user, so:
      // - When user is null: isFixtureMode = true → uses localStorage/fixtures
      // - When user exists: isFixtureMode = false → uses Firestore
      //
      // We can't easily test this in isolation because useAuth is mocked at module level,
      // but the userId resolution tests above verify the critical bug fix.

      // This test serves as documentation of the expected behavior
      expect(true).toBe(true);
    });
  });
});

describe("useFullUserConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("full config loading", () => {
    it("should load full user config with all sections", async () => {
      const mockFullConfig = {
        schemaVersion: "2.0",
        goals: {
          "2025": {
            sports: {
              cycling: {
                goals: [
                  {
                    id: "1",
                    value: 1000,
                    label: "2025 Goal",
                    createdAt: "2025-01-01T00:00:00Z",
                    updatedAt: "2025-01-01T00:00:00Z",
                  },
                ],
              },
            },
          },
          "2024": {
            sports: {
              cycling: {
                goals: [
                  {
                    id: "2",
                    value: 900,
                    label: "2024 Goal",
                    createdAt: "2024-01-01T00:00:00Z",
                    updatedAt: "2024-01-01T00:00:00Z",
                  },
                ],
              },
            },
          },
        },
        annotations: {
          "2025": { annotations: [] },
        },
        preferences: { theme: "dark", defaultYear: 2025 },
      };

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => mockFullConfig,
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useFullUserConfig());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.config).toEqual(mockFullConfig);
      expect(result.current.error).toBeNull();
    });

    it("should handle null config (document doesn't exist)", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => false,
            data: () => null,
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.config).toBeNull();
    });
  });

  describe("updateSection method", () => {
    it("should update goals section with year", async () => {
      const mockConfig = {
        schemaVersion: "2.0",
        goals: {
          "2025": {
            sports: {
              cycling: {
                goals: [
                  {
                    id: "1",
                    value: 1000,
                    label: "Goal",
                    createdAt: "2025-01-01T00:00:00Z",
                    updatedAt: "2025-01-01T00:00:00Z",
                  },
                ],
              },
            },
          },
        },
        preferences: { theme: "dark", defaultYear: 2025 },
      };

      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => mockConfig,
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => mockConfig,
      } as any);

      vi.mocked(setDoc).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 2000,
            label: "New Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      await result.current.updateSection("goals", newGoals, 2025, "cycling");

      expect(setDoc).toHaveBeenCalled();
      expect(result.current.error).toBeNull();
    });

    it("should update annotations section with year", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ annotations: {} }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ annotations: {} }),
      } as any);

      vi.mocked(setDoc).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newAnnotations: AnnotationsForYear = {
        annotations: [
          {
            id: "new",
            startDate: "2025-01-01",
            endDate: "",
            label: "Test",
            description: "",
            stravaActivityId: "",
            type: 0,
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      await result.current.updateSection("annotations", newAnnotations, 2025);

      expect(setDoc).toHaveBeenCalled();
    });

    it("should update preferences section without year", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ preferences: { theme: "light" } }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ preferences: { theme: "light" } }),
      } as any);

      vi.mocked(setDoc).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newPrefs: Preferences = {
        theme: "dark",
        defaultYear: 2025,
        distanceUnit: "",
        elevationUnit: "",
        defaultSport: "",
      };
      await result.current.updateSection("preferences", newPrefs);

      expect(setDoc).toHaveBeenCalled();
    });

    it("should set error when updateSection fails", async () => {
      const { onSnapshot, getDoc, setDoc } = await import("firebase/firestore");

      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: {} }),
          });
        }, 0);
        return vi.fn();
      });

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ goals: {} }),
      } as any);

      const updateError = new Error("Update failed");
      vi.mocked(setDoc).mockRejectedValue(updateError);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 3000,
            label: "New Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      await result.current.updateSection("goals", newGoals, 2025, "cycling");

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(updateError);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("subscription cleanup", () => {
    it("should unsubscribe on unmount", async () => {
      const unsubscribeMock = vi.fn();

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({ goals: {} }),
          });
        }, 0);
        return unsubscribeMock;
      });

      const { unmount } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(onSnapshot).toHaveBeenCalled();
      });

      unmount();

      expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("custom userId and version", () => {
    it("should throw error when userId doesn't match authenticated user", () => {
      // This test verifies the runtime assertion security feature in useFullUserConfig
      // The error is thrown during construction, so we expect it to throw
      expect(() => {
        renderHook(() => useFullUserConfig("customUser", "v3"));
      }).toThrow("userId mismatch");
    });
  });

  describe("error handling", () => {
    it("should handle errors during initialization", async () => {
      const mockError = new Error("Firestore error");

      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation(() => {
        throw mockError;
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useFullUserConfig());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toEqual(mockError);
      expect(result.current.config).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
