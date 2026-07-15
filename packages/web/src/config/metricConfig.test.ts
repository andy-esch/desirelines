/**
 * Unit tests for MetricConfig system.
 *
 * Tests the centralized sport-specific metric configuration,
 * including interval calculations and sport overrides.
 */

import { describe, it, expect } from "vitest";
import {
  getMetricConfig,
  getMetricConfigByMetricId,
  getChartInterval,
  generateYAxisTicks,
} from "./metricConfig";
import type { UserSettings } from "../utils/units";
import type { SportConfig, GoalDefaults } from "../api/activities";

// Sport registry fixture mirroring schemas/sports/sport_types.json. This is the
// regression guard for the SPORT_METRIC_OVERRIDES → registry migration: driving
// getMetricConfig from these inputs must reproduce the exact values the old
// hard-coded overrides produced (increments, defaults, chart intervals).
const cat = (primaryMetric: string, goalDefaults?: GoalDefaults) => ({
  displayName: "",
  stravaTypes: [],
  excludedTypes: [],
  primaryMetric,
  metrics: [],
  hasDistance: primaryMetric === "distance_meters",
  hasElevation: false,
  ...(goalDefaults ? { goalDefaults } : {}),
});

const TEST_SPORT_CONFIG: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: cat("distance_meters"),
    running: cat("distance_meters", {
      increment: 10,
      rounding: 10,
      defaultValue: 1000,
      chartIntervals: [
        { max: 200, interval: 50 },
        { max: 500, interval: 100 },
        { max: 1500, interval: 250 },
        { interval: 500 },
      ],
    }),
    yoga: cat("time_minutes"),
    hiking: cat("distance_meters", {
      increment: 10,
      rounding: 10,
      defaultValue: 500,
      chartIntervals: [
        { max: 100, interval: 25 },
        { max: 500, interval: 50 },
        { max: 1000, interval: 100 },
        { interval: 250 },
      ],
    }),
    swimming: cat("distance_meters", {
      increment: 10,
      rounding: 10,
      defaultValue: 200,
      chartIntervals: [
        { max: 50, interval: 10 },
        { max: 200, interval: 25 },
        { max: 500, interval: 50 },
        { interval: 100 },
      ],
    }),
    workout: cat("time_minutes", { defaultValue: 25 }),
    walking: cat("distance_meters", { increment: 10, rounding: 10, defaultValue: 500 }),
    golf: cat("time_minutes"),
    racket_sports: cat("time_minutes"),
    team_sports: cat("time_minutes"),
    climbing: cat("time_minutes"),
    ebike: cat("distance_meters"),
    watersports: cat("distance_meters"),
    winter_sports: cat("distance_meters"),
    skating: cat("distance_meters"),
    wheelchair: cat("distance_meters"),
  },
};

