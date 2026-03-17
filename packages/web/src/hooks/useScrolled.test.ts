import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScrolled } from "./useScrolled";

describe("useScrolled", () => {
  let scrollHandler: ((event: Event) => void) | null = null;

  beforeEach(() => {
    scrollHandler = null;
    // Mock window.scrollY
    Object.defineProperty(window, "scrollY", { writable: true, value: 0 });

    // Capture the scroll listener
    vi.spyOn(window, "addEventListener").mockImplementation(
      (event: string, handler: EventListenerOrEventListenerObject) => {
        if (event === "scroll") {
          scrollHandler = handler as (event: Event) => void;
        }
      }
    );

    vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when not scrolled", () => {
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(false);
  });

  it("returns true when scrolled past default threshold", () => {
    const { result } = renderHook(() => useScrolled());

    // Simulate scrolling past the default 4px threshold
    Object.defineProperty(window, "scrollY", { writable: true, value: 10 });
    act(() => {
      scrollHandler!(new Event("scroll"));
    });

    expect(result.current).toBe(true);
  });

  it("respects custom threshold", () => {
    const { result } = renderHook(() => useScrolled(100));

    // Scroll to 50px — not past the 100px threshold
    Object.defineProperty(window, "scrollY", { writable: true, value: 50 });
    act(() => {
      scrollHandler!(new Event("scroll"));
    });

    expect(result.current).toBe(false);

    // Scroll past the threshold
    Object.defineProperty(window, "scrollY", { writable: true, value: 101 });
    act(() => {
      scrollHandler!(new Event("scroll"));
    });

    expect(result.current).toBe(true);
  });

  it("returns false when scrolled back above threshold", () => {
    const { result } = renderHook(() => useScrolled());

    // Scroll down
    Object.defineProperty(window, "scrollY", { writable: true, value: 10 });
    act(() => {
      scrollHandler!(new Event("scroll"));
    });
    expect(result.current).toBe(true);

    // Scroll back up
    Object.defineProperty(window, "scrollY", { writable: true, value: 0 });
    act(() => {
      scrollHandler!(new Event("scroll"));
    });
    expect(result.current).toBe(false);
  });

  it("adds passive scroll listener", () => {
    renderHook(() => useScrolled());

    expect(window.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), {
      passive: true,
    });
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useScrolled());
    unmount();
    expect(window.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
