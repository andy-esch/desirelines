import { describe, it, expect } from "vitest";
import { buildSportColorExpression } from "./routeMapStyle";
import {
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  DEFAULT_SPORT_COLOR,
  DEFAULT_SPORT_TEXT_COLOR,
} from "./sportConfig";
import type { SportConfig } from "../api/activities";

function makeConfig(categories: Record<string, { stravaTypes: string[] }>): SportConfig {
  const sportCategories = Object.fromEntries(
    Object.entries(categories).map(([key, { stravaTypes }]) => [
      key,
      {
        displayName: key,
        stravaTypes,
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: [],
        hasDistance: true,
        hasElevation: true,
      },
    ])
  );
  return { version: "1.0", sportCategories };
}

/** A color value our palettes produce — `rgb(...)` strings. */
function isColorString(v: unknown): boolean {
  return typeof v === "string" && /^rgb\(/.test(v);
}

describe("buildSportColorExpression", () => {
  it("returns a flat default color when sportConfig is null (per theme)", () => {
    expect(buildSportColorExpression(null, true)).toBe(DEFAULT_SPORT_COLOR);
    expect(buildSportColorExpression(null, false)).toBe(DEFAULT_SPORT_TEXT_COLOR);
  });

  it("maps each raw Strava sport_type to its category color (dark palette)", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride", "MountainBikeRide"] },
      running: { stravaTypes: ["Run"] },
    });

    const arr = buildSportColorExpression(config, true) as unknown[];
    expect(arr[0]).toBe("match");
    expect(arr[1]).toEqual(["get", "sport"]);
    expect(arr[arr.length - 1]).toBe(DEFAULT_SPORT_COLOR);

    // cycling: multiple types grouped into an array label → cycling neon color
    const cyclingIdx = arr.indexOf(SPORT_COLORS.cycling);
    expect(arr[cyclingIdx - 1]).toEqual(["Ride", "MountainBikeRide"]);

    // running: single type → bare string label → running color
    const runningIdx = arr.indexOf(SPORT_COLORS.running);
    expect(arr[runningIdx - 1]).toBe("Run");
  });

  it("uses the darker text palette on the light basemap", () => {
    const config = makeConfig({ cycling: { stravaTypes: ["Ride"] } });

    const arr = buildSportColorExpression(config, false) as unknown[];
    expect(arr).toContain(SPORT_TEXT_COLORS.cycling);
    expect(arr).not.toContain(SPORT_COLORS.cycling);
    expect(arr[arr.length - 1]).toBe(DEFAULT_SPORT_TEXT_COLOR);
  });

  it("produces a structurally valid match expression (alternating label/color pairs)", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride", "MountainBikeRide"] },
      running: { stravaTypes: ["Run"] },
    });

    const arr = buildSportColorExpression(config, true) as unknown[];
    // [ "match", input, (label, color) * N, default ]
    const pairs = arr.slice(2, -1);
    expect(pairs.length % 2).toBe(0);
    for (let i = 0; i < pairs.length; i += 2) {
      const label = pairs[i];
      const color = pairs[i + 1];
      // label is a string or a non-empty array of strings
      const labelOk =
        typeof label === "string" ||
        (Array.isArray(label) && label.length > 0 && label.every((l) => typeof l === "string"));
      expect(labelOk).toBe(true);
      expect(isColorString(color)).toBe(true);
    }
  });

  it("falls back to the default color for categories missing from the palette", () => {
    const config = makeConfig({ unknown_sport: { stravaTypes: ["MysteryType"] } });

    const arr = buildSportColorExpression(config, true) as unknown[];
    const labelIdx = arr.indexOf("MysteryType");
    expect(arr[labelIdx + 1]).toBe(DEFAULT_SPORT_COLOR);
  });

  it("de-duplicates a raw type that appears under multiple categories", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride"] },
      other: { stravaTypes: ["Ride"] },
    });

    const arr = buildSportColorExpression(config, true) as unknown[];
    const occurrences = arr.filter((x) => x === "Ride").length;
    expect(occurrences).toBe(1);
  });
});
