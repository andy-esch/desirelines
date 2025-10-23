import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UserConfigService } from "./userConfigService";
import type {
  UserConfig,
  GoalsForYear,
  AnnotationsForYear,
  Preferences,
} from "./userConfigService";
import * as firestore from "firebase/firestore";

// Mock firebase modules
vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({ type: "firestore" })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));

describe("UserConfigService", () => {
  let service: UserConfigService;
  let mockDocRef: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserConfigService("test-user", "v1");
    mockDocRef = { id: "test-doc", path: "users/test-user/config/v1" };
    vi.mocked(firestore.doc).mockReturnValue(mockDocRef);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getConfig", () => {
    it("should return config when document exists", async () => {
      const mockConfig: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {
          "2025": [{ distance: 1000, label: "Test Goal" }],
        },
        annotations: {},
      };

      const mockDocSnap = {
        exists: () => true,
        data: () => mockConfig,
      };

      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const result = await service.getConfig();

      expect(result).toEqual(mockConfig);
      expect(firestore.getDoc).toHaveBeenCalledWith(mockDocRef);
    });

    it("should return null when document does not exist", async () => {
      const mockDocSnap = {
        exists: () => false,
      };

      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const result = await service.getConfig();

      expect(result).toBeNull();
    });

    it("should handle errors and rethrow", async () => {
      const error = new Error("Firestore error");
      vi.mocked(firestore.getDoc).mockRejectedValue(error);

      await expect(service.getConfig()).rejects.toThrow("Firestore error");
    });

    it("should log error when fetch fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Network error");
      vi.mocked(firestore.getDoc).mockRejectedValue(error);

      await expect(service.getConfig()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching user config:", error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe("getConfigSection", () => {
    const mockConfig: UserConfig = {
      schemaVersion: "1.0",
      userId: "test-user",
      lastUpdated: "2025-01-01T00:00:00Z",
      goals: {
        "2025": [{ distance: 1000, label: "2025 Goal" }],
        "2024": [{ distance: 800, label: "2024 Goal" }],
      },
      annotations: {
        "2025": [{ date: "2025-01-01", label: "Test Annotation" }],
      },
      preferences: {
        theme: "dark",
        units: "metric",
      },
    };

    beforeEach(() => {
      const mockDocSnap = {
        exists: () => true,
        data: () => mockConfig,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);
    });

    it("should return goals for specific year", async () => {
      const result = await service.getConfigSection("goals", 2025);

      expect(result).toEqual([{ distance: 1000, label: "2025 Goal" }]);
    });

    it("should return all goals when year not specified", async () => {
      const result = await service.getConfigSection("goals");

      expect(result).toEqual({
        "2025": [{ distance: 1000, label: "2025 Goal" }],
        "2024": [{ distance: 800, label: "2024 Goal" }],
      });
    });

    it("should return annotations for specific year", async () => {
      const result = await service.getConfigSection("annotations", 2025);

      expect(result).toEqual([{ date: "2025-01-01", label: "Test Annotation" }]);
    });

    it("should return null for year with no data", async () => {
      const result = await service.getConfigSection("goals", 2023);

      expect(result).toBeNull();
    });

    it("should return preferences", async () => {
      const result = await service.getConfigSection("preferences");

      expect(result).toEqual({
        theme: "dark",
        units: "metric",
      });
    });

    it("should return null when config does not exist", async () => {
      const mockDocSnap = {
        exists: () => false,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const result = await service.getConfigSection("goals", 2025);

      expect(result).toBeNull();
    });

    it("should return null when section does not exist in config", async () => {
      const configWithoutGoals: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {},
        annotations: {},
      };

      const mockDocSnap = {
        exists: () => true,
        data: () => configWithoutGoals,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const result = await service.getConfigSection("preferences");

      expect(result).toBeNull();
    });
  });

  describe("updateConfigSection", () => {
    it("should update goals for specific year", async () => {
      const mockExistingConfig: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {
          "2024": [{ distance: 800, label: "2024 Goal" }],
        },
        annotations: {},
      };

      const mockDocSnap = {
        exists: () => true,
        data: () => mockExistingConfig,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const newGoals: GoalsForYear = [{ distance: 1000, label: "2025 Goal" }];

      await service.updateConfigSection("goals", newGoals, 2025);

      expect(firestore.setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          schemaVersion: "1.0",
          userId: "test-user",
          goals: {
            "2024": [{ distance: 800, label: "2024 Goal" }],
            "2025": [{ distance: 1000, label: "2025 Goal" }],
          },
          annotations: {},
          lastUpdated: expect.any(String),
        }),
        { merge: true }
      );
    });

    it("should create new config when it does not exist", async () => {
      const mockDocSnap = {
        exists: () => false,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const newGoals: GoalsForYear = [{ distance: 1000, label: "2025 Goal" }];

      await service.updateConfigSection("goals", newGoals, 2025);

      expect(firestore.setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          schemaVersion: "1.0",
          userId: "test-user",
          goals: {
            "2025": [{ distance: 1000, label: "2025 Goal" }],
          },
          annotations: {},
          lastUpdated: expect.any(String),
        }),
        { merge: true }
      );
    });

    it("should update annotations for specific year", async () => {
      const mockDocSnap = {
        exists: () => false,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const newAnnotations: AnnotationsForYear = [{ date: "2025-01-01", label: "Test" }];

      await service.updateConfigSection("annotations", newAnnotations, 2025);

      expect(firestore.setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          annotations: {
            "2025": [{ date: "2025-01-01", label: "Test" }],
          },
        }),
        { merge: true }
      );
    });

    it("should update preferences", async () => {
      const mockDocSnap = {
        exists: () => false,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const newPreferences: Preferences = { theme: "light", units: "imperial" };

      await service.updateConfigSection("preferences", newPreferences);

      expect(firestore.setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          preferences: { theme: "light", units: "imperial" },
        }),
        { merge: true }
      );
    });

    it("should use merge option to avoid overwriting other fields", async () => {
      const mockDocSnap = {
        exists: () => false,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const newGoals: GoalsForYear = [{ distance: 1000, label: "Goal" }];

      await service.updateConfigSection("goals", newGoals, 2025);

      // Verify merge option is used
      expect(firestore.setDoc).toHaveBeenCalledWith(mockDocRef, expect.any(Object), {
        merge: true,
      });
    });

    it("should update lastUpdated timestamp", async () => {
      const mockDocSnap = {
        exists: () => false,
      };
      vi.mocked(firestore.getDoc).mockResolvedValue(mockDocSnap as any);

      const beforeUpdate = new Date().toISOString();
      await service.updateConfigSection("goals", [], 2025);
      const afterUpdate = new Date().toISOString();

      const setDocCall = vi.mocked(firestore.setDoc).mock.calls[0];
      const updatedConfig = setDocCall[1] as UserConfig;

      expect(updatedConfig.lastUpdated).toBeDefined();
      expect(updatedConfig.lastUpdated >= beforeUpdate).toBe(true);
      expect(updatedConfig.lastUpdated <= afterUpdate).toBe(true);
    });

    it("should handle errors and rethrow", async () => {
      const error = new Error("Firestore write error");
      vi.mocked(firestore.getDoc).mockRejectedValue(error);

      await expect(service.updateConfigSection("goals", [], 2025)).rejects.toThrow(
        "Firestore write error"
      );
    });

    it("should log error when update fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Update failed");
      vi.mocked(firestore.getDoc).mockRejectedValue(error);

      await expect(service.updateConfigSection("goals", [], 2025)).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error updating user config:", error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe("deleteConfig", () => {
    it("should delete config document", async () => {
      await service.deleteConfig();

      expect(firestore.deleteDoc).toHaveBeenCalledWith(mockDocRef);
    });

    it("should handle errors and rethrow", async () => {
      const error = new Error("Delete error");
      vi.mocked(firestore.deleteDoc).mockRejectedValue(error);

      await expect(service.deleteConfig()).rejects.toThrow("Delete error");
    });

    it("should log error when delete fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Delete failed");
      vi.mocked(firestore.deleteDoc).mockRejectedValue(error);

      await expect(service.deleteConfig()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error deleting user config:", error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe("subscribeToConfig", () => {
    it("should call callback with config when document exists", () => {
      const mockConfig: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {},
        annotations: {},
      };

      const mockUnsubscribe = vi.fn();
      let capturedOnNext: ((doc: any) => void) | undefined;

      vi.mocked(firestore.onSnapshot).mockImplementation((docRef, onNext, _onError) => {
        capturedOnNext = onNext as any;
        return mockUnsubscribe;
      });

      const callback = vi.fn();
      const unsubscribe = service.subscribeToConfig(callback);

      // Simulate snapshot event
      const mockDocSnap = {
        exists: () => true,
        data: () => mockConfig,
      };
      capturedOnNext!(mockDocSnap);

      expect(callback).toHaveBeenCalledWith(mockConfig);
      expect(typeof unsubscribe).toBe("function");
    });

    it("should call callback with null when document does not exist", () => {
      const mockUnsubscribe = vi.fn();
      let capturedOnNext: ((doc: any) => void) | undefined;

      vi.mocked(firestore.onSnapshot).mockImplementation((docRef, onNext, _onError) => {
        capturedOnNext = onNext as any;
        return mockUnsubscribe;
      });

      const callback = vi.fn();
      service.subscribeToConfig(callback);

      const mockDocSnap = {
        exists: () => false,
      };
      capturedOnNext!(mockDocSnap);

      expect(callback).toHaveBeenCalledWith(null);
    });

    it("should handle errors in subscription", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockUnsubscribe = vi.fn();
      let capturedOnError: ((error: Error) => void) | undefined;

      vi.mocked(firestore.onSnapshot).mockImplementation((docRef, onNext, onError) => {
        capturedOnError = onError as any;
        return mockUnsubscribe;
      });

      const callback = vi.fn();
      service.subscribeToConfig(callback);

      const error = new Error("Subscription error");
      capturedOnError!(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error in config subscription:", error);
      expect(callback).toHaveBeenCalledWith(null);

      consoleErrorSpy.mockRestore();
    });

    it("should return unsubscribe function", () => {
      const mockUnsubscribe = vi.fn();

      vi.mocked(firestore.onSnapshot).mockReturnValue(mockUnsubscribe);

      const callback = vi.fn();
      const unsubscribe = service.subscribeToConfig(callback);

      unsubscribe();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe("subscribeToConfigSection", () => {
    it("should subscribe to goals for specific year", () => {
      const mockConfig: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {
          "2025": [{ distance: 1000, label: "Goal" }],
        },
        annotations: {},
      };

      const mockUnsubscribe = vi.fn();
      let capturedOnNext: ((doc: any) => void) | undefined;

      vi.mocked(firestore.onSnapshot).mockImplementation((docRef, onNext) => {
        capturedOnNext = onNext as any;
        return mockUnsubscribe;
      });

      const callback = vi.fn();
      service.subscribeToConfigSection("goals", callback, 2025);

      const mockDocSnap = {
        exists: () => true,
        data: () => mockConfig,
      };
      capturedOnNext!(mockDocSnap);

      expect(callback).toHaveBeenCalledWith([{ distance: 1000, label: "Goal" }]);
    });

    it("should call callback with null when year has no data", () => {
      const mockConfig: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {
          "2024": [{ distance: 800, label: "Goal" }],
        },
        annotations: {},
      };

      let capturedOnNext: ((doc: any) => void) | undefined;

      vi.mocked(firestore.onSnapshot).mockImplementation((docRef, onNext) => {
        capturedOnNext = onNext as any;
        return vi.fn();
      });

      const callback = vi.fn();
      service.subscribeToConfigSection("goals", callback, 2025);

      const mockDocSnap = {
        exists: () => true,
        data: () => mockConfig,
      };
      capturedOnNext!(mockDocSnap);

      expect(callback).toHaveBeenCalledWith(null);
    });

    it("should subscribe to preferences", () => {
      const mockConfig: UserConfig = {
        schemaVersion: "1.0",
        userId: "test-user",
        lastUpdated: "2025-01-01T00:00:00Z",
        goals: {},
        annotations: {},
        preferences: { theme: "dark", units: "metric" },
      };

      let capturedOnNext: ((doc: any) => void) | undefined;

      vi.mocked(firestore.onSnapshot).mockImplementation((docRef, onNext) => {
        capturedOnNext = onNext as any;
        return vi.fn();
      });

      const callback = vi.fn();
      service.subscribeToConfigSection("preferences", callback);

      const mockDocSnap = {
        exists: () => true,
        data: () => mockConfig,
      };
      capturedOnNext!(mockDocSnap);

      expect(callback).toHaveBeenCalledWith({ theme: "dark", units: "metric" });
    });

    it("should return unsubscribe function", () => {
      const mockUnsubscribe = vi.fn();

      vi.mocked(firestore.onSnapshot).mockReturnValue(mockUnsubscribe);

      const callback = vi.fn();
      const unsubscribe = service.subscribeToConfigSection("goals", callback, 2025);

      unsubscribe();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
