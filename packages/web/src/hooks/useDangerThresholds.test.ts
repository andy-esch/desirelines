import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDangerThresholds } from "./useDangerThresholds";

describe("useDangerThresholds", () => {
  it("returns default thresholds for known sports", () => {
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.getThreshold("cycling")).toBe(20);
    expect(result.current.getThreshold("running")).toBe(10);
    expect(result.current.getThreshold("yoga")).toBe(120);
  });

  it("returns Infinity for unknown sports", () => {
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.getThreshold("swimming")).toBe(Infinity);
    expect(result.current.getThreshold("unknown")).toBe(Infinity);
  });

  it("provides all thresholds as an object", () => {
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.allThresholds).toHaveProperty("cycling", 20);
    expect(result.current.allThresholds).toHaveProperty("running", 10);
  });
});
