import { describe, it, expect } from "vitest";

/**
 * Dates go through `useThemeDateFormat()`, never through the formatters directly.
 *
 * The formatters take a style argument and default to the short spelling, so a direct call
 * compiles, passes its own tests, and quietly ignores the theme. That is how half the app
 * ended up printing `Sep 21` beside `09.08` in a theme that spells dates the dotted way.
 * This fails the moment a component or page reaches past the hook.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../{components,pages,hooks}/**/*.{ts,tsx}",
  {
    query: "?raw",
    eager: true,
    import: "default",
  }
);

/** The hook is the one place allowed to import them. */
const EXEMPT = /useThemeDateFormat\.ts$/;

const FORMATTER_IMPORT =
  /import\s*\{[^}]*\b(formatDisplayDate|formatChartAxisDate|chartAxisDateFormatter|formatActivityDate|formatMonthLabel)\b[^}]*\}\s*from\s*["'][^"']*(dateUtils|formatActivityDate|dateStyle)["']/;

describe("date formatters", () => {
  it("are reached through the theme hook, not imported directly", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !EXEMPT.test(path) && !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => FORMATTER_IMPORT.test(text))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("is looking at the tree it thinks it is", () => {
    // A glob that matches nothing would make the check above pass for the wrong reason.
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });
});
