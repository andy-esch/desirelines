import { describe, it, expect } from "vitest";

/**
 * Keyboard focus draws the theme's ring: the `control-focus-ring` utility in tailwind.css,
 * which reads `--control-focus-ring`. A Tailwind `ring-*` on focus draws the same accent
 * ring in every theme, and shadcn's generated primitives come with one, so this catches
 * it coming back.
 */

/** Files that still draw their own focus ring, each with the reason. */
const OWN_RING_FOR_NOW: Readonly<Record<string, string>> = {
  "routes/MapActivityList.tsx": "routes-map list rows, not yet moved to the shared ring",
  "routes/MapFilterDrawer.tsx": "routes-map drawer, not yet moved to the shared ring",
  "routes/MapInsightsDrawer.tsx": "routes-map drawer tab, not yet moved to the shared ring",
  "routes/RegionBreakdownChart.tsx": "routes-map rows, not yet moved to the shared ring",
  "routes/SportBreakdownChart.tsx": "routes-map rows, not yet moved to the shared ring",
};

const sources = import.meta.glob<string>(["./**/*.tsx", "!./**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const OWN_RING = /\b(?:focus|focus-visible|focus-within):ring-/;

const withOwnRing = Object.entries(sources)
  .filter(([, text]) => OWN_RING.test(text))
  .map(([path]) => path.replace(/^\.\//, ""));

describe("focus rings", () => {
  it("scans the components", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain("./ui/button.tsx");
  });

  it("come from the theme's control-focus-ring, or a stated reason not to yet", () => {
    expect(withOwnRing.filter((path) => !(path in OWN_RING_FOR_NOW))).toEqual([]);
  });

  it("leave the list once a file moves to the shared ring", () => {
    expect(Object.keys(OWN_RING_FOR_NOW).filter((path) => !withOwnRing.includes(path))).toEqual([]);
  });
});
