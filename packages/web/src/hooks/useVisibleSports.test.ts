/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useVisibleSports } from "./useVisibleSports";

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
  onAuthStateChanged: vi.fn((_auth, callback) => {
    callback({ uid: "test-user", email: "test@example.com", displayName: "Test User" });
    return vi.fn();
  }),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({ type: "firestore", app: { name: "[DEFAULT]" } })),
  doc: vi.fn((...args) => ({
    path: args.slice(1).join("/"),
    type: "document",
  })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));

// Mock useAuth with stable user object
const mockUser = { uid: "test-user", email: "test@example.com", displayName: "Test User" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
  }),
}));

describe("useVisibleSports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default behavior", () => {
    it("should return default sports when preferences not set", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                // visibleSports not set
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useVisibleSports());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should return default sports
      expect(result.current.visibleSports).toEqual([
        "cycling",
        "running",
        "yoga",
        "hiking",
        "workout",
      ]);
    });

    it("should return default sports when visibleSports is empty array", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: [], // Empty array
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useVisibleSports());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should return defaults when array is empty
      expect(result.current.visibleSports).toEqual([
        "cycling",
        "running",
        "yoga",
        "hiking",
        "workout",
      ]);
    });

    it("should return stored sports when set", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: ["cycling", "swimming", "hiking"],
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useVisibleSports());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.visibleSports).toEqual(["cycling", "swimming", "hiking"]);
    });
  });

  describe("filtering with knownSports", () => {
    it("should filter out unknown sports", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: ["cycling", "invalid_sport", "running"],
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const knownSports = ["cycling", "running", "yoga", "swimming"];
      const { result } = renderHook(() => useVisibleSports(knownSports));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should filter out invalid_sport
      expect(result.current.visibleSports).toEqual(["cycling", "running"]);
    });

    it("should fall back to defaults if all stored sports are invalid", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: ["invalid1", "invalid2"],
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const knownSports = ["cycling", "running", "yoga", "hiking", "workout"];
      const { result } = renderHook(() => useVisibleSports(knownSports));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should fall back to defaults that exist in knownSports
      expect(result.current.visibleSports).toEqual([
        "cycling",
        "running",
        "yoga",
        "hiking",
        "workout",
      ]);
    });
  });

  describe("setVisibleSports validation", () => {
    it("should not allow empty sports selection", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: ["cycling", "running"],
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useVisibleSports());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Try to set empty array - should warn and not update
      await act(async () => {
        await result.current.setVisibleSports([]);
      });

      expect(warnSpy).toHaveBeenCalledWith(
        "At least one sport must be visible, keeping current selection"
      );
      // visibleSports should remain unchanged
      expect(result.current.visibleSports).toEqual(["cycling", "running"]);

      warnSpy.mockRestore();
    });

    it("should not allow setting when filtered to empty with knownSports", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: ["cycling"],
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const knownSports = ["cycling", "running", "yoga", "hiking", "workout"];
      const { result } = renderHook(() => useVisibleSports(knownSports));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Try to set with only invalid sports - should warn
      await act(async () => {
        await result.current.setVisibleSports(["invalid1", "invalid2"]);
      });

      expect(warnSpy).toHaveBeenCalledWith(
        "At least one sport must be visible, keeping current selection"
      );

      warnSpy.mockRestore();
    });

    it("should expose setVisibleSports function", async () => {
      const { onSnapshot } = await import("firebase/firestore");
      vi.mocked(onSnapshot).mockImplementation((_doc, callback: any) => {
        setTimeout(() => {
          callback({
            exists: () => true,
            data: () => ({
              schemaVersion: "2.1",
              preferences: {
                theme: "light",
                defaultYear: 2025,
                visibleSports: ["cycling"],
              },
            }),
          });
        }, 0);
        return vi.fn();
      });

      const { result } = renderHook(() => useVisibleSports());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify setVisibleSports is a function
      expect(typeof result.current.setVisibleSports).toBe("function");
    });
  });
});
