import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCurrentYear, getCurrentYear } from "./useCurrentYear";

describe("useCurrentYear", () => {
  it("returns the current year", () => {
    const { result } = renderHook(() => useCurrentYear());
    expect(result.current).toBe(new Date().getFullYear());
  });
});

describe("getCurrentYear", () => {
  it("returns the current year as a number", () => {
    const year = getCurrentYear();
    expect(typeof year).toBe("number");
    expect(year).toBe(new Date().getFullYear());
  });
});
