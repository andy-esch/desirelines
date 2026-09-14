import { describe, it, expect } from "vitest";
import { THEMES } from "./registry";
import tailwindCss from "../css/tailwind.css?raw";

/**
 * Guards the CSS half of each theme against the theme list (see the header comment in
 * registry.ts). Parses tailwind.css as text: theme blocks are flat variable lists, so a
 * regex is enough and keeps this test free of a CSS toolchain.
 */
const css = tailwindCss.replace(/\/\*[\s\S]*?\*\//g, "");

const blocks = new Map<string, Map<string, string>>();
const duplicateBlocks: string[] = [];
for (const [, id, body] of css.matchAll(/\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)) {
  if (!id || body === undefined) continue;
  if (blocks.has(id)) duplicateBlocks.push(id);
  const declarations = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name && value) declarations.set(name, value.trim());
  }
  blocks.set(id, declarations);
}

describe("theme CSS blocks", () => {
  it("has exactly one block per theme in the list, and no others", () => {
    expect(duplicateBlocks).toEqual([]);
    expect([...blocks.keys()].sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it("defines the same token set in every block, so nested themes never inherit", () => {
    const union = new Set([...blocks.values()].flatMap((decls) => [...decls.keys()]));
    const gaps = [...blocks].flatMap(([id, decls]) =>
      [...union].filter((name) => !decls.has(name)).map((name) => `${id} is missing ${name}`)
    );
    expect(gaps).toEqual([]);
  });

  it("matches each theme's background to its --color-bg-body", () => {
    for (const theme of THEMES) {
      expect(blocks.get(theme.id)?.get("--color-bg-body")?.toLowerCase()).toBe(
        theme.background.toLowerCase()
      );
    }
  });

  it("lists only fonts the block's body or display stack names", () => {
    for (const theme of THEMES) {
      const block = blocks.get(theme.id);
      const stacks = `${block?.get("--font-body") ?? ""} ${block?.get("--font-display") ?? ""}`;
      for (const font of theme.fonts) {
        expect(stacks, `${theme.id} lists ${font.family}`).toContain(`"${font.family}"`);
      }
    }
  });

  it("imports the font packages for every family a block names first", () => {
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
    expect(css).not.toMatch(/:not\(\.dark\)|html\.dark\b/);
  });
});
