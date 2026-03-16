import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducedMotion } from "./useReducedMotion";

describe("useReducedMotion", () => {
  let listeners: Map<string, (event: MediaQueryListEvent) => void>;
  let matchesMock: boolean;

  beforeEach(() => {
    listeners = new Map();
    matchesMock = false;

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: matchesMock,
        media: query,
        addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
          listeners.set(query, handler);
        },
        removeEventListener: (_event: string) => {
          listeners.delete(query);
        },
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when no motion preference is set", () => {
    matchesMock = false;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when prefers-reduced-motion is set", () => {
    matchesMock = true;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes", () => {
    matchesMock = false;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    // Simulate user toggling reduced motion
    const handler = listeners.get("(prefers-reduced-motion: reduce)");
    expect(handler).toBeDefined();

    act(() => {
      handler!({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });

  it("cleans up listener on unmount", () => {
    const { unmount } = renderHook(() => useReducedMotion());
    expect(listeners.size).toBe(1);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
