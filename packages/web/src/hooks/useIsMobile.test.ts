import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./useIsMobile";

const QUERY = "(max-width: 639px)";

describe("useIsMobile", () => {
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

  it("returns false on a wide (desktop) viewport", () => {
    matchesMock = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns true on a phone-width viewport", () => {
    matchesMock = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("updates live when the viewport crosses the breakpoint", () => {
    matchesMock = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    const handler = listeners.get(QUERY);
    expect(handler).toBeDefined();
    act(() => {
      handler!({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });

  it("cleans up the listener on unmount", () => {
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
