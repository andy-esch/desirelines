import { describe, it, expect } from "vitest";
import { TAILWIND_CSS, THEME_FILES, stripComments } from "../test/themeCss";
import { THEME_SLOTS, slotSpec } from "./contract";

/**
 * Every token the stylesheets define has a reader.
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

  it("would catch a token nothing reads", () => {
    expect(isRead("--color-accent-cyan")).toBe(true);
    expect(isRead("--panel-body-padding")).toBe(true);
    expect(isRead("--never-read-token")).toBe(false);
  });
});
