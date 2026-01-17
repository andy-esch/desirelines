/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useVisibleSports } from "./useVisibleSports";
import * as useAuthModule from "./useAuth";
import * as useUserConfigModule from "./useUserConfig";
import * as useSportConfigModule from "./useSportConfig";

// Mock dependencies
vi.mock("./useAuth");
vi.mock("./useUserConfig");
vi.mock("./useSportConfig");

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useVisibleSports", () => {
  const defaultSports = ["cycling", "running", "yoga", "hiking", "workout"];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useSportConfigModule, "useSportConfig").mockReturnValue({
      sportConfig: null,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default behavior", () => {
    it("should return default sports when preferences not set", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: null,
        loading: false,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(), { wrapper: createWrapper() });

      expect(result.current.visibleSports).toEqual(defaultSports);
    });

    it("should return default sports when loading", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: null,
        loading: true,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(), { wrapper: createWrapper() });

      expect(result.current.visibleSports).toEqual(defaultSports);
    });

    it("should return default sports when visibleSports is empty array", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: [] } as any,
        loading: false,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });
      const { result } = renderHook(() => useVisibleSports(), { wrapper: createWrapper() });

      expect(result.current.visibleSports).toEqual(defaultSports);
    });

    it("should return stored sports when set", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      const storedSports = ["cycling"];
      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: storedSports } as any,
        loading: false,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });
      const { result } = renderHook(() => useVisibleSports(), { wrapper: createWrapper() });

      expect(result.current.visibleSports).toEqual(storedSports);
    });
  });

  describe("filtering with knownSports", () => {
    it("should filter out unknown sports", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      const storedSports = ["cycling", "unknown-sport"];
      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: storedSports } as any,
        loading: false,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(["cycling", "running"]), {
        wrapper: createWrapper(),
      });

      expect(result.current.visibleSports).toEqual(["cycling"]);
    });

    it("should fall back to defaults if all stored sports are invalid", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      const storedSports = ["unknown-sport"];
      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: storedSports } as any,
        loading: false,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(["cycling", "running"]), {
        wrapper: createWrapper(),
      });

      // Should return default sports because stored ones are invalid
      // Note: This assumes default logic doesn't use knownSports filter on defaults
      // The implementation of useVisibleSports should handle this.
      // If result is empty after filter, it usually falls back to default.
      expect(result.current.visibleSports).toEqual(["cycling", "running"]);
    });
  });

  describe("setVisibleSports validation", () => {
    it("should not allow empty sports selection", async () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      const updateDataMock = vi.fn();
      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: ["cycling"] } as any,
        loading: false,
        error: null,
        updateData: updateDataMock,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.setVisibleSports([]);
      });

      expect(updateDataMock).not.toHaveBeenCalled();
    });

    it("should not allow setting when filtered to empty with knownSports", async () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      const updateDataMock = vi.fn();
      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: ["cycling"] } as any,
        loading: false,
        error: null,
        updateData: updateDataMock,
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(["cycling"]), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.setVisibleSports(["running"]); // 'running' is not in knownSports
      });

      expect(updateDataMock).not.toHaveBeenCalled();
    });

    it("should expose setVisibleSports function", () => {
      vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
        user: { uid: "user-123" },
        loading: false,
      } as any);

      vi.spyOn(useUserConfigModule, "useUserConfig").mockReturnValue({
        data: { visibleSports: ["cycling"] } as any,
        loading: false,
        error: null,
        updateData: vi.fn(),
        isSaving: false,
        saveError: null,
        clearSaveError: vi.fn(),
      });

      const { result } = renderHook(() => useVisibleSports(), { wrapper: createWrapper() });

      expect(typeof result.current.setVisibleSports).toBe("function");
    });
  });
});
