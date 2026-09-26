import { describe, it, expect } from "vitest";
import {
  CONTRAST_PAIRS,
  MARK_MIN,
  MARK_PAIRS,
  UNMEASURED_MARKS,
  slotSpec,
  type ColorSource,
  type SlotKind,
  type ThemeColorSlot,
} from "./contract";
import { THEME_FILES, resolveVars, themeBlocksIn } from "../test/themeCss";
import { splitTop } from "../test/themeValues";
import { composite, contrastBetween, parseRgba, type Rgba } from "../test/contrast";

/**
 * The contract's contrast pairs, measured in every theme: text at its pair's floor, and
 * non-text marks at WCAG 1.4.11's 3:1. A slot a theme sets to `initial` or `currentColor`
 * falls through to the next source in its list, a shadow or border is measured by its first
 * layer's color, and a translucent surface is painted over its `over` slot (the page ground
 * unless given).
 */

/** Themes the pairs don't bind, each with the reason. */
const EXEMPT: Readonly<Record<string, string>> = {
  "legacy-light":
    "predates the pairs and fails several (muted text 4.3:1, the accent's label 3.7:1); it is retired with Memphis",
};

/** Pairs a theme fails today, each with the reason. Keyed `<theme> <source> on <surface>`. */
const FAILING_FOR_NOW: Readonly<Record<string, string>> = {};

interface Pair {
  readonly key: string;
  readonly source: readonly ColorSource[];
  readonly on: readonly ThemeColorSlot[];
  readonly over: ThemeColorSlot;
  readonly min: number;
}

const nameOf = (source: ColorSource) => (typeof source === "string" ? source : source.slot);

const PAIRS: readonly Pair[] = [
  ...CONTRAST_PAIRS.map((pair) => ({
    key: `${pair.text[0]} on ${pair.on[0]}`,
    source: pair.text,
    on: pair.on,
    over: pair.over ?? "--color-bg-body",
    min: pair.min,
  })),
  ...MARK_PAIRS.map((pair) => ({
    key: `${nameOf(pair.mark[0])} on ${pair.on[0]}`,
    source: pair.mark,
    on: pair.on,
    over: pair.over ?? "--color-bg-body",
    min: MARK_MIN,
  })),
];

/** The color a value draws with: a shadow's first layer's color, a border's color. */
function colorWithin(kind: SlotKind | undefined, value: string): string | undefined {
  if (kind === "border") return splitTop(value, " ")[2];
  if (kind === "shadow" || kind === "text-shadow" || kind === "inset-glow") {
    const layer = splitTop(value, ",")[0] ?? "";
    return splitTop(layer, " ").find((part) => part !== "inset" && !/^-?[\d.]+[a-z%]*$/.test(part));
  }
  return value;
}

function colorOf(themeId: string, chain: readonly ColorSource[]): Rgba | string {
  const tokens = themeBlocksIn(THEME_FILES.get(themeId) ?? "")[0]?.tokens ?? new Map();
  for (const source of chain) {
    const slot = nameOf(source);
    const value = tokens.get(slot);
    if (value === undefined || value === "initial" || value === "currentColor") continue;
    const resolved = resolveVars(themeId, value);
    const color = colorWithin(slotSpec(slot)?.kind, resolved);
    const rgba = color === undefined ? null : parseRgba(color);
    if (!rgba) return `${slot} is ${resolved}, which can't be measured`;
    return typeof source === "string" ? rgba : { ...rgba, a: rgba.a * source.alpha };
  }
  return `none of ${chain.map(nameOf).join(", ")} is set`;
}

function measure(themeId: string, pair: Pair): number | string {
  const ground = colorOf(themeId, [pair.over]);
  const on = colorOf(themeId, pair.on);
  const fg = colorOf(themeId, pair.source);
  for (const color of [ground, on, fg]) if (typeof color === "string") return color;
  const surface = composite(on as Rgba, ground as Rgba);
  return contrastBetween(composite(fg as Rgba, surface), surface);
}

const measured = [...THEME_FILES.keys()]
  .filter((id) => !(id in EXEMPT))
  .flatMap((id) => PAIRS.map((pair) => ({ id, pair, ratio: measure(id, pair) })));

describe("contrast", () => {
  it("measures every pair in every theme not exempt", () => {
    const unmeasurable = measured.flatMap(({ id, pair, ratio }) =>
      typeof ratio === "string" ? [`${id} ${pair.key}: ${ratio}`] : []
    );
    expect(unmeasurable).toEqual([]);
    expect(measured.length).toBeGreaterThan(0);
  });

  it("holds each pair to its floor, or a stated reason not to yet", () => {
    const failing = measured.flatMap(({ id, pair, ratio }) =>
      typeof ratio === "number" && ratio < pair.min && !(`${id} ${pair.key}` in FAILING_FOR_NOW)
        ? [`${id} ${pair.key}: ${ratio.toFixed(2)}:1, under ${pair.min}:1`]
        : []
    );
    expect(failing).toEqual([]);
  });

  it("drops a known failure once the pair passes", () => {
    const passing = Object.keys(FAILING_FOR_NOW).filter((key) =>
      measured.some(
        ({ id, pair, ratio }) =>
          `${id} ${pair.key}` === key && typeof ratio === "number" && ratio >= pair.min
      )
    );
    const unknown = Object.keys(FAILING_FOR_NOW).filter(
      (key) => !measured.some(({ id, pair }) => `${id} ${pair.key}` === key)
    );
    expect([...passing, ...unknown]).toEqual([]);
  });

  it("names only themes that exist as exempt", () => {
    expect(Object.keys(EXEMPT).filter((id) => !THEME_FILES.has(id))).toEqual([]);
  });

  it("leaves out only slots it doesn't measure, each with a reason", () => {
    const marked = new Set(MARK_PAIRS.flatMap((pair) => pair.mark.map(nameOf)));
    const stray = Object.keys(UNMEASURED_MARKS).filter(
      (slot) => slotSpec(slot) === undefined || marked.has(slot as ThemeColorSlot)
    );
    expect(stray).toEqual([]);
  });
});
