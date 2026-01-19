import { describe, it, expect } from "vitest";
import {
  convertDistance,
  convertToMeters,
  convertElevation,
  goalMetersToDisplay,
  goalDisplayToMeters,
  roundGoalForDisplay,
  METERS_TO_MILES,
  METERS_TO_KM,
  MILES_TO_METERS,
  KM_TO_METERS,
} from "./units";

describe("units", () => {
  describe("conversion constants", () => {
    it("should have consistent mile conversion constants", () => {
      // 1 mile = 1609.344 meters
      expect(MILES_TO_METERS).toBe(1609.344);
      // Inverse should be approximately equal
      expect(1 / METERS_TO_MILES).toBeCloseTo(MILES_TO_METERS, 0);
    });

    it("should have consistent km conversion constants", () => {
      // 1 km = 1000 meters
      expect(KM_TO_METERS).toBe(1000);
      expect(1 / METERS_TO_KM).toBe(KM_TO_METERS);
    });
  });

  describe("convertDistance", () => {
    it("should convert meters to miles", () => {
      const meters = 1609.344; // 1 mile
      expect(convertDistance(meters, "miles")).toBeCloseTo(1, 5);
    });

    it("should convert meters to kilometers", () => {
      const meters = 1000; // 1 km
      expect(convertDistance(meters, "kilometers")).toBe(1);
    });

    it("should return meters unchanged when unit is meters", () => {
      const meters = 5000;
      expect(convertDistance(meters, "meters")).toBe(5000);
    });

    it("should handle zero", () => {
      expect(convertDistance(0, "miles")).toBe(0);
      expect(convertDistance(0, "kilometers")).toBe(0);
    });

    it("should handle large values", () => {
      const meters = 5000000; // 5000 km
      expect(convertDistance(meters, "kilometers")).toBe(5000);
      expect(convertDistance(meters, "miles")).toBeCloseTo(3106.86, 1);
    });
  });

  describe("convertToMeters", () => {
    it("should convert miles to meters", () => {
      const miles = 1;
      expect(convertToMeters(miles, "miles")).toBe(1609.344);
    });

    it("should convert kilometers to meters", () => {
      const km = 1;
      expect(convertToMeters(km, "kilometers")).toBe(1000);
    });

    it("should return meters unchanged when unit is meters", () => {
      const meters = 5000;
      expect(convertToMeters(meters, "meters")).toBe(5000);
    });

    it("should handle zero", () => {
      expect(convertToMeters(0, "miles")).toBe(0);
      expect(convertToMeters(0, "kilometers")).toBe(0);
    });
  });

  describe("convertDistance and convertToMeters are inverses", () => {
    it("should round-trip miles correctly", () => {
      const originalMiles = 2500;
      const meters = convertToMeters(originalMiles, "miles");
      const backToMiles = convertDistance(meters, "miles");
      // Use 2 decimal places - sufficient for distance display
      expect(backToMiles).toBeCloseTo(originalMiles, 2);
    });

    it("should round-trip kilometers correctly", () => {
      const originalKm = 4000;
      const meters = convertToMeters(originalKm, "kilometers");
      const backToKm = convertDistance(meters, "kilometers");
      expect(backToKm).toBe(originalKm);
    });
  });

  describe("goalMetersToDisplay", () => {
    it("should convert goal meters to miles", () => {
      const metersGoal = 4023360; // 2500 miles in meters
      const displayMiles = goalMetersToDisplay(metersGoal, "miles");
      expect(displayMiles).toBeCloseTo(2500, 0);
    });

    it("should convert goal meters to kilometers", () => {
      const metersGoal = 4000000; // 4000 km in meters
      const displayKm = goalMetersToDisplay(metersGoal, "kilometers");
      expect(displayKm).toBe(4000);
    });
  });

  describe("goalDisplayToMeters", () => {
    it("should convert display miles to meters for storage", () => {
      const displayMiles = 2500;
      const meters = goalDisplayToMeters(displayMiles, "miles");
      expect(meters).toBeCloseTo(4023360, 0);
    });

    it("should convert display km to meters for storage", () => {
      const displayKm = 4000;
      const meters = goalDisplayToMeters(displayKm, "kilometers");
      expect(meters).toBe(4000000);
    });
  });

  describe("goal conversion round-trip", () => {
    it("should preserve value when converting miles goal to meters and back", () => {
      const originalGoal = 3500; // 3500 miles
      const asMeters = goalDisplayToMeters(originalGoal, "miles");
      const backToMiles = Math.round(goalMetersToDisplay(asMeters, "miles"));
      expect(backToMiles).toBe(originalGoal);
    });

    it("should preserve value when converting km goal to meters and back", () => {
      const originalGoal = 5000; // 5000 km
      const asMeters = goalDisplayToMeters(originalGoal, "kilometers");
      const backToKm = Math.round(goalMetersToDisplay(asMeters, "kilometers"));
      expect(backToKm).toBe(originalGoal);
    });

    it("should correctly convert between miles and km via meters", () => {
      // User sets 3500 miles, switches to km
      const milesGoal = 3500;
      const asMeters = goalDisplayToMeters(milesGoal, "miles");
      const asKm = goalMetersToDisplay(asMeters, "kilometers");
      // 3500 miles ≈ 5632.7 km
      expect(asKm).toBeCloseTo(5632.7, 0);
    });
  });

  describe("roundGoalForDisplay", () => {
    it("should round to nearest 100 for cycling", () => {
      expect(roundGoalForDisplay(2549, 100)).toBe(2500);
      expect(roundGoalForDisplay(2550, 100)).toBe(2600);
      expect(roundGoalForDisplay(2499.99, 100)).toBe(2500);
    });

    it("should round to nearest 10 for running", () => {
      expect(roundGoalForDisplay(1005, 10)).toBe(1010);
      expect(roundGoalForDisplay(1004, 10)).toBe(1000);
    });

    it("should handle edge cases", () => {
      expect(roundGoalForDisplay(0, 100)).toBe(0);
      expect(roundGoalForDisplay(50, 100)).toBe(100);
    });
  });

  describe("convertElevation", () => {
    it("should convert meters to feet", () => {
      const meters = 1000;
      expect(convertElevation(meters, "feet")).toBeCloseTo(3280.84, 1);
    });

    it("should return meters unchanged when unit is meters", () => {
      const meters = 1000;
      expect(convertElevation(meters, "meters")).toBe(1000);
    });
  });
});
