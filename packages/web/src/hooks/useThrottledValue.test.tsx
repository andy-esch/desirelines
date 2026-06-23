import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useThrottledValue } from "./useThrottledValue";

describe("useThrottledValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits the initial value immediately (leading edge)", () => {
    const { result } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });

  it("delays a change within the window until the trailing edge", async () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    expect(result.current).toBe("a"); // still throttled
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("b"); // trailing emit
  });

  it("coalesces rapid changes to the latest value", async () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    rerender({ v: "c" });
    rerender({ v: "d" });
    expect(result.current).toBe("a");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("d"); // only the latest lands, once
  });
});
