import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInitialAnimation } from "./useInitialAnimation";

describe("useInitialAnimation", () => {
  let prefersReducedMotion: boolean;

  beforeEach(() => {
    prefersReducedMotion = false;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: prefersReducedMotion,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Render the hook, recording the value it returned on every render. */
  function renderRecording() {
    const seen: boolean[] = [];
    const hook = renderHook(() => {
      const value = useInitialAnimation();
      seen.push(value);
      return value;
    });
    return { ...hook, seen };
  }

  it("animates on the first render only", () => {
    const { result, seen } = renderRecording();
    expect(seen[0]).toBe(true);
    expect(result.current).toBe(false);
  });

  it("stays off across later re-renders", () => {
    const { result, rerender } = renderRecording();
    rerender();
    expect(result.current).toBe(false);
  });

  it("never animates when the user prefers reduced motion", () => {
    prefersReducedMotion = true;
    const { seen } = renderRecording();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === false)).toBe(true);
  });
});
