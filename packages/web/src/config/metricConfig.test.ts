/**
 * Unit tests for MetricConfig system.
 *
 * Tests the centralized sport-specific metric configuration,
 * including interval calculations and sport overrides.
 */

import { describe, it, expect } from "vitest";
import {
  getMetricConfig,
  getChartInterval,
  generateYAxisTicks,
  isDistanceMetricSport,
  isSessionsMetricSport,
  isTimeMetricSport,
} from "./metricConfig";

describe("metricConfig", () => {
  describe("getMetricConfig", () => {
    describe("cycling (distance sport)", () => {
      it("returns distance-based config", () => {
        const config = getMetricConfig("cycling");
        expect(config.id).toBe("distance");
        expect(config.displayName).toBe("Distance");
      });

      it("has correct goal increment (100)", () => {
        const config = getMetricConfig("cycling");
        expect(config.goalIncrement).toBe(100);
      });

      it("has correct rounding factor (100)", () => {
        const config = getMetricConfig("cycling");
        expect(config.roundingFactor).toBe(100);
      });

      it("has correct default goal value (2500)", () => {
        const config = getMetricConfig("cycling");
        expect(config.defaultGoalValue).toBe(2500);
      });
    });

    describe("running (distance sport with overrides)", () => {
      it("returns distance-based config", () => {
        const config = getMetricConfig("running");
        expect(config.id).toBe("distance");
      });

      it("has overridden goal increment (10)", () => {
        const config = getMetricConfig("running");
        expect(config.goalIncrement).toBe(10);
      });

      it("has overridden rounding factor (10)", () => {
        const config = getMetricConfig("running");
        expect(config.roundingFactor).toBe(10);
      });

      it("has overridden default goal value (1000)", () => {
        const config = getMetricConfig("running");
        expect(config.defaultGoalValue).toBe(1000);
      });

      it("has overridden chart interval thresholds", () => {
        const config = getMetricConfig("running");
        expect(config.chartIntervalThresholds).toBeDefined();
        expect(config.chartIntervalThresholds[0]).toEqual({ max: 200, interval: 50 });
      });
    });

    describe("yoga (time sport)", () => {
      it("returns time-based config", () => {
        const config = getMetricConfig("yoga");
        expect(config.id).toBe("time");
        expect(config.displayName).toBe("Time");
      });

      it("has correct goal increment (5 hrs)", () => {
        const config = getMetricConfig("yoga");
        expect(config.goalIncrement).toBe(5);
      });

      it("has correct default goal value (100 hrs)", () => {
        const config = getMetricConfig("yoga");
        expect(config.defaultGoalValue).toBe(100);
      });

      it("has correct chart label", () => {
        const config = getMetricConfig("yoga");
        expect(config.chartLabel).toBe("hrs");
        expect(config.chartAxisLabel).toBe("hrs");
      });
    });

    describe("unknown sport", () => {
      it("defaults to distance config", () => {
        const config = getMetricConfig("unknown_sport");
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(100);
        expect(config.defaultGoalValue).toBe(2500);
      });
    });

    describe("other supported sports", () => {
      it("hiking has distance config with small increments", () => {
        const config = getMetricConfig("hiking");
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(10);
        expect(config.defaultGoalValue).toBe(500);
      });

      it("swimming has distance config with small increments", () => {
        const config = getMetricConfig("swimming");
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(10);
        expect(config.defaultGoalValue).toBe(200);
      });

      it("workout has time config", () => {
        const config = getMetricConfig("workout");
        expect(config.id).toBe("time");
        expect(config.defaultGoalValue).toBe(25);
      });
    });
  });

  describe("getChartInterval", () => {
    describe("cycling thresholds", () => {
      const cyclingConfig = getMetricConfig("cycling");

      it("returns 100 for values under 500", () => {
        expect(getChartInterval(300, cyclingConfig)).toBe(100);
        expect(getChartInterval(499, cyclingConfig)).toBe(100);
      });

      it("returns 250 for values 500-2000", () => {
        expect(getChartInterval(500, cyclingConfig)).toBe(250);
        expect(getChartInterval(1500, cyclingConfig)).toBe(250);
        expect(getChartInterval(1999, cyclingConfig)).toBe(250);
      });

      it("returns 500 for values 2000-5000", () => {
        expect(getChartInterval(2000, cyclingConfig)).toBe(500);
        expect(getChartInterval(3500, cyclingConfig)).toBe(500);
        expect(getChartInterval(4999, cyclingConfig)).toBe(500);
      });

      it("returns 1000 for values over 5000", () => {
        expect(getChartInterval(5000, cyclingConfig)).toBe(1000);
        expect(getChartInterval(10000, cyclingConfig)).toBe(1000);
      });
    });

    describe("running thresholds (overridden)", () => {
      const runningConfig = getMetricConfig("running");

      it("returns 50 for values under 200", () => {
        expect(getChartInterval(100, runningConfig)).toBe(50);
        expect(getChartInterval(199, runningConfig)).toBe(50);
      });

      it("returns 100 for values 200-500", () => {
        expect(getChartInterval(200, runningConfig)).toBe(100);
        expect(getChartInterval(400, runningConfig)).toBe(100);
      });
    });

    describe("yoga thresholds (time)", () => {
      const yogaConfig = getMetricConfig("yoga");

      it("returns 10 for values under 50", () => {
        expect(getChartInterval(30, yogaConfig)).toBe(10);
        expect(getChartInterval(49, yogaConfig)).toBe(10);
      });

      it("returns 25 for values 50-200", () => {
        expect(getChartInterval(50, yogaConfig)).toBe(25);
        expect(getChartInterval(150, yogaConfig)).toBe(25);
      });
    });

    it("handles zero max value", () => {
      const config = getMetricConfig("cycling");
      expect(getChartInterval(0, config)).toBe(100);
    });
  });

  describe("generateYAxisTicks", () => {
    it("generates ticks from 0 to beyond max value", () => {
      const config = getMetricConfig("cycling");
      const ticks = generateYAxisTicks(450, config);

      expect(ticks[0]).toBe(0);
      expect(ticks).toContain(100);
      expect(ticks).toContain(200);
      expect(ticks).toContain(300);
      expect(ticks).toContain(400);
      expect(ticks).toContain(500); // Beyond max
    });

    it("uses correct interval for yoga (time)", () => {
      const config = getMetricConfig("yoga");
      const ticks = generateYAxisTicks(35, config);

      // Interval should be 10 for values under 50 (hours)
      expect(ticks).toEqual([0, 10, 20, 30, 40]);
    });

    it("handles zero max value", () => {
      const config = getMetricConfig("cycling");
      const ticks = generateYAxisTicks(0, config);

      // Should have at least 0 and one interval
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBeGreaterThan(0);
    });

    it("handles large values correctly", () => {
      const config = getMetricConfig("cycling");
      const ticks = generateYAxisTicks(7500, config);

      // Base interval is 1000, but doubles to 2000 to stay within MAX_Y_TICKS (5)
      expect(ticks.every((t, i) => i === 0 || t - ticks[i - 1]! === 2000)).toBe(true);
      // Should have at most 5 non-zero ticks
      expect(ticks.filter((t) => t > 0).length).toBeLessThanOrEqual(5);
    });
  });

  describe("isDistanceMetricSport", () => {
    it("returns true for cycling", () => {
      expect(isDistanceMetricSport("cycling")).toBe(true);
    });

    it("returns true for running", () => {
      expect(isDistanceMetricSport("running")).toBe(true);
    });

    it("returns true for hiking", () => {
      expect(isDistanceMetricSport("hiking")).toBe(true);
    });

    it("returns false for yoga", () => {
      expect(isDistanceMetricSport("yoga")).toBe(false);
    });

    it("returns false for workout", () => {
      expect(isDistanceMetricSport("workout")).toBe(false);
    });

    it("returns true for unknown sport (defaults to distance)", () => {
      expect(isDistanceMetricSport("unknown")).toBe(true);
    });
  });

  describe("isSessionsMetricSport", () => {
    it("returns false for yoga (now time)", () => {
      expect(isSessionsMetricSport("yoga")).toBe(false);
    });

    it("returns false for workout (now time)", () => {
      expect(isSessionsMetricSport("workout")).toBe(false);
    });

    it("returns false for cycling", () => {
      expect(isSessionsMetricSport("cycling")).toBe(false);
    });

    it("returns false for running", () => {
      expect(isSessionsMetricSport("running")).toBe(false);
    });
  });

  describe("isTimeMetricSport", () => {
    it("returns true for yoga", () => {
      expect(isTimeMetricSport("yoga")).toBe(true);
    });

    it("returns true for workout", () => {
      expect(isTimeMetricSport("workout")).toBe(true);
    });

    it("returns true for golf", () => {
      expect(isTimeMetricSport("golf")).toBe(true);
    });

    it("returns false for cycling", () => {
      expect(isTimeMetricSport("cycling")).toBe(false);
    });

    it("returns false for running", () => {
      expect(isTimeMetricSport("running")).toBe(false);
    });
  });

  describe("config completeness", () => {
    const sports = [
      "cycling",
      "running",
      "yoga",
      "hiking",
      "swimming",
      "workout",
      "walking",
      "golf",
      "racket_sports",
      "team_sports",
      "climbing",
      "ebike",
      "watersports",
      "winter_sports",
      "skating",
      "wheelchair",
    ];

    it.each(sports)("%s config has all required properties", (sport) => {
      const config = getMetricConfig(sport);

      expect(config.id).toBeDefined();
      expect(config.displayName).toBeDefined();
      expect(config.unit).toBeDefined();
      expect(config.chartLabel).toBeDefined();
      expect(config.chartAxisLabel).toBeDefined();
      expect(config.perDayLabel).toBeDefined();
      expect(config.goalIncrement).toBeGreaterThan(0);
      expect(config.roundingFactor).toBeGreaterThan(0);
      expect(config.defaultGoalValue).toBeGreaterThan(0);
      expect(config.chartIntervalThresholds).toBeDefined();
      expect(config.chartIntervalThresholds.length).toBeGreaterThan(0);
    });

    it.each(sports)("%s has valid interval thresholds (ascending max values)", (sport) => {
      const config = getMetricConfig(sport);
      const thresholds = config.chartIntervalThresholds;

      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]!.max).toBeGreaterThan(thresholds[i - 1]!.max);
      }
    });

    it.each(sports)("%s has Infinity as final threshold max", (sport) => {
      const config = getMetricConfig(sport);
      const lastThreshold = config.chartIntervalThresholds.at(-1)!;

      expect(lastThreshold.max).toBe(Infinity);
    });
  });
});
