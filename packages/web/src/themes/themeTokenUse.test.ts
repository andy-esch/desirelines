import { describe, it, expect } from "vitest";
import { TAILWIND_CSS, THEME_FILES, stripComments } from "../test/themeCss";
import { slotMentionsIn, slotReadsIn } from "../test/slotReads";
import { THEME_SLOTS, slotSpec } from "./contract";

/**
 * Every token the stylesheets define has a reader, and every slot is read where its kind
 * belongs.
 *
 * A token each theme defines costs a line in every theme file, and a new theme copies it, so
 * an unread one is dead weight that multiplies. The first audit found four that nothing
 * would ever read, and six designed values no component had picked up. A reader is a `var()` or `(--token)`
 * shorthand in any stylesheet or component, the token's name in a string
 * (`tint("--color-…")`), or a Tailwind utility that resolves to it (`bg-surface-raised`).
 */

/**
 * Tokens with no reader yet, each with the reason. A designed value can wait here for the
 * work that will read it, and leaves when that work lands.
 */
const UNREAD_FOR_NOW: Readonly<Record<string, string>> = {
  // Tailwind scans this file for class names, so the comment avoids spelling the class out:
  // without this token, the scale's largest step would take Tailwind's fixed default
  // instead of following the theme's `--radius` like the steps below it.
  "--radius-xl": "the top of the shadcn radius scale, kept whole",
};

/**
 * Slot reads the kind check can't place, because a constant or a variable holds the value
 * before it reaches a style. Listed by file, with what the value is for.
 */
const HELD_IN_SCRIPT: Readonly<Record<string, { slots: readonly string[]; reason: string }>> = {
  "components/Skeleton.tsx": {
    slots: ["--color-skeleton", "--color-skeleton-shimmer"],
    reason: "react-loading-skeleton's base color and the shimmer gradient it sweeps",
  },
  "components/charts/ActivityVolumeChart.tsx": {
    slots: ["--chart-bar-radius"],
    reason: "read raw by useThemeTokenValue and parsed into Recharts' bar radius",
  },
  "components/charts/ChartTooltip.tsx": {
    slots: ["--color-chart-neutral"],
    reason: "the color an entry without one falls back to, before it colors a swatch",
  },
  "components/charts/ChartTooltipFrame.tsx": {
    slots: ["--color-chart-tooltip-divider"],
    reason: "the divider border the title and the total share",
  },
  "components/dashboard/ActivityCalendarHeatmap.tsx": {
    slots: ["--color-intensity-0"],
    reason: "the heatmap's color steps, picked per cell",
  },
  "components/dashboard/RecentActivitiesList.tsx": {
    slots: ["--color-muted-text"],
    reason: "a ColorToken resolved to RGB for the impact scale's interpolation",
  },
  "components/theme/HeroDecoration.tsx": {
    slots: ["--color-bg-body"],
    reason: "the sunset blinds' gradient stops, joined into a background image",
  },
  "constants/chartColors.ts": {
    slots: [
      "--color-chart-actual-line",
      "--color-chart-average-line",
      "--color-goal-1",
      "--color-goal-2",
      "--color-goal-3",
      "--color-goal-4",
      "--color-goal-5",
    ],
    reason: "the chart colors, handed to Recharts' stroke and fill",
  },
  "constants/chartConfig.ts": {
    slots: ["--chart-average-dash", "--color-danger-zone"],
    reason:
      "the average's dash, read raw by useThemeTokenValue for Recharts; the danger hatch's stripe fill",
  },
};

const sources = import.meta.glob<string>(
  ["../**/*.{ts,tsx,css}", "!../**/*.test.{ts,tsx}", "!../test/**"],
  { query: "?raw", import: "default", eager: true }
);

const withoutComments = (path: string, text: string) =>
  path.endsWith(".css")
    ? stripComments(text)
    : text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/** Every custom property the app's stylesheets declare. */
const defined = new Set(
  [TAILWIND_CSS, ...THEME_FILES.values()].flatMap((css) =>
    [...stripComments(css).matchAll(/(--[\w-]+)\s*:/g)].map(([, name = ""]) => name)
  )
);

/** All source text with declarations removed, so defining a token doesn't count as reading it. */
const readable = Object.entries(sources)
  .map(([path, text]) => {
    const code = withoutComments(path, text);
    return path.endsWith(".css") ? code.replace(/--[\w-]+\s*:/g, "") : code;
  })
  .join("\n");

