import { describe, it, expect } from "vitest";
import { FIXED_COLORS, THEME_CONTRACT, THEME_SLOTS, slotSpec } from "./contract";
import {
  TAILWIND_CSS,
  THEME_FILES,
  resolveVars,
  stripComments,
  themeBlocksIn,
} from "../test/themeCss";
import { isKind } from "../test/themeValues";
import styleGuide from "../../docs/style-guide.md?raw";

/** Every theme file checked against the contract (see the header comment in contract.ts). */
const blocks = new Map(
  [...THEME_FILES].map(([id, file]) => [id, themeBlocksIn(file)[0]?.tokens ?? new Map()])
);

describe("the theme contract", () => {
  it("lists each slot once", () => {
    const listed = Object.values(THEME_CONTRACT).flatMap((slots) => Object.keys(slots));
    expect(listed.length).toBe(THEME_SLOTS.size);
  });

  it("is what every theme file sets, and nothing else", () => {
    const gaps = [...blocks].flatMap(([id, tokens]) => [
      ...[...THEME_SLOTS.keys()]
        .filter((slot) => !tokens.has(slot))
        .map((slot) => `${id} is missing ${slot}`),
      ...[...tokens.keys()]
        .filter((name) => !slotSpec(name))
        .map((name) => `${id} sets ${name}, which the contract doesn't list`),
    ]);
    expect(gaps).toEqual([]);
  });

  it("holds a value of each slot's kind in every theme", () => {
    const wrong = [...blocks].flatMap(([id, tokens]) =>
      [...THEME_SLOTS].flatMap(([slot, spec]) => {
        const value = tokens.get(slot);
        if (value === undefined) return [];
        if (value === "initial") {
          return spec.initial ? [] : [`${id} ${slot}: initial, which the slot doesn't allow`];
        }
        const resolved = resolveVars(id, value);
        return isKind(spec.kind, resolved, spec.keywords)
          ? []
          : [`${id} ${slot}: ${resolved} doesn't parse as ${spec.kind}`];
      })
    );
    expect(wrong).toEqual([]);
  });

  it("leaves the fixed colors to tailwind.css", () => {
    // tailwind.css registers every theme color at the default theme's value, plus the
    // colors no theme changes; the second set is FIXED_COLORS.
    const registered = [
      ...(stripComments(TAILWIND_CSS).match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(
        /(--color-[\w-]+)\s*:/g
      ),
    ].map(([, name = ""]) => name);
    expect(registered.filter((name) => !slotSpec(name)).sort()).toEqual([...FIXED_COLORS].sort());
  });
});

/**
 * The style guide names slots in backticks, a full name or a `-suffix` that continues a
 * full name in the same row or paragraph (`--track-height`, `-bg`). `-accent-1/2/3` stands
 * for three suffixes, and `--color-goal-1` to `-5` for a numbered run.
 */
function documents(unit: string, slot: string): boolean {
  const names = [...unit.matchAll(/`(--[\w-]+)`/g)].map(([, name = ""]) => name);
  if (names.includes(slot)) return true;
  const suffixes = suffixesIn(unit);
  const segments = slot.slice(2).split("-");
  return segments.slice(1).some((_, i) => {
    const prefix = `--${segments.slice(0, i + 1).join("-")}`;
    const suffix = `-${segments.slice(i + 1).join("-")}`;
    return (
      suffixes.includes(suffix) && names.some((n) => n === prefix || n.startsWith(`${prefix}-`))
    );
  });
}

function suffixesIn(unit: string): string[] {
  const runs = [...unit.matchAll(/`--[\w-]*?-(\d+)` to `-(\d+)`/g)].flatMap(([, from, to]) =>
    Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `-${Number(from) + i}`)
  );
  const written = [...unit.matchAll(/`(-[\w/-]+)`/g)]
    .map(([, s = ""]) => s)
    .filter((s) => !s.startsWith("--"))
    .flatMap((s) => {
      const [, head = "", nums = "", tail = ""] =
        s.match(/^(-[\w-]*?)(\d+(?:\/\d+)+)(-[\w-]+)?$/) ?? [];
      return nums ? nums.split("/").map((n) => `${head}${n}${tail}`) : [s];
    });
  return [...runs, ...written];
}

/** A section of the style guide, from its heading to the next heading of its level or above. */
function section(heading: string): string {
  const start = styleGuide.indexOf(`${heading}\n`);
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const rest = styleGuide.slice(start + heading.length);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return start < 0 ? "" : rest.slice(0, end < 0 ? undefined : end);
}

