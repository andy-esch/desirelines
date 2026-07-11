import { describe, it, expect } from "vitest";
import { buildSportColorExpression } from "./routeMapStyle";
import type { SportConfig } from "../api/activities";

const FALLBACK = "rgb(150, 150, 150)";
const CYCLING = "rgb(255, 0, 255)"; // a spectrum color (magenta)
const RUNNING = "rgb(0, 255, 255)"; // a spectrum color (cyan)

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

function isColorString(v: unknown): boolean {
  return typeof v === "string" && /^rgb\(/.test(v);
}

describe("buildSportColorExpression", () => {
  it("returns the flat fallback color when sportConfig is null", () => {
    expect(buildSportColorExpression(null, { cycling: CYCLING }, FALLBACK)).toBe(FALLBACK);
  });

  it("maps each raw Strava sport_type to its category's supplied (spectrum) color", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride", "MountainBikeRide"] },
      running: { stravaTypes: ["Run"] },
    });

    const arr = buildSportColorExpression(
      config,
      { cycling: CYCLING, running: RUNNING },
      FALLBACK
    ) as unknown[];
    expect(arr[0]).toBe("match");
    expect(arr[1]).toEqual(["get", "sport"]);
    expect(arr[arr.length - 1]).toBe(FALLBACK);

    // cycling: multiple types grouped into an array label → cycling spectrum color
    const cyclingIdx = arr.indexOf(CYCLING);
    expect(arr[cyclingIdx - 1]).toEqual(["Ride", "MountainBikeRide"]);

    // running: single type → bare string label → running spectrum color
    const runningIdx = arr.indexOf(RUNNING);
    expect(arr[runningIdx - 1]).toBe("Run");
  });

  it("falls back when no category has a supplied color (e.g. dataset not loaded)", () => {
    const config = makeConfig({ cycling: { stravaTypes: ["Ride"] } });
    // Empty color map → no cases → flat fallback.
    expect(buildSportColorExpression(config, {}, FALLBACK)).toBe(FALLBACK);
  });

  it("only emits cases for categories present in the color map", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride"] },
      running: { stravaTypes: ["Run"] },
    });
    // running has no color → it must not appear; the map falls it to default.
    const arr = buildSportColorExpression(config, { cycling: CYCLING }, FALLBACK) as unknown[];
    expect(arr).toContain("Ride");
    expect(arr).not.toContain("Run");
  });

  it("produces a structurally valid match expression (alternating label/color pairs)", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride", "MountainBikeRide"] },
      running: { stravaTypes: ["Run"] },
    });

    const arr = buildSportColorExpression(
      config,
      { cycling: CYCLING, running: RUNNING },
      FALLBACK
    ) as unknown[];
    const pairs = arr.slice(2, -1);
    expect(pairs.length % 2).toBe(0);
    for (let i = 0; i < pairs.length; i += 2) {
      const label = pairs[i];
      const color = pairs[i + 1];
      const labelOk =
        typeof label === "string" ||
        (Array.isArray(label) && label.length > 0 && label.every((l) => typeof l === "string"));
      expect(labelOk).toBe(true);
      expect(isColorString(color)).toBe(true);
    }
  });

  it("covers every raw sport_type declared in the registry (nothing silently greys out)", () => {
    // Coverage guard: with a color for every category, EVERY raw stravaType the
    // registry declares must land a `match` case. A raw type left uncovered falls to
    // the grey fallback on the map only — silent, and invisible off the map.
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride", "VirtualRide", "MountainBikeRide", "GravelRide"] },
      running: { stravaTypes: ["Run", "TrailRun", "VirtualRun"] },
      walking: { stravaTypes: ["Walk", "Hike"] },
    });
    const colors = { cycling: CYCLING, running: RUNNING, walking: "rgb(0, 255, 0)" };

    const arr = buildSportColorExpression(config, colors, FALLBACK) as unknown[];

    // Collect the labels (even positions in the label/color pairs), flattening the
    // grouped-array labels into individual raw types.
    const pairs = arr.slice(2, -1);
    const covered = new Set<string>();
    for (let i = 0; i < pairs.length; i += 2) {
      const label = pairs[i];
      if (Array.isArray(label)) label.forEach((l) => covered.add(l as string));
      else covered.add(label as string);
    }

    const declared = Object.values(config.sportCategories).flatMap((c) => c.stravaTypes);
    for (const rawType of declared) {
      expect(covered.has(rawType)).toBe(true);
    }
  });

  it("de-duplicates a raw type that appears under multiple categories", () => {
    const config = makeConfig({
      cycling: { stravaTypes: ["Ride"] },
      other: { stravaTypes: ["Ride"] },
    });

    const arr = buildSportColorExpression(
      config,
      { cycling: CYCLING, other: RUNNING },
      FALLBACK
    ) as unknown[];
    const occurrences = arr.filter((x) => x === "Ride").length;
    expect(occurrences).toBe(1);
  });
});
