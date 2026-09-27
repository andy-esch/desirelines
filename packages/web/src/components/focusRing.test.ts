import { describe, it, expect } from "vitest";

/**
 * Keyboard focus draws the theme's ring on every element: a base `:focus-visible` rule in
 * tailwind.css applies the `control-focus-ring` utility, an outline in the theme's
 * `--control-focus-*` slots. Two things undo that, and this catches both coming back:
 *
 * - a Tailwind `ring-*` or `outline-*` on focus, which draws the same ring in every theme
 *   (shadcn's generated primitives come with one);
 * - an `outline-none` (or `outline-hidden`), which hides the ring. Each file that hides it
 *   says why here: focus is shown some other way, or the element is never focused by Tab.
 */

/** Files that still draw their own focus ring, each with the reason. */
const OWN_RING_FOR_NOW: Readonly<Record<string, string>> = {};

/** Files that hide the outline, each with the reason focus doesn't need it there. */
const HIDES_OUTLINE: Readonly<Record<string, string>> = {
  "components/ui/combobox.tsx":
    "the input shows focus on the chips box around it (focus-within); the list and its positioner hold focus only in passing; an item shows focus as its highlighted row",
  "components/ui/dropdown-menu.tsx":
    "the positioner holds focus only while the menu opens; an item shows focus as its highlighted row",
  "components/ui/popover.tsx":
    "the positioner and popup take focus as the popover opens, so it is announced; the controls inside draw the ring",
  "components/ui/select.tsx":
    "the positioner holds focus only in passing; an item shows focus as its highlighted row",
  "components/ui/sheet.tsx":
    "the sheet takes focus as it opens, so the dialog is announced; the controls inside draw the ring",
  "components/ui/tooltip.tsx": "a tooltip's positioner never takes keyboard focus",
  "routes/__root.tsx":
    "<main> is the skip link's target (tabindex -1): focused by script, never by Tab, and the page itself shows where it landed",
};

const sources = import.meta.glob<string>(
  ["../**/*.{tsx,css}", "!../**/*.test.tsx", "!../test/**"],
  { query: "?raw", import: "default", eager: true }
);
/** Paths from `src/`, with block comments dropped: a comment may name what it warns against. */
const files = Object.entries(sources).map(
  ([path, text]) =>
    [
      path.replace(/^\.\//, "components/").replace(/^\.\.\//, ""),
      text.replace(/\/\*[\s\S]*?\*\//g, ""),
    ] as const
);

/** A Tailwind ring, or an outline other than hiding it, drawn on focus. */
const OWN_RING =
  /\b(?:focus|focus-visible|focus-within):(?:ring-|outline(?!-(?:none|hidden)\b)(?:-[\w-]+)?\b)/;
const HIDDEN_OUTLINE = /(?:^|[\s"'`:])outline-(?:none|hidden)\b|outline:\s*(?:none|0)\s*[;}]/m;

const withOwnRing = files.filter(([, text]) => OWN_RING.test(text)).map(([path]) => path);
const hidingOutline = files.filter(([, text]) => HIDDEN_OUTLINE.test(text)).map(([path]) => path);

describe("focus rings", () => {
  it("scans the app's components, routes and stylesheets", () => {
    const paths = files.map(([path]) => path);
    expect(paths.length).toBeGreaterThan(50);
    expect(paths).toContain("components/ui/button.tsx");
    expect(paths).toContain("routes/__root.tsx");
    expect(paths).toContain("css/tailwind.css");
  });

  it("reach every element through the base :focus-visible rule", () => {
    const css = files.find(([path]) => path === "css/tailwind.css")?.[1] ?? "";
    expect(css).toMatch(/@layer base\s*\{[\s\S]*:focus-visible\s*\{\s*@apply control-focus-ring;/);
  });

  it("come from the theme's control-focus-ring, or a stated reason not to yet", () => {
    expect(withOwnRing.filter((path) => !(path in OWN_RING_FOR_NOW))).toEqual([]);
  });

  it("aren't hidden without a stated reason", () => {
    expect(hidingOutline.filter((path) => !(path in HIDES_OUTLINE))).toEqual([]);
  });

  it("leave the lists once a file stops needing them", () => {
    const stale = [
      ...Object.keys(OWN_RING_FOR_NOW).filter((path) => !withOwnRing.includes(path)),
      ...Object.keys(HIDES_OUTLINE).filter((path) => !hidingOutline.includes(path)),
    ];
    expect(stale).toEqual([]);
  });

  it("recognise the ways of hiding an outline", () => {
    for (const hidden of [
      'className="outline-none"',
      "focus-visible:outline-none",
      " outline-hidden ",
      ".x { outline: none; }",
      ".x { outline: 0 }",
    ]) {
      expect(HIDDEN_OUTLINE.test(hidden), hidden).toBe(true);
    }
    for (const shown of [
      "outline-offset-2",
      "outline-2",
      ".sport-mark { outline: 1px solid red; }",
    ]) {
      expect(HIDDEN_OUTLINE.test(shown), shown).toBe(false);
    }
  });
  it("recognise a ring of a component's own", () => {
    for (const own of [
      "focus:ring-2",
      "focus-visible:ring-accent",
      "focus:outline",
      "focus:outline-2",
      "focus-within:outline-accent-cyan",
    ]) {
      expect(OWN_RING.test(own), own).toBe(true);
    }
    for (const not of [
      "focus-visible:outline-none",
      "focus:outline-hidden",
      "focus-visible:control-focus-ring",
      "outline-2",
    ]) {
      expect(OWN_RING.test(not), not).toBe(false);
    }
  });
});
