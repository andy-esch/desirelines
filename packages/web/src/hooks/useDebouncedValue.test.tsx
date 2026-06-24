import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });

  it("only updates after the value has been stable for `ms`", async () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    rerender({ v: "c" }); // rapid changes reset the timer
    expect(result.current).toBe("a"); // not yet
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("c"); // settles on the latest
  });
});
