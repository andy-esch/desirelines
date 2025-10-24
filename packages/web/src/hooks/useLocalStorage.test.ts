import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorage } from "./useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial value handling", () => {
    it("should use initial value when localStorage is empty", () => {
      const { result } = renderHook(() => useLocalStorage("test-key", { count: 0 }));

      const [storedValue] = result.current;
      expect(storedValue).toEqual({ count: 0 });
    });

    it("should read existing value from localStorage", () => {
      // Pre-populate localStorage
      window.localStorage.setItem("test-key", JSON.stringify({ count: 42 }));

      const { result } = renderHook(() => useLocalStorage("test-key", { count: 0 }));

      const [storedValue] = result.current;
      expect(storedValue).toEqual({ count: 42 });
    });

    it("should handle string values", () => {
      window.localStorage.setItem("username", JSON.stringify("alice"));

      const { result } = renderHook(() => useLocalStorage("username", ""));

      const [storedValue] = result.current;
      expect(storedValue).toBe("alice");
    });

    it("should handle number values", () => {
      window.localStorage.setItem("year", JSON.stringify(2025));

      const { result } = renderHook(() => useLocalStorage("year", 2024));

      const [storedValue] = result.current;
      expect(storedValue).toBe(2025);
    });

    it("should handle boolean values", () => {
      window.localStorage.setItem("darkMode", JSON.stringify(true));

      const { result } = renderHook(() => useLocalStorage("darkMode", false));

      const [storedValue] = result.current;
      expect(storedValue).toBe(true);
    });

    it("should handle array values", () => {
      const mockArray = [1, 2, 3];
      window.localStorage.setItem("numbers", JSON.stringify(mockArray));

      const { result } = renderHook(() => useLocalStorage("numbers", [] as number[]));

      const [storedValue] = result.current;
      expect(storedValue).toEqual(mockArray);
    });
  });

  describe("value updates", () => {
    it("should update localStorage when value changes", () => {
      const { result } = renderHook(() => useLocalStorage("test-key", { count: 0 }));

      const [, setValue] = result.current;

      act(() => {
        setValue({ count: 10 });
      });

      // Check localStorage was updated
      const stored = window.localStorage.getItem("test-key");
      expect(stored).toBe(JSON.stringify({ count: 10 }));
    });

    it("should persist value across hook re-renders", () => {
      const { result, rerender } = renderHook(() => useLocalStorage("test-key", { count: 0 }));

      const [, setValue] = result.current;

      act(() => {
        setValue({ count: 5 });
      });

      // Re-render the hook
      rerender();

      const [storedValue] = result.current;
      expect(storedValue).toEqual({ count: 5 });
    });

    it("should update multiple times correctly", () => {
      const { result } = renderHook(() => useLocalStorage("counter", 0));

      const [, setValue] = result.current;

      act(() => {
        setValue(1);
      });
      expect(window.localStorage.getItem("counter")).toBe("1");

      act(() => {
        setValue(2);
      });
      expect(window.localStorage.getItem("counter")).toBe("2");

      act(() => {
        setValue(3);
      });
      expect(window.localStorage.getItem("counter")).toBe("3");
    });
  });

  describe("error handling - JSON parse errors", () => {
    it("should return initial value when JSON parse fails", () => {
      // Set invalid JSON in localStorage
      window.localStorage.setItem("test-key", "{ invalid json }");

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useLocalStorage("test-key", { count: 0 }));

      const [storedValue] = result.current;
      expect(storedValue).toEqual({ count: 0 });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error reading localStorage key "test-key":',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle empty string as falsy and return initial value", () => {
      window.localStorage.setItem("test-key", "");

      const { result } = renderHook(() => useLocalStorage("test-key", "default"));

      const [storedValue] = result.current;
      // Empty string is falsy, so initial value is used
      expect(storedValue).toBe("default");
    });

    it("should handle undefined in localStorage", () => {
      // Simulate getItem returning null (key doesn't exist)
      const { result } = renderHook(() => useLocalStorage("nonexistent-key", { default: true }));

      const [storedValue] = result.current;
      expect(storedValue).toEqual({ default: true });
    });
  });

  describe("error handling - JSON stringify errors", () => {
    it("should handle JSON stringify errors and log them", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Create a circular reference (cannot be stringified)
      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      const { result } = renderHook(() => useLocalStorage("test-key", {} as any));

      const [, setValue] = result.current;

      act(() => {
        setValue(circularObj);
      });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error setting localStorage key "test-key":',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("error handling - storage quota exceeded", () => {
    it("should handle storage quota exceeded error", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Mock setItem to throw QuotaExceededError
      const mockSetItem = vi.spyOn(Storage.prototype, "setItem");
      mockSetItem.mockImplementation(() => {
        const error: any = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      });

      const { result } = renderHook(() => useLocalStorage("test-key", { count: 0 }));

      const [, setValue] = result.current;

      act(() => {
        setValue({ count: 999 });
      });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error setting localStorage key "test-key":',
        expect.any(Error)
      );

      mockSetItem.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("multiple instances with same key", () => {
    it("should handle multiple hook instances with same key independently", () => {
      // First instance
      const { result: result1 } = renderHook(() => useLocalStorage("shared-key", 0));

      // Second instance
      const { result: result2 } = renderHook(() => useLocalStorage("shared-key", 0));

      const [value1] = result1.current;
      const [value2] = result2.current;

      // Both should read the same initial value
      expect(value1).toBe(value2);
      expect(value1).toBe(0);

      // Update from first instance
      const [, setValue1] = result1.current;
      act(() => {
        setValue1(10);
      });

      // localStorage should be updated
      expect(window.localStorage.getItem("shared-key")).toBe("10");

      // Note: The second instance won't auto-sync unless it re-renders
      // This is expected behavior - useLocalStorage doesn't listen for storage events
    });
  });

  describe("different data types", () => {
    it("should handle null value", () => {
      const { result } = renderHook(() => useLocalStorage<string | null>("nullable", null));

      const [storedValue] = result.current;
      expect(storedValue).toBe(null);

      // Verify it was written to localStorage
      expect(window.localStorage.getItem("nullable")).toBe("null");
    });

    it("should handle nested objects", () => {
      const complexObject = {
        user: {
          name: "Alice",
          settings: {
            theme: "dark",
            notifications: true,
          },
        },
        timestamp: "2025-01-01",
      };

      const { result } = renderHook(() => useLocalStorage("complex", complexObject));

      const [, setValue] = result.current;

      act(() => {
        setValue(complexObject);
      });

      const stored = window.localStorage.getItem("complex");
      expect(stored).toBe(JSON.stringify(complexObject));
    });
  });
});
