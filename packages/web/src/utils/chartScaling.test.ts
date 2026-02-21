import { describe, it, expect } from "vitest";
import {
  roundToCleanMax,
  calculatePacingYAxisMax,
  calculateCumulativeYAxisMax,
} from "./chartScaling";

describe("chartScaling utilities", () => {
  describe("roundToCleanMax", () => {
    it("rounds small values to nearest 5", () => {
      expect(roundToCleanMax(12)).toBe(15);
      expect(roundToCleanMax(41)).toBe(45);
    });

    it("rounds medium values (< 100) to nearest 10", () => {
      expect(roundToCleanMax(52)).toBe(60);
      expect(roundToCleanMax(91)).toBe(100);
    });

    it("rounds values (< 500) to nearest 50", () => {
      expect(roundToCleanMax(120)).toBe(150);
      expect(roundToCleanMax(410)).toBe(450);
    });

    it("rounds large values (< 2000) to nearest 250", () => {
      expect(roundToCleanMax(1100)).toBe(1250);
      expect(roundToCleanMax(1800)).toBe(2000);
    });

    it("rounds very large values (< 5000) to nearest 500", () => {
      expect(roundToCleanMax(2200)).toBe(2500);
      expect(roundToCleanMax(4600)).toBe(5000);
    });

    it("rounds massive values (>= 5000) to nearest 1000", () => {
      expect(roundToCleanMax(5200)).toBe(6000);
      expect(roundToCleanMax(15100)).toBe(16000);
    });

    it("handles 0 by returning a sensible default", () => {
      expect(roundToCleanMax(0)).toBe(10);
    });
  });

  describe("calculatePacingYAxisMax", () => {
    it("applies 15% headroom to the maximum pace", () => {
      // max pace 10, no danger threshold
      // 10 * 1.15 = 11.5
      expect(calculatePacingYAxisMax(10, 5, Infinity)).toBeCloseTo(11.5, 1);
    });

    it("ensures danger threshold + 10% is visible", () => {
      // pace 10, goal 5, threshold 20
      // targetMax = 10 * 1.15 = 11.5
      // dangerPadding = 20 * 1.1 = 22
      // should return 22
      expect(calculatePacingYAxisMax(10, 5, 20)).toBe(22);
    });

    it("caps the axis at 2x danger threshold for unrealistic goals", () => {
      // pace 10, goal 100 (unrealistic), threshold 20
      // targetMax = 100 * 1.15 = 115
      // cap = max(20 * 2, 10 * 1.2) = 40
      // should return 40
      expect(calculatePacingYAxisMax(10, 100, 20)).toBe(40);
    });

    it("does not cap actual data if it exceeds the realistic cap", () => {
      // user is doing 50, but danger threshold is 20
      // targetMax = 50 * 1.15 = 57.5
      // absoluteCap = max(20 * 2, 50 * 1.2) = 60
      // 57.5 < 60, so it should stay 57.5
      expect(calculatePacingYAxisMax(50, 10, 20)).toBeCloseTo(57.5, 1);
    });

    it("returns sensible default when no data or goals", () => {
      expect(calculatePacingYAxisMax(0, 0, 20)).toBe(30); // 20 * 1.5
      expect(calculatePacingYAxisMax(0, 0, Infinity)).toBe(30);
    });
  });

  describe("calculateCumulativeYAxisMax", () => {
    it("delegates to roundToCleanMax", () => {
      expect(calculateCumulativeYAxisMax(1200)).toBe(1250);
      expect(calculateCumulativeYAxisMax(5500)).toBe(6000);
    });
  });
});