const components = Object.entries(sources)
  .filter(([path]) => /\.tsx?$/.test(path))
  .map(([path, text]) => withoutComments(path, text))
  .join("\n");

/**
 * Every custom property something declares: a stylesheet, an inline style or an arbitrary
 * Tailwind property in a component, or the runtime list below.
 */
const declared = new Set([
  ...Object.entries(sources)
    .filter(([path]) => path.endsWith(".css"))
    .flatMap(([, css]) =>
      [...stripComments(css).matchAll(/(--[\w-]+)\s*:/g)].map(([, n = ""]) => n)
    ),
  ...[...components.matchAll(/["'`[](--[\w-]+)["'`]?\s*:/g)].map(([, name = ""]) => name),
]);

/** Custom properties a library sets on the element at runtime: Base UI's popup sizing. */
const RUNTIME = new Set(["--anchor-width", "--available-height", "--available-width"]);

const COLOR_UTILITY =
  "(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|shadow|placeholder|decoration|accent|caret)";

/** The utility class prefixes a token in each Tailwind namespace answers to. */
const NAMESPACES: ReadonlyArray<[RegExp, string]> = [
  [/^--color-(.+)$/, COLOR_UTILITY],
  [/^--font-(.+)$/, "font"],
  [/^--radius-(.+)$/, "rounded(?:-[trbl]{1,2}|-[se]{1,2})?"],
  [/^--text-(.+)$/, "text"],
  [/^--shadow-(.+)$/, "shadow"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isRead(token: string): boolean {
  if (new RegExp(`${escape(token)}(?![\\w-])`).test(readable)) return true;
  return NAMESPACES.some(([pattern, prefix]) => {
    const name = token.match(pattern)?.[1];
    return (
      name !== undefined &&
      new RegExp(`(?<![\\w-])${prefix}-${escape(name)}(?![\\w-])`).test(components)
    );
  });
}

describe("theme tokens", () => {
  it("scans the stylesheets and the components", () => {
    expect(defined.size).toBeGreaterThan(200);
    expect(Object.keys(sources).filter((p) => p.endsWith(".css")).length).toBeGreaterThan(
      THEME_FILES.size
    );
  });

  it("each have a reader, or a stated reason not to yet", () => {
    const unread = [...defined].filter((t) => !isRead(t) && !(t in UNREAD_FOR_NOW));
    expect(unread).toEqual([]);
  });

  it("leave the unread list once something reads them", () => {
    const stale = Object.keys(UNREAD_FOR_NOW).filter((t) => !defined.has(t) || isRead(t));
    expect(stale).toEqual([]);
  });

  it("are lengths wherever a reader adds or subtracts them", () => {
    // `calc(0 - 1px)` is invalid, so a slot read that way must hold a length with a unit,
    // which the contract's length kinds require. The stepper once lost its 1px border
    // overlap to a bare 0.
    const additive = new Set(
      [
        ...readable.matchAll(/var\((--[\w-]+)\)(?:\s+|_)[-+](?:\s+|_)/g),
        ...readable.matchAll(/(?:\s+|_)[-+](?:\s+|_)var\((--[\w-]+)\)/g),
      ].map(([, name = ""]) => name)
    );
    expect(additive).toContain("--stepper-gap");
    const notLengths = [...additive].flatMap((name) => {
      const kind = slotSpec(name)?.kind;
      return kind === undefined || kind === "length" || kind === "lengths" || kind === "percentage"
        ? []
        : [`${name} is a ${kind}`];
    });
    expect(notLengths).toEqual([]);
  });

  it("are defined wherever something reads them", () => {
    const reads = new Set(
      [
        ...readable.matchAll(/var\(\s*(--[\w-]+)/g),
        ...readable.matchAll(/\((?:[\w-]+:)?(--[\w-]+)\)/g),
        ...components.matchAll(/["'`](--[\w-]+)["'`](?!\s*[:\]])/g),
      ]
        .map(([, name = ""]) => name)
        // A name built in a template literal (`--color-goal-${n}`) ends at its dash.
        .filter((name) => !name.startsWith("--tw-") && !name.endsWith("-"))
    );
    const undefinedReads = [...reads].filter((name) => !declared.has(name) && !RUNTIME.has(name));
    expect(undefinedReads).toEqual([]);
  });

  it("read a slot a theme may leave unset only with a fallback", () => {
    // A slot set to `initial` is unset, so a read without a fallback makes the property
    // invalid and it falls back to inherited or initial values instead of the default the
    // slot stands for.
    const bare = [...THEME_SLOTS]
      .filter(([, spec]) => spec.initial)
      .flatMap(([slot]) => (new RegExp(`\\((?:[\\w-]+:)?${slot}\\)`).test(readable) ? [slot] : []));
    expect(bare).toEqual([]);
  });

  describe("read as their kind", () => {
    /** Each source but the theme files and the contract, which set and name the slots. */
    const scanned = Object.entries(sources)
      .filter(([path]) => !path.startsWith("../css/themes/") && path !== "./contract.ts")
      .map(([path, text]) => [path.replace(/^\.\.\//, ""), withoutComments(path, text)] as const);
    const reads = scanned.flatMap(([path, text]) => slotReadsIn(path, text));

    it("scans the reads in every form", () => {
      expect(reads.length).toBeGreaterThan(400);
      const at = (slot: string) =>
        reads.filter((read) => read.slot === slot).map((r) => r.position);
      expect(at("--toggle-pressed-glow")).toEqual(["inset-shadow"]); // a utility
      expect(at("--th-case")).toEqual(["text-transform"]); // a stylesheet
      expect(at("--chart-actual-glow")).toEqual(["filter"]); // an inline style
      expect(at("--color-map-chrome-accent")).toEqual(["--color-accent-cyan"]); // a custom property
    });

    it("are read where their kind belongs", () => {
      const misread = reads.flatMap(({ file, slot, position, kinds }) => {
        const kind = slotSpec(slot)!.kind;
        return kinds.includes(kind) ? [] : [`${file}: ${slot}, a ${kind}, read as ${position}`];
      });
      expect(misread).toEqual([]);
    });

    it("are each placed, or held in script for a stated reason", () => {
      const unplaced = scanned.flatMap(([path, text]) => {
        const placed = new Map<string, number>();
        for (const read of slotReadsIn(path, text)) {
          placed.set(read.slot, (placed.get(read.slot) ?? 0) + 1);
        }
        return [...slotMentionsIn(path, text)]
          .filter(([slot, count]) => count > (placed.get(slot) ?? 0))
          .map(([slot]) => `${path} ${slot}`);
      });
      const held = Object.entries(HELD_IN_SCRIPT).flatMap(([path, { slots }]) =>
        slots.map((slot) => `${path} ${slot}`)
      );
      expect(unplaced.sort()).toEqual(held.sort());
    });

    it("would catch a slot read where its kind doesn't fit", () => {
      const misreads = (file: string, text: string) =>
        slotReadsIn(file, text)
          .filter(({ slot, kinds }) => !kinds.includes(slotSpec(slot)!.kind))
          .map(({ slot, position }) => `${slot} as ${position}`);
      // A text-shadow slot as a box-shadow, where it would draw nothing.
      expect(misreads("a.tsx", `"[box-shadow:var(--page-title-shadow)]"`)).toEqual([
        "--page-title-shadow as box-shadow",
      ]);
      expect(misreads("a.tsx", `style={{ boxShadow: "var(--page-title-shadow)" }}`)).toEqual([
        "--page-title-shadow as box-shadow",
      ]);
      // A color slot in a length utility.
      expect(misreads("a.tsx", `"text-(length:--color-accent-cyan)"`)).toEqual([
        "--color-accent-cyan as font-size",
      ]);
      // An inset glow anywhere but the utility that adds its `inset`.
      expect(misreads("a.tsx", `"[box-shadow:var(--toggle-pressed-glow)]"`)).toEqual([
        "--toggle-pressed-glow as box-shadow",
      ]);
      expect(misreads("a.tsx", `"inset-shadow-(--toggle-pressed-glow)"`)).toEqual([]);
      // A case slot as a border, in a stylesheet.
      expect(misreads("a.css", `.x { border: var(--th-case); }`)).toEqual(["--th-case as border"]);
      // Parts of a larger value: a length offset and a percentage mixed into a color.
      expect(
        misreads(
          "a.tsx",
          `"[text-shadow:0_0_var(--page-title-glow-size)_color-mix(in_srgb,currentColor_var(--page-title-glow-strength),transparent)]"`
        )
      ).toEqual([]);
      // A shadow slot as a part of another value.
      expect(misreads("a.tsx", `"[box-shadow:0_0_var(--panel-shadow)]"`)).toEqual([
        "--panel-shadow as box-shadow",
      ]);
    });
  });

  it("would catch a token nothing reads", () => {
    expect(isRead("--color-accent-cyan")).toBe(true);
    expect(isRead("--panel-body-padding")).toBe(true);
    expect(isRead("--never-read-token")).toBe(false);
  });
});
