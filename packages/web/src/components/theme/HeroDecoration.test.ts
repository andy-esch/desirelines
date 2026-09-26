import { describe, it, expect } from "vitest";
import { themeToken } from "../../test/themeCss";
import { contrastRatio as contrast } from "../../test/contrast";
import { SUNSET_STOPS, GRID_FLOOR_HEIGHT, projectedPlaneHeight } from "./HeroDecoration";

const slot = (name: string) => themeToken("miami", name);

describe("Miami sunset", () => {
  it("keeps 4.5:1 between the hero text and every band text can sit on", () => {
    const ink = slot("--hero-ink");
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
    for (const stop of SUNSET_STOPS.filter((s) => s.behindText)) {
      expect(contrast(ink, stop.color), `${ink} on ${stop.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the lighter bands inside the bottom padding that content never enters", () => {
    const bottomPadding = parseFloat(slot("--hero-padding").split(/\s+/)[2] ?? "");
    for (const stop of SUNSET_STOPS.filter((s) => !s.behindText)) {
      const offset = parseFloat(stop.from.match(/100% - (\d+)px/)?.[1] ?? "NaN");
      expect(offset, `${stop.color} starts ${stop.from}`).toBeLessThanOrEqual(bottomPadding);
    }
  });
});

describe("Arcade grid", () => {
  const arcadeSlot = (name: string) => themeToken("arcade", name);

  it("keeps the floor inside the hero padding that content never enters", () => {
    // The plane is drawn from the bottom up; the hero reserves its bottom padding for it, so
    // a floor taller than that padding would run under the headline.
    const bottomPadding = parseFloat(arcadeSlot("--hero-padding").split(/\s+/)[2] ?? "");
    expect(bottomPadding).toBeGreaterThanOrEqual(GRID_FLOOR_HEIGHT);
  });

  it("keeps 4.5:1 between the hero ink and the ground the headline sits on", () => {
    // Above the horizon the hero is the page ground: the floor never reaches the text.
    const ink = arcadeSlot("--hero-ink");
    const ground = arcadeSlot("--color-bg-body");
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("plane projection", () => {
  it("matches what the browser draws, so the derivation can be trusted", () => {
    // Measured in headless Chrome at the values the floor uses: the transformed plane's
    // bounding box stood 98px above the hero's base. jsdom cannot compute a 3D transform,
    // so this is the one place that number is checked against a real renderer.
    expect(projectedPlaneHeight(360, 67, 700)).toBeCloseTo(98, 0);
  });

  it("converges on the horizon rather than growing with the plane", () => {
    // Perspective divides by depth, so a deeper plane cannot rise past perspective/tan(pitch).
    const horizon = 360 / Math.tan((67 * Math.PI) / 180);
    expect(projectedPlaneHeight(360, 67, 100_000)).toBeLessThan(horizon);
    expect(projectedPlaneHeight(360, 67, 100_000)).toBeGreaterThan(horizon * 0.95);
  });

  it("lies flatter as the pitch steepens", () => {
    expect(projectedPlaneHeight(360, 78, 700)).toBeLessThan(projectedPlaneHeight(360, 67, 700));
  });
});
