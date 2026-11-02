import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInitialAnimation } from "./useInitialAnimation";
import { useReducedMotion } from "./useReducedMotion";

vi.mock("./useReducedMotion", () => ({ useReducedMotion: vi.fn() }));

/** Render the hook and return every value it produced, in render order. */
function renderValues(): boolean[] {
  const values: boolean[] = [];
  renderHook(() => {
    const value = useInitialAnimation();
    values.push(value);
    return value;
  });
  return values;
}

describe("useInitialAnimation", () => {
  beforeEach(() => {
    vi.mocked(useReducedMotion).mockReturnValue(false);
  });

  it("is true on the first render and false after mount", () => {
    const values = renderValues();
    expect(values[0]).toBe(true);
    expect(values.at(-1)).toBe(false);
  });

  it("is never true when the user prefers reduced motion", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    expect(renderValues().every((value) => !value)).toBe(true);
  });
});
