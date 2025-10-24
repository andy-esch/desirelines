import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  migrateGoalsToFirestore,
  migrateAllGoalsToFirestore,
  loadGoalsFromLocalStorage,
  saveGoalsToLocalStorage,
} from "./migration";
import type { UserConfigService } from "../services/userConfigService";

describe("migration utilities", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("migrateGoalsToFirestore", () => {
    it("should skip migration if already migrated (flag exists)", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Set migration flag
      localStorage.setItem("desirelines_goals_2025_migrated", "2025-01-01T00:00:00Z");

      const mockService = {
        getConfigSection: vi.fn(),
        updateConfigSection: vi.fn(),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith("Goals for 2025 already migrated to Firestore");
      expect(mockService.getConfigSection).not.toHaveBeenCalled();
      expect(mockService.updateConfigSection).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should skip migration if no localStorage data exists", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const mockService = {
        getConfigSection: vi.fn(),
        updateConfigSection: vi.fn(),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith("No localStorage data to migrate for 2025");
      expect(mockService.getConfigSection).not.toHaveBeenCalled();
      expect(mockService.updateConfigSection).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should skip migration if Firestore already has data", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Set localStorage data
      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue([{ distance: 1000, label: "Existing Goal" }]),
        updateConfigSection: vi.fn(),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Firestore already has goals for 2025, skipping migration"
      );
      expect(mockService.updateConfigSection).not.toHaveBeenCalled();

      // Should set migration flag even though we didn't migrate
      expect(localStorage.getItem("desirelines_goals_2025_migrated")).toBeTruthy();

      consoleLogSpy.mockRestore();
    });

    it("should successfully migrate data from localStorage to Firestore", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Set localStorage data
      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue(null), // No existing data
        updateConfigSection: vi.fn().mockResolvedValue(undefined),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(true);
      expect(mockService.getConfigSection).toHaveBeenCalledWith("goals", 2025);
      expect(mockService.updateConfigSection).toHaveBeenCalledWith("goals", mockGoals, 2025);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "✓ Successfully migrated goals for 2025 to Firestore"
      );

      // Should set migration flag
      expect(localStorage.getItem("desirelines_goals_2025_migrated")).toBeTruthy();

      // Should keep original data as backup
      expect(localStorage.getItem("desirelines_goals_2025")).toBe(JSON.stringify(mockGoals));

      consoleLogSpy.mockRestore();
    });

    it("should handle empty array in Firestore as 'no data'", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue([]), // Empty array = no data
        updateConfigSection: vi.fn().mockResolvedValue(undefined),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(true);
      expect(mockService.updateConfigSection).toHaveBeenCalledWith("goals", mockGoals, 2025);

      consoleLogSpy.mockRestore();
    });

    it("should handle JSON parse errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Set invalid JSON
      localStorage.setItem("desirelines_goals_2025", "{ invalid json }");

      const mockService = {
        getConfigSection: vi.fn(),
        updateConfigSection: vi.fn(),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to migrate goals for 2025:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle Firestore read errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const mockService = {
        getConfigSection: vi.fn().mockRejectedValue(new Error("Firestore read error")),
        updateConfigSection: vi.fn(),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to migrate goals for 2025:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle Firestore write errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue(null),
        updateConfigSection: vi.fn().mockRejectedValue(new Error("Firestore write error")),
      } as unknown as UserConfigService;

      const result = await migrateGoalsToFirestore(mockService, 2025);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to migrate goals for 2025:",
        expect.any(Error)
      );
      // Migration flag should NOT be set on failure
      expect(localStorage.getItem("desirelines_goals_2025_migrated")).toBeNull();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("migrateAllGoalsToFirestore", () => {
    it("should migrate multiple years and return results", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      // Setup localStorage data for multiple years
      localStorage.setItem("desirelines_goals_2023", JSON.stringify({ goals: [] }));
      localStorage.setItem("desirelines_goals_2024", JSON.stringify({ goals: [] }));
      localStorage.setItem("desirelines_goals_2025", JSON.stringify({ goals: [] }));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue(null),
        updateConfigSection: vi.fn().mockResolvedValue(undefined),
      } as unknown as UserConfigService;

      const results = await migrateAllGoalsToFirestore(mockService);

      expect(results).toEqual({
        2023: true,
        2024: true,
        2025: true,
      });

      expect(mockService.updateConfigSection).toHaveBeenCalledTimes(3);
    });

    it("should handle custom year array", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      localStorage.setItem("desirelines_goals_2022", JSON.stringify({ goals: [] }));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue(null),
        updateConfigSection: vi.fn().mockResolvedValue(undefined),
      } as unknown as UserConfigService;

      const results = await migrateAllGoalsToFirestore(mockService, [2022]);

      expect(results).toEqual({ 2022: true });
      expect(mockService.updateConfigSection).toHaveBeenCalledTimes(1);
    });

    it("should return false for years with no data", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      const mockService = {
        getConfigSection: vi.fn(),
        updateConfigSection: vi.fn(),
      } as unknown as UserConfigService;

      const results = await migrateAllGoalsToFirestore(mockService, [2020, 2021]);

      expect(results).toEqual({
        2020: false,
        2021: false,
      });

      expect(mockService.updateConfigSection).not.toHaveBeenCalled();
    });

    it("should handle mixed success/failure across years", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      // 2023 has data, will succeed
      localStorage.setItem("desirelines_goals_2023", JSON.stringify({ goals: [] }));
      // 2024 has no data, will return false
      // 2025 has data but already migrated
      localStorage.setItem("desirelines_goals_2025", JSON.stringify({ goals: [] }));
      localStorage.setItem("desirelines_goals_2025_migrated", "2025-01-01T00:00:00Z");

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue(null),
        updateConfigSection: vi.fn().mockResolvedValue(undefined),
      } as unknown as UserConfigService;

      const results = await migrateAllGoalsToFirestore(mockService);

      expect(results).toEqual({
        2023: true,
        2024: false,
        2025: false,
      });
    });
  });

  describe("loadGoalsFromLocalStorage", () => {
    it("should load and parse goals from localStorage", () => {
      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const result = loadGoalsFromLocalStorage(2025);

      expect(result).toEqual(mockGoals);
    });

    it("should return null if no data exists", () => {
      const result = loadGoalsFromLocalStorage(2025);

      expect(result).toBeNull();
    });

    it("should handle JSON parse errors and return null", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      localStorage.setItem("desirelines_goals_2025", "{ invalid json }");

      const result = loadGoalsFromLocalStorage(2025);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error loading goals from localStorage for 2025:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should work with generic type parameter", () => {
      interface CustomGoals {
        annualTarget: number;
      }

      const mockGoals: CustomGoals = { annualTarget: 2000 };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const result = loadGoalsFromLocalStorage<CustomGoals>(2025);

      expect(result).toEqual(mockGoals);
    });
  });

  describe("saveGoalsToLocalStorage", () => {
    it("should save goals to localStorage", () => {
      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };

      saveGoalsToLocalStorage(2025, mockGoals);

      const stored = localStorage.getItem("desirelines_goals_2025");
      expect(stored).toBe(JSON.stringify(mockGoals));
    });

    it("should handle JSON stringify errors gracefully", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Create circular reference (cannot be stringified)
      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      saveGoalsToLocalStorage(2025, circularObj);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error saving goals to localStorage for 2025:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle storage quota exceeded error", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockSetItem = vi.spyOn(Storage.prototype, "setItem");
      mockSetItem.mockImplementation(() => {
        const error: any = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      });

      saveGoalsToLocalStorage(2025, { goals: [] });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error saving goals to localStorage for 2025:",
        expect.any(Error)
      );

      mockSetItem.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should work with generic type parameter", () => {
      interface CustomGoals {
        monthlyTargets: number[];
      }

      const mockGoals: CustomGoals = { monthlyTargets: [100, 200, 300] };

      saveGoalsToLocalStorage<CustomGoals>(2025, mockGoals);

      const stored = localStorage.getItem("desirelines_goals_2025");
      expect(stored).toBe(JSON.stringify(mockGoals));
    });
  });

  describe("idempotent behavior", () => {
    it("should be safe to call migrateGoalsToFirestore multiple times", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      const mockGoals = { goals: [{ id: "1", value: 1000, label: "Goal" }] };
      localStorage.setItem("desirelines_goals_2025", JSON.stringify(mockGoals));

      const mockService = {
        getConfigSection: vi.fn().mockResolvedValue(null),
        updateConfigSection: vi.fn().mockResolvedValue(undefined),
      } as unknown as UserConfigService;

      // First call - should migrate
      const result1 = await migrateGoalsToFirestore(mockService, 2025);
      expect(result1).toBe(true);
      expect(mockService.updateConfigSection).toHaveBeenCalledTimes(1);

      // Second call - should skip (flag set)
      const result2 = await migrateGoalsToFirestore(mockService, 2025);
      expect(result2).toBe(false);
      expect(mockService.updateConfigSection).toHaveBeenCalledTimes(1); // Still only 1

      // Third call - should skip
      const result3 = await migrateGoalsToFirestore(mockService, 2025);
      expect(result3).toBe(false);
      expect(mockService.updateConfigSection).toHaveBeenCalledTimes(1); // Still only 1
    });
  });
});
