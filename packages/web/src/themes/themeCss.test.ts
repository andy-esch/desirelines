import { describe, it, expect } from "vitest";
import { DEFAULT_THEME_PREFERENCE, THEMES } from "./registry";
import {
  TAILWIND_CSS,
  THEME_FILES,
  stripComments,
  themeBlocksIn,
  themeRegistrations,
} from "../test/themeCss";

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
