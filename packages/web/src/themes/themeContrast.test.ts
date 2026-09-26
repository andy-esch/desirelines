import { describe, it, expect } from "vitest";
import { CONTRAST_PAIRS, type ContrastPair, type ThemeColorSlot } from "./contract";
import { THEME_FILES, resolveVars, themeBlocksIn } from "../test/themeCss";
import { composite, contrastBetween, parseRgba, type Rgba } from "../test/contrast";

/**
 * The contract's contrast pairs, measured in every theme. A text or surface slot a theme
 * sets to `initial` or `currentColor` falls through to the next slot in its list, and a
 * translucent surface is painted over its `over` slot (the page ground by default).
 */

/** Themes the pairs don't bind, each with the reason. */
const EXEMPT: Readonly<Record<string, string>> = {
  "legacy-light":
    "predates the pairs and fails several (muted text 4.3:1, the accent's label 3.7:1); it is retired with Memphis",
};

/** Pairs a theme fails today, each with the reason. Keyed `<theme> <text> on <surface>`. */
const FAILING_FOR_NOW: Readonly<Record<string, string>> = {};

const label = (pair: ContrastPair) => `${pair.text[0]} on ${pair.on[0]}`;

function colorOf(themeId: string, chain: readonly ThemeColorSlot[]): Rgba | string {
  const tokens = themeBlocksIn(THEME_FILES.get(themeId) ?? "")[0]?.tokens ?? new Map();
  for (const slot of chain) {
    const value = tokens.get(slot);
    if (value === undefined || value === "initial" || value === "currentColor") continue;
    const resolved = resolveVars(themeId, value);
    return parseRgba(resolved) ?? `${slot} is ${resolved}, which can't be measured`;
  }
  return `none of ${chain.join(", ")} is set`;
}

function measure(themeId: string, pair: ContrastPair): number | string {
  const ground = colorOf(themeId, [pair.over ?? "--color-bg-body"]);
  const on = colorOf(themeId, pair.on);
  const text = colorOf(themeId, pair.text);
  for (const color of [ground, on, text]) if (typeof color === "string") return color;
  const surface = composite(on as Rgba, ground as Rgba);
  return contrastBetween(composite(text as Rgba, surface), surface);
}

const measured = [...THEME_FILES.keys()]
  .filter((id) => !(id in EXEMPT))
  .flatMap((id) => CONTRAST_PAIRS.map((pair) => ({ id, pair, ratio: measure(id, pair) })));

describe("contrast", () => {
  it("measures every pair in every theme not exempt", () => {
    const unmeasurable = measured.flatMap(({ id, pair, ratio }) =>
      typeof ratio === "string" ? [`${id} ${label(pair)}: ${ratio}`] : []
    );
    expect(unmeasurable).toEqual([]);
    expect(measured.length).toBeGreaterThan(0);
  });

  it("holds each pair to its floor, or a stated reason not to yet", () => {
    const failing = measured.flatMap(({ id, pair, ratio }) =>
      typeof ratio === "number" && ratio < pair.min && !(`${id} ${label(pair)}` in FAILING_FOR_NOW)
        ? [`${id} ${label(pair)}: ${ratio.toFixed(2)}:1, under ${pair.min}:1`]
        : []
    );
    expect(failing).toEqual([]);
  });

  it("drops a known failure once the pair passes", () => {
    const passing = Object.keys(FAILING_FOR_NOW).filter((key) =>
      measured.some(
        ({ id, pair, ratio }) =>
          `${id} ${label(pair)}` === key && typeof ratio === "number" && ratio >= pair.min
      )
    );
    const unknown = Object.keys(FAILING_FOR_NOW).filter(
      (key) => !measured.some(({ id, pair }) => `${id} ${label(pair)}` === key)
    );
    expect([...passing, ...unknown]).toEqual([]);
  });

  it("names only themes that exist as exempt", () => {
    expect(Object.keys(EXEMPT).filter((id) => !THEME_FILES.has(id))).toEqual([]);
  });
});
