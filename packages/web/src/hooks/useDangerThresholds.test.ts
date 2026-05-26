import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { SportConfig } from "../api/activities";
import type { Preferences } from "../services/userConfigService";
import { useDangerThresholds, resolveDangerPace } from "./useDangerThresholds";

// State used by the mocks below — set per-test so we can vary fixtures.
const preferencesRef: { current: Partial<Preferences> | null } = { current: null };
const sportConfigRef: { current: SportConfig | null } = { current: null };

vi.mock("./useUserConfig", () => ({
  useUserConfig: () => ({ data: preferencesRef.current }),
}));

vi.mock("./usePublicSportConfig", () => ({
  usePublicSportConfig: () => ({
    sportConfig: sportConfigRef.current,
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

const FIXTURE_CONFIG: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters"],
      hasDistance: true,
      hasElevation: true,
      dangerPace: { valuePerDay: 20, unit: "miles" },
    },
    running: {
      displayName: "Running",
      stravaTypes: ["Run"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters"],
      hasDistance: true,
      hasElevation: true,
      dangerPace: { valuePerDay: 10, unit: "miles" },
    },
    yoga: {
      displayName: "Yoga",
      stravaTypes: ["Yoga"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes"],
      hasDistance: false,
      hasElevation: false,
      dangerPace: { valuePerDay: 2, unit: "hours" },
    },
    swimming: {
      displayName: "Swimming",
      stravaTypes: ["Swim"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters"],
      hasDistance: true,
      hasElevation: false,
    },
  },
};

describe("useDangerThresholds", () => {
  it("resolves config-defined dangerPace in US display units", () => {
    preferencesRef.current = null;
    sportConfigRef.current = FIXTURE_CONFIG;
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.getThreshold("cycling")).toBeCloseTo(20, 5);
    expect(result.current.getThreshold("running")).toBeCloseTo(10, 5);
    expect(result.current.getThreshold("yoga")).toBeCloseTo(2, 5);
  });

  it("converts distance thresholds when user prefers kilometers", () => {
    preferencesRef.current = { distanceUnit: "kilometers" };
    sportConfigRef.current = FIXTURE_CONFIG;
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.getThreshold("cycling")).toBeCloseTo(32.19, 1);
    expect(result.current.getThreshold("running")).toBeCloseTo(16.09, 1);
    expect(result.current.getThreshold("yoga")).toBeCloseTo(2, 5);
  });

  it("returns Infinity for sports without a configured dangerPace", () => {
    preferencesRef.current = null;
    sportConfigRef.current = FIXTURE_CONFIG;
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.getThreshold("swimming")).toBe(Infinity);
    expect(result.current.getThreshold("unknown")).toBe(Infinity);
  });

  it("returns Infinity when sport config has not loaded yet", () => {
    preferencesRef.current = null;
    sportConfigRef.current = null;
    const { result } = renderHook(() => useDangerThresholds());

    expect(result.current.getThreshold("cycling")).toBe(Infinity);
  });
});

describe("resolveDangerPace — per-kind unit resolution", () => {
  describe("distance", () => {
    it("converts miles → kilometers when user prefers km", () => {
      const result = resolveDangerPace({ valuePerDay: 20, unit: "miles" }, "kilometers", "feet");
      expect(result).toBeCloseTo(32.19, 1);
    });

    it("converts kilometers → miles when user prefers miles", () => {
      const result = resolveDangerPace({ valuePerDay: 32, unit: "kilometers" }, "miles", "feet");
      expect(result).toBeCloseTo(19.88, 1);
    });

    it("passes through when source and target distance units match", () => {
      expect(resolveDangerPace({ valuePerDay: 20, unit: "miles" }, "miles", "feet")).toBeCloseTo(
        20,
        5
      );
      expect(
        resolveDangerPace({ valuePerDay: 32, unit: "kilometers" }, "kilometers", "feet")
      ).toBeCloseTo(32, 5);
    });

    it("handles meters as a source unit", () => {
      // 32186.88 m = 20 mi
      const result = resolveDangerPace({ valuePerDay: 32186.88, unit: "meters" }, "miles", "feet");
      expect(result).toBeCloseTo(20, 1);
    });
  });

  describe("elevation", () => {
    it("converts feet → meters when user prefers metric elevation", () => {
      // 10000 ft = 3048 m
      const result = resolveDangerPace({ valuePerDay: 10000, unit: "feet" }, "miles", "meters");
      expect(result).toBeCloseTo(3048, 0);
    });

    it("passes through feet when user prefers imperial elevation", () => {
      expect(resolveDangerPace({ valuePerDay: 5000, unit: "feet" }, "miles", "feet")).toBeCloseTo(
        5000,
        5
      );
    });
  });

  describe("time", () => {
    it("converts minutes → hours (the canonical → display direction)", () => {
      expect(resolveDangerPace({ valuePerDay: 120, unit: "minutes" }, "miles", "feet")).toBeCloseTo(
        2,
        5
      );
    });

    it("passes through hours unchanged regardless of distance/elevation prefs", () => {
      // Time resolution doesn't depend on distance/elevation prefs.
      expect(resolveDangerPace({ valuePerDay: 1.5, unit: "hours" }, "miles", "feet")).toBe(1.5);
      expect(resolveDangerPace({ valuePerDay: 1.5, unit: "hours" }, "kilometers", "meters")).toBe(
        1.5
      );
    });
  });

  describe("sessions", () => {
    it("passes through unitless session counts", () => {
      expect(resolveDangerPace({ valuePerDay: 3, unit: "sessions" }, "miles", "feet")).toBe(3);
    });

    it("is invariant to distance/elevation prefs", () => {
      expect(resolveDangerPace({ valuePerDay: 3, unit: "sessions" }, "kilometers", "meters")).toBe(
        3
      );
    });
  });
});
