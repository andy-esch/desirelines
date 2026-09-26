import { describe, it, expect } from "vitest";
import { TAILWIND_CSS, THEME_FILES, stripComments } from "../test/themeCss";

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
 * Tokens with no reader yet, each with the reason. Most are designed values waiting on the
 * work that will read them, and leave this list when it lands.
 */
const UNREAD_FOR_NOW: Readonly<Record<string, string>> = {
  "--chip-border-strength": "read by sport chips, which hard-code 55% today",
  "--chip-hover-strength": "read by sport chips, which hard-code 10% today",
  "--chip-dot-radius": "read by sport chips, which hard-code a round dot today",
  "--stepper-gap": "read by the goal stepper's +/- buttons",
  "--control-focus-ring": "read by focus styles on inputs, selects and buttons",
  "--missing-value-color": "read by the dash shown for a missing value",
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

  it("would catch a token nothing reads", () => {
    expect(isRead("--color-accent-cyan")).toBe(true);
    expect(isRead("--panel-body-padding")).toBe(true);
    expect(isRead("--never-read-token")).toBe(false);
  });
});