/** The "Theme slots" table's rows, by the group in their first cell. */
const slotRows = new Map(
  (
    section("### Theme slots")
      .split(/\n\s*\n/)
      .find((block) => block.trimStart().startsWith("| Group")) ?? ""
  )
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Group"))
    .map((line) => [line.split("|")[1]!.trim(), line] as const)
);

/** "The color system" as table rows and paragraphs, the units a suffix continues within. */
const colorUnits = section("## The color system")
  .split(/\n\s*\n/)
  .flatMap((block) => (block.trimStart().startsWith("|") ? block.split("\n") : [block]));

describe("the style guide", () => {
  it("has a slot table row for each group, and no others", () => {
    const groups = Object.keys(THEME_CONTRACT).filter((group) => group !== "Colors");
    expect([...slotRows.keys()].sort()).toEqual(groups.sort());
  });

  it("documents every slot in its group's row, and the colors in the color system", () => {
    const undocumented = [...THEME_SLOTS].flatMap(([slot, { group }]) => {
      const found =
        group === "Colors"
          ? colorUnits.some((unit) => documents(unit, slot))
          : documents(slotRows.get(group) ?? "", slot);
      return found ? [] : [`${slot} (${group})`];
    });
    expect(undocumented).toEqual([]);
  });

  it("names nothing in the slot table that its group doesn't hold", () => {
    const stray = [...slotRows].flatMap(([group, row]) => {
      const members = [...THEME_SLOTS].filter(([, spec]) => spec.group === group).map(([s]) => s);
      const names = [...row.matchAll(/`(--[\w-]+)`/g)].map(([, name = ""]) => name);
      return [
        ...names.filter((name) => slotSpec(name)?.group !== group).map((n) => `${group}: ${n}`),
        ...suffixesIn(row)
          .filter(
            (suffix) => !members.some((slot) => slot.endsWith(suffix) && documents(row, slot))
          )
          .map((suffix) => `${group}: ${suffix}`),
      ];
    });
    expect(stray).toEqual([]);
  });
});

describe("the value checks", () => {
  it.each([
    ["length", "0px"],
    ["length", "-0.5rem"],
    ["length", "50%"],
    ["lengths", "0.625rem 0.5rem"],
    ["percentage", "35%"],
    ["number", "0"],
    ["weight", "bold"],
    ["tracking", "normal"],
    ["case", "uppercase"],
    ["font", '"IBM Plex Mono", ui-monospace, -apple-system, sans-serif'],
    ["color", "rgb(255 255 255 / 0.5)"],
    ["color", "color-mix(in srgb, #00ffff 45%, transparent)"],
    ["shadow", "inset 0 0 24px rgba(0, 255, 255, 0.1), 0 0 18px #ff00ff"],
    ["text-shadow", "0 0 22px rgba(255, 46, 196, 0.6), 2px 2px 0 #00e5ff"],
    ["inset-glow", "0 0 #0000"],
    ["border", "1px dashed rgba(201, 184, 224, 0.25)"],
    ["image", "linear-gradient(90deg, #00ffff 0%, #ff00ff 100%)"],
    ["filter", "drop-shadow(0 0 5px rgba(0, 255, 255, 0.6))"],
    ["dash", "5 5"],
  ] as const)("take a %s written %s", (kind, value) => {
    expect(isKind(kind, value)).toBe(true);
  });

  it.each([
    // A bare 0 is invalid in calc(0 - 1px), which silently drops the declaration.
    ["length", "0"],
    ["length", "auto"],
    ["lengths", "1px 2px 3px 4px 5px"],
    ["percentage", "0.35"],
    ["weight", "450"],
    ["case", "small-caps"],
    ["color", "#00fff"],
    ["color", "red"],
    ["color", "color-mix(in srgb, #00ffff 45%)"],
    ["shadow", "0 0 10px 2px 1px #000"],
    ["text-shadow", "inset 0 0 8px #000"],
    ["text-shadow", "0 0 8px 2px #000"],
    ["inset-glow", "none"],
    ["inset-glow", "0 0 4px #000, 0 0 8px #000"],
    ["border", "1px solid"],
    ["image", "url(sunset.png)"],
    ["filter", "blur"],
    ["dash", "5px 5px"],
  ] as const)("refuse a %s written %s", (kind, value) => {
    expect(isKind(kind, value)).toBe(false);
  });

  it("take a slot's own keywords", () => {
    expect(isKind("length", "auto", ["auto"])).toBe(true);
  });
});