describe("metricConfig", () => {
  describe("getMetricConfig", () => {
    describe("cycling (distance sport)", () => {
      it("returns distance-based config", () => {
        const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
        expect(config.id).toBe("distance");
        expect(config.displayName).toBe("Distance");
      });

      it("has correct goal increment (100)", () => {
        const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
        expect(config.goalIncrement).toBe(100);
      });

      it("has correct rounding factor (100)", () => {
        const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
        expect(config.roundingFactor).toBe(100);
      });

      it("has correct default goal value (2500)", () => {
        const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
        expect(config.defaultGoalValue).toBe(2500);
      });
    });

    describe("running (distance sport with overrides)", () => {
      it("returns distance-based config", () => {
        const config = getMetricConfig("running", TEST_SPORT_CONFIG);
        expect(config.id).toBe("distance");
      });

      it("has overridden goal increment (10)", () => {
        const config = getMetricConfig("running", TEST_SPORT_CONFIG);
        expect(config.goalIncrement).toBe(10);
      });

      it("has overridden rounding factor (10)", () => {
        const config = getMetricConfig("running", TEST_SPORT_CONFIG);
        expect(config.roundingFactor).toBe(10);
      });

      it("has overridden default goal value (1000)", () => {
        const config = getMetricConfig("running", TEST_SPORT_CONFIG);
        expect(config.defaultGoalValue).toBe(1000);
      });

      it("has overridden chart interval thresholds", () => {
        const config = getMetricConfig("running", TEST_SPORT_CONFIG);
        expect(config.chartIntervalThresholds).toBeDefined();
        expect(config.chartIntervalThresholds[0]).toEqual({ max: 200, interval: 50 });
      });
    });

    describe("yoga (time sport)", () => {
      it("returns time-based config", () => {
        const config = getMetricConfig("yoga", TEST_SPORT_CONFIG);
        expect(config.id).toBe("time");
        expect(config.displayName).toBe("Time");
      });

      it("has correct goal increment (5 hrs)", () => {
        const config = getMetricConfig("yoga", TEST_SPORT_CONFIG);
        expect(config.goalIncrement).toBe(5);
      });

      it("has correct default goal value (100 hrs)", () => {
        const config = getMetricConfig("yoga", TEST_SPORT_CONFIG);
        expect(config.defaultGoalValue).toBe(100);
      });

      it("has correct chart label", () => {
        const config = getMetricConfig("yoga", TEST_SPORT_CONFIG);
        expect(config.chartLabel).toBe("hrs");
        expect(config.chartAxisLabel).toBe("hrs");
      });
    });

    describe("unknown sport", () => {
      it("defaults to distance config", () => {
        const config = getMetricConfig("unknown_sport", TEST_SPORT_CONFIG);
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(100);
        expect(config.defaultGoalValue).toBe(2500);
      });
    });

    describe("other supported sports", () => {
      it("hiking has distance config with small increments", () => {
        const config = getMetricConfig("hiking", TEST_SPORT_CONFIG);
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(10);
        expect(config.defaultGoalValue).toBe(500);
      });

      it("swimming has distance config with small increments", () => {
        const config = getMetricConfig("swimming", TEST_SPORT_CONFIG);
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(10);
        expect(config.defaultGoalValue).toBe(200);
      });

      it("workout has time config", () => {
        const config = getMetricConfig("workout", TEST_SPORT_CONFIG);
        expect(config.id).toBe("time");
        expect(config.defaultGoalValue).toBe(25);
      });
    });

    // While sportConfig is still loading (null), getMetricConfig resolves the
    // sport's base metric type from FALLBACK_BASE_METRIC so units don't flash —
    // but it carries NO goal tuning (that arrives only once the registry loads).
    describe("loading fallback (sportConfig null)", () => {
      it("resolves a distance-based config for cycling", () => {
        expect(getMetricConfig("cycling", null).id).toBe("distance");
      });

      it("resolves a time-based config for yoga (no unit flash)", () => {
        const config = getMetricConfig("yoga", null);
        expect(config.id).toBe("time");
        expect(config.chartLabel).toBe("hrs");
      });

      it("resolves a time-based config for workout", () => {
        expect(getMetricConfig("workout", null).id).toBe("time");
      });

      it("uses base tuning (no goalDefaults) until the registry loads", () => {
        // running's registry tuning is 10/1000; before the config loads it must
        // show the distance base (100/2500), never throw or apply stale values.
        const config = getMetricConfig("running", null);
        expect(config.id).toBe("distance");
        expect(config.goalIncrement).toBe(100);
        expect(config.defaultGoalValue).toBe(2500);
      });

      it("defaults an unknown sport to distance", () => {
        expect(getMetricConfig("unknown_sport", null).id).toBe("distance");
      });
    });
  });

  describe("getMetricConfigByMetricId", () => {
    const settings = (
      distanceUnit: UserSettings["distanceUnit"],
      elevationUnit: UserSettings["elevationUnit"]
    ): UserSettings => ({ distanceUnit, elevationUnit, defaultSport: "cycling" });

    it("returns the base distance config (miles) when no userSettings given", () => {
      const config = getMetricConfigByMetricId("distance_meters");
      expect(config.unit).toBe("miles");
      expect(config.chartLabel).toBe("mi");
      expect(config.chartAxisLabel).toBe("mi");
      expect(config.perDayLabel).toBe("mi / day");
    });

    it("applies kilometers preference to distance", () => {
      const config = getMetricConfigByMetricId("distance_meters", settings("kilometers", "feet"));
      expect(config.unit).toBe("kilometers");
      expect(config.chartLabel).toBe("km");
      expect(config.chartAxisLabel).toBe("km");
      expect(config.perDayLabel).toBe("km / day");
    });

    it("applies meters preference to distance", () => {
      const config = getMetricConfigByMetricId("distance_meters", settings("meters", "feet"));
      expect(config.unit).toBe("meters");
      expect(config.chartLabel).toBe("m");
      expect(config.chartAxisLabel).toBe("m");
      expect(config.perDayLabel).toBe("m / day");
    });

    it("keeps miles (base) for distance when distanceUnit is miles", () => {
      const config = getMetricConfigByMetricId("distance_meters", settings("miles", "feet"));
      expect(config.unit).toBe("miles");
      expect(config.chartLabel).toBe("mi");
      expect(config.perDayLabel).toBe("mi / day");
    });

    it("applies meters preference to elevation", () => {
      const config = getMetricConfigByMetricId("elevation_meters", settings("miles", "meters"));
      expect(config.unit).toBe("meters");
      expect(config.chartLabel).toBe("m");
      expect(config.chartAxisLabel).toBe("m");
      expect(config.perDayLabel).toBe("m / day");
    });

    it("keeps feet (base) for elevation when elevationUnit is feet", () => {
      const config = getMetricConfigByMetricId("elevation_meters", settings("miles", "feet"));
      expect(config.unit).toBe("feet");
      expect(config.chartLabel).toBe("ft");
      expect(config.perDayLabel).toBe("ft / day");
    });
  });

  describe("getChartInterval", () => {
    describe("cycling thresholds", () => {
      const cyclingConfig = getMetricConfig("cycling", TEST_SPORT_CONFIG);

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
      const runningConfig = getMetricConfig("running", TEST_SPORT_CONFIG);

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
      const yogaConfig = getMetricConfig("yoga", TEST_SPORT_CONFIG);

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
      const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
      expect(getChartInterval(0, config)).toBe(100);
    });
  });

  describe("generateYAxisTicks", () => {
    it("generates ticks from 0 to beyond max value", () => {
      const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
      const ticks = generateYAxisTicks(450, config);

      expect(ticks[0]).toBe(0);
      expect(ticks).toContain(100);
      expect(ticks).toContain(200);
      expect(ticks).toContain(300);
      expect(ticks).toContain(400);
      expect(ticks).toContain(500); // Beyond max
    });

    it("uses correct interval for yoga (time)", () => {
      const config = getMetricConfig("yoga", TEST_SPORT_CONFIG);
      const ticks = generateYAxisTicks(35, config);

      // Interval should be 10 for values under 50 (hours)
      expect(ticks).toEqual([0, 10, 20, 30, 40]);
    });

    it("handles zero max value", () => {
      const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
      const ticks = generateYAxisTicks(0, config);

      // Should have at least 0 and one interval
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBeGreaterThan(0);
    });

    it("handles large values correctly", () => {
      const config = getMetricConfig("cycling", TEST_SPORT_CONFIG);
      const ticks = generateYAxisTicks(7500, config);

      // Base interval is 1000, but doubles to 2000 to stay within MAX_Y_TICKS (5)
      expect(ticks.every((t, i) => i === 0 || t - ticks[i - 1]! === 2000)).toBe(true);
      // Should have at most 5 non-zero ticks
      expect(ticks.filter((t) => t > 0).length).toBeLessThanOrEqual(5);
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
      const config = getMetricConfig(sport, TEST_SPORT_CONFIG);

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
      const config = getMetricConfig(sport, TEST_SPORT_CONFIG);
      const thresholds = config.chartIntervalThresholds;

      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]!.max).toBeGreaterThan(thresholds[i - 1]!.max);
      }
    });

    it.each(sports)("%s has Infinity as final threshold max", (sport) => {
      const config = getMetricConfig(sport, TEST_SPORT_CONFIG);
      const lastThreshold = config.chartIntervalThresholds.at(-1)!;

      expect(lastThreshold.max).toBe(Infinity);
    });
  });
});
