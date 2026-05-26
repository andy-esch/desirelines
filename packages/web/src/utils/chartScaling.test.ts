import { describe, it, expect } from "vitest";
import {
  roundToCleanMax,
  calculatePacingYAxisMax,
  calculateCumulativeYAxisMax,
  shouldShowDangerZone,
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

    it("does NOT inflate axis to show danger threshold when data is comfortably below it", () => {
      // pace 10, goal 5, threshold 20 → ratio 10/20 = 0.5, below 0.75 proximity.
      // Showing the danger line at 22 would compress the data (max 10) into the
      // bottom half of the chart. Keep the axis tight to the data instead.
      expect(calculatePacingYAxisMax(10, 5, 20)).toBeCloseTo(11.5, 1);
    });

    it("DOES inflate axis to show danger threshold when data is close (>=75%)", () => {
      // pace 16, goal 5, threshold 20 → ratio 16/20 = 0.8, above proximity.
      // The user is approaching the danger zone, so the overlay is meaningful.
      // dangerPadding = 20 * 1.1 = 22
      expect(calculatePacingYAxisMax(16, 5, 20)).toBe(22);
    });

    it("caps the axis at 2x danger threshold for unrealistic goals (when zone is shown)", () => {
      // pace 10, goal 100 (unrealistic), threshold 20.
      // goal exceeds threshold so the zone is visible.
      // targetMax = 100 * 1.15 = 115
      // cap = max(20 * 2, 10 * 1.2) = 40
      // should return 40
      expect(calculatePacingYAxisMax(10, 100, 20)).toBe(40);
    });

    it("does not cap actual data if it exceeds the realistic cap", () => {
      // user is doing 50, danger threshold 20 — zone is shown.
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

  describe("shouldShowDangerZone", () => {
    it("hides the zone when data is comfortably below the threshold", () => {
      // Max data 10, threshold 20 → 50% of threshold, well below proximity gate.
      expect(shouldShowDangerZone(10, 5, 20)).toBe(false);
    });

    it("shows the zone when data approaches the threshold (>=75%)", () => {
      expect(shouldShowDangerZone(15, 5, 20)).toBe(true); // 15/20 = 0.75 exactly
      expect(shouldShowDangerZone(18, 5, 20)).toBe(true);
    });

    it("shows the zone when a goal pacing line exceeds the threshold", () => {
      // Actual data is low but a goal demands an unrealistic pace.
      expect(shouldShowDangerZone(5, 25, 20)).toBe(true);
    });

    it("never shows the zone when there is no threshold", () => {
      expect(shouldShowDangerZone(100, 100, Infinity)).toBe(false);
    });

    it("returns false when the threshold is NaN (defensive guard)", () => {
      // NaN shouldn't reach the function in practice (Zod validates the
      // schema boundary), but the explicit guard documents the contract.
      expect(shouldShowDangerZone(100, 100, NaN)).toBe(false);
    });

    it("hides the zone when there's no data and the threshold exists", () => {
      // Edge case: 0/20 = 0 → below proximity.
      expect(shouldShowDangerZone(0, 0, 20)).toBe(false);
    });
  });

  describe("calculateCumulativeYAxisMax", () => {
    it("delegates to roundToCleanMax", () => {
      expect(calculateCumulativeYAxisMax(1200)).toBe(1250);
      expect(calculateCumulativeYAxisMax(5500)).toBe(6000);
    });
  });
});
