import { describe, it, expect } from "vitest";

/**
 * Label type comes from `SectionLabel` or its exported classes, never from the slots directly.
 *
 * The `--label-*` slots are the theme's label type. Copying them into a component compiles
 * and looks right today, but each copy drifts on its own: one gets `leading-tight` and the
 * next doesn't, one picks up the weight and the next forgets it. That is how the filter
 * drawer, map list and dashboard pager ended up with five slightly different labels. This
 * fails the moment a component spells the slots out instead of reusing them.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../{components,pages,hooks}/**/*.{ts,tsx}",
  {
    query: "?raw",
    eager: true,
    import: "default",
  }
);

/** `SectionLabel` defines the label classes, so it is the one place that names the slots. */
const EXEMPT = /(^|\/)SectionLabel\.tsx$/;

/**
 * The slots that only label type uses. `--label-case` is left out on purpose: kickers and
 * stat labels borrow the theme's label case on top of their own size and tracking slots.
 */
const LABEL_SLOT = /--label-(size|weight|tracking|color)\b/;

describe("label typography", () => {
  it("is reached through SectionLabel, not copied from the theme slots", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !EXEMPT.test(path) && !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => LABEL_SLOT.test(text))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("is looking at the tree it thinks it is", () => {
    // A glob that matches nothing would make the check above pass for the wrong reason.
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources).some((path) => EXEMPT.test(path))).toBe(true);
  });
});
