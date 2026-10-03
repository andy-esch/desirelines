import { describe, it, expect } from "vitest";
import { toMapboxColor } from "./colorTokens";

describe("toMapboxColor", () => {
  it("turns hex with alpha, which Mapbox can't parse, into rgba()", () => {
    expect(toMapboxColor("#0000")).toBe("rgba(0, 0, 0, 0)");
    expect(toMapboxColor("#1d0b3a6b")).toBe("rgba(29, 11, 58, 0.42)");
    expect(toMapboxColor("#FFF8")).toBe("rgba(255, 255, 255, 0.533)");
  });

  it("passes every other form through", () => {
    for (const color of ["#0b0f1a", "#abc", "rgba(0, 0, 0, 0)", "rgb(1, 2, 3)", "transparent"]) {
      expect(toMapboxColor(color)).toBe(color);
    }
  });

  it("trims what getPropertyValue returns", () => {
    expect(toMapboxColor(" #0000")).toBe("rgba(0, 0, 0, 0)");
  });
});
