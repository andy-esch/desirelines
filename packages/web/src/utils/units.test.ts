import { describe, it, expect } from "vitest";
import {
  convertDistance,
  convertToMeters,
  convertElevation,
  formatElevation,
  goalMetersToDisplay,
  goalDisplayToMeters,
  METERS_TO_MILES,
  METERS_TO_KM,
  MILES_TO_METERS,
  KM_TO_METERS,
  formatHoursMinutes,
  splitSexagesimal,
} from "./units";

describe("units", () => {
  describe("splitSexagesimal", () => {
    it("splits a plain fractional value", () => {
      expect(splitSexagesimal(1.5)).toEqual({ whole: 1, rem: 30 });
    });

    it("carries a remainder that rounds to 60 into the whole part", () => {
      // 0.999 * 60 rounds to 60, which is not a valid minute/second value.
      // Without the carry this returns { whole: 1, rem: 60 }.
      expect(splitSexagesimal(1.999)).toEqual({ whole: 2, rem: 0 });
    });

    it("keeps a remainder that rounds to 59 as-is", () => {
      expect(splitSexagesimal(1.99)).toEqual({ whole: 1, rem: 59 });
    });

    it("handles exact whole values", () => {
      expect(splitSexagesimal(3)).toEqual({ whole: 3, rem: 0 });
    });

    it("never returns a remainder outside [0, 60)", () => {
      for (let i = 0; i <= 1000; i++) {
        const { rem } = splitSexagesimal(i / 1000);
        expect(rem).toBeGreaterThanOrEqual(0);
        expect(rem).toBeLessThan(60);
      }
    });
  });

  describe("formatHoursMinutes", () => {
    it("formats hours and minutes", () => {
      expect(formatHoursMinutes(1.25)).toBe("1 hr 15 min");
    });

    it("formats minutes only below an hour", () => {
      expect(formatHoursMinutes(0.75)).toBe("45 min");
    });

    it("formats whole hours without a minutes part", () => {
      expect(formatHoursMinutes(2)).toBe("2 hr");
    });

    it("rolls up to the next whole hour instead of rendering :60", () => {
      // Regression: Math.round(0.999 * 60) === 60 previously produced
      // "1 hr 60 min".
      expect(formatHoursMinutes(1.999)).toBe("2 hr");
    });

    it("rolls up from under an hour to exactly one hour", () => {
      // Previously "0 hr 60 min" collapsed to "60 min" via the h === 0 branch.
      expect(formatHoursMinutes(0.999)).toBe("1 hr");
    });
  });

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

  describe("formatElevation", () => {
    it("groups thousands for readability", () => {
      // 4925 m ≈ 16,158 ft
      expect(formatElevation(4925, "feet")).toBe("16,158 ft");
    });

    it("omits the separator below 1000", () => {
      expect(formatElevation(50, "feet")).toBe("164 ft");
    });
  });
});
