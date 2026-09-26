import { describe, it, expect } from "vitest";
import { DEFAULT_THEME_PREFERENCE, THEMES } from "./registry";
import { parseRgb } from "../utils/colorTokens";
import {
  TAILWIND_CSS,
  THEME_FILES,
  stripComments,
  themeBlocksIn,
  themeRegistrations,
} from "../test/themeCss";
import { contrastRatio } from "../test/contrast";

/**
 * Guards the CSS half of each theme against the theme list (see the header comment in
 * registry.ts). A theme's CSS is one file, `css/themes/<id>.css`, holding its variable
 * block and nothing else, and `tailwind.css` imports each one.
 */
const css = stripComments(TAILWIND_CSS);

const blocks = new Map(
  [...THEME_FILES].map(([id, file]) => [id, themeBlocksIn(file)[0]?.tokens ?? new Map()])
);

describe("theme CSS files", () => {
  it("has exactly one file per theme in the list, and no others", () => {
    expect([...THEME_FILES.keys()].sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it("holds its own theme's block and nothing else, so a theme stays values only", () => {
    for (const [id, file] of THEME_FILES) {
      const found = themeBlocksIn(file);
      expect(
        found.map((b) => b.id),
        `${id}.css`
      ).toEqual([id]);
      expect(stripComments(file).trim(), `${id}.css outside its block`).toBe(found[0]?.text);
    }
  });

  it("is imported by tailwind.css, which declares no theme block of its own", () => {
    const imports = [...css.matchAll(/@import\s+["']\.\/themes\/([^"']+)\.css["']/g)].map(
      ([, id]) => id
    );
    expect(imports.sort()).toEqual([...THEME_FILES.keys()].sort());
    expect(themeBlocksIn(css)).toEqual([]);
  });

  it("defines the same token set in every file, so nested themes never inherit", () => {
    const union = new Set([...blocks.values()].flatMap((decls) => [...decls.keys()]));
    const gaps = [...blocks].flatMap(([id, decls]) =>
      [...union].filter((name) => !decls.has(name)).map((name) => `${id} is missing ${name}`)
    );
    expect(gaps).toEqual([]);
  });

  it("registers each theme token at the default theme's value", () => {
    // Nothing renders these, but the build bakes them into the fallback an older browser
    // gets for an opacity modifier (`bg-surface-raised/80`), so they must belong to a live
    // theme rather than drift toward one that was deleted.
    const defaults = blocks.get(DEFAULT_THEME_PREFERENCE);
    expect(defaults, "the default theme has a file").toBeDefined();
    const spaced = (value: string | undefined) => value?.replace(/\s+/g, " ");
    const drifted = [...themeRegistrations()]
      .filter(
        ([name, value]) => defaults?.has(name) && spaced(value) !== spaced(defaults.get(name))
      )
      .map(([name, value]) => `${name} is ${value}, the default theme has ${defaults?.get(name)}`);
    expect(drifted).toEqual([]);
  });

  it("keeps each theme's five goal colors apart from each other", () => {
    // A goal line is told apart by its color first, so two that nearly match read as one.
    // The floor sits well under the closest pair any theme has today (about 120), so it
    // catches a near-duplicate without standing in for the colorblind check the designs had.
    const registered = themeRegistrations();
    for (const [id, tokens] of blocks) {
      const resolve = (value: string): string => {
        const ref = value.match(/^var\((--[\w-]+)\)$/)?.[1];
        return ref ? resolve(tokens.get(ref) ?? registered.get(ref) ?? "") : value;
      };
      const goals = [1, 2, 3, 4, 5].map((n) => {
        const rgb = parseRgb(resolve(tokens.get(`--color-goal-${n}`) ?? ""));
        expect(rgb, `${id} --color-goal-${n} is a color`).not.toBeNull();
        return rgb!;
      });
      goals.forEach((a, i) =>
        goals.slice(i + 1).forEach((b, j) => {
          const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
          expect(distance, `${id} goals ${i + 1} and ${i + j + 2}`).toBeGreaterThan(100);
        })
      );
    }
  });

  it("keeps a pressed toggle's text readable on what it sits on", () => {
    // Arcade shipped with its pressed item drawn black on black. Toggle labels are small
    // text, so the floor is WCAG's 4.5:1. `initial` falls back to the accent, as the
    // toggle's own var() fallbacks do, and a transparent fill shows the toggle frame's
    // surface.
    const floors: Readonly<Record<string, number>> = {
      // White on teal, about 3.7:1, predates the check; the theme leaves with Memphis.
      "legacy-light": 3.5,
    };
    for (const [id, tokens] of blocks) {
      const set = (name: string) => {
        const value = tokens.get(name);
        return value && value !== "initial" ? value : undefined;
      };
      const fill = set("--color-toggle-pressed") ?? set("--color-accent-cyan") ?? "";
      const ground = fill === "transparent" ? (set("--color-surface-raised") ?? "") : fill;
      const text = set("--color-toggle-pressed-text") ?? set("--color-accent-cyan-text") ?? "";
      expect(contrastRatio(text, ground), `${id}: ${text} on ${ground}`).toBeGreaterThanOrEqual(
        floors[id] ?? 4.5
      );
    }
  });

  it("matches each theme's background to its --color-bg-body", () => {
    for (const theme of THEMES) {
      expect(blocks.get(theme.id)?.get("--color-bg-body")?.toLowerCase()).toBe(
        theme.background.toLowerCase()
      );
    }
  });

  it("lists only fonts the file's body or display stack names", () => {
    for (const theme of THEMES) {
      const block = blocks.get(theme.id);
      const stacks = `${block?.get("--font-body") ?? ""} ${block?.get("--font-display") ?? ""}`;
      for (const font of theme.fonts) {
        expect(stacks, `${theme.id} lists ${font.family}`).toContain(`"${font.family}"`);
      }
    }
  });

  it("imports the font packages for every family a file names first", () => {
    const leadFamily = (stack: string | undefined) => stack?.match(/^\s*["']?([^"',]+)/)?.[1];
    const webFamilies = new Set(
      [...blocks.values()]
        .flatMap((decls) => [
          leadFamily(decls.get("--font-body")),
          leadFamily(decls.get("--font-display")),
        ])
        .filter(
          (family): family is string =>
            family !== undefined && !/^(-apple-system|ui-|system-ui)/.test(family)
        )
    );
    for (const family of webFamilies) {
      const pkg = family
        .replace(/ Variable$/, "")
        .toLowerCase()
        .replace(/\s+/g, "-");
      expect(css, `an @import for ${family}`).toMatch(
        new RegExp(`@import "@fontsource[^"]*/${pkg}`)
      );
    }
  });

  it("no longer switches themes with the .dark class", () => {
    for (const source of [css, ...[...THEME_FILES.values()].map(stripComments)]) {
      expect(source).not.toMatch(/:not\(\.dark\)|html\.dark\b/);
    }
  });
});
