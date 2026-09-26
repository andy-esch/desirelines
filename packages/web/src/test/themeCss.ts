import tailwindCss from "../css/tailwind.css?raw";

/**
 * The theme stylesheets as text, for tests that check theme values without a CSS toolchain.
 *
 * Each theme is one file, `css/themes/<id>.css`, holding a single `[data-theme="<id>"]`
 * block of variables, imported from `tailwind.css`. The blocks are flat lists, so a regex
 * is enough to read them.
 */

/** `tailwind.css` as written, comments included. */
export const TAILWIND_CSS: string = tailwindCss;

/** Each theme file as written, keyed by the theme id its file name carries. */
export const THEME_FILES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob<string>("../css/themes/*.css", {
      query: "?raw",
      import: "default",
      eager: true,
    })
  ).map(([path, css]) => [path.replace(/^.*\/|\.css$/g, ""), css])
);

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export interface ThemeBlock {
  /** The id in the block's selector. */
  readonly id: string;
  /** The whole block, selector through closing brace. */
  readonly text: string;
  readonly tokens: ReadonlyMap<string, string>;
}

/** The `[data-theme]` blocks in a stylesheet, in order, read with comments stripped. */
export function themeBlocksIn(css: string): ThemeBlock[] {
  return [...stripComments(css).matchAll(/\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)].map(
    ([text, id = "", body = ""]) => ({
      id,
      text,
      tokens: new Map(
        [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = "", value = ""]) => [
          name,
          value.trim(),
        ])
      ),
    })
  );
}

/** The tokens `tailwind.css` registers in its `@theme` block, with the values given there. */
export function themeRegistrations(): ReadonlyMap<string, string> {
  const body = stripComments(TAILWIND_CSS).match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "";
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = "", value = ""]) => [
      name,
      value.trim(),
    ])
  );
}

/** A theme's value for a token, or `""` when its file does not define it. */
export function themeToken(themeId: string, token: string): string {
  const block = themeBlocksIn(THEME_FILES.get(themeId) ?? "").find((b) => b.id === themeId);
  return block?.tokens.get(token) ?? "";
}

/** Every custom property `tailwind.css` declares, with the last value it gives. */
export function tailwindDeclarations(): ReadonlyMap<string, string> {
  return new Map(
    [...stripComments(TAILWIND_CSS).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(
      ([, name = "", value = ""]) => [name, value.trim().replace(/\s+/g, " ")]
    )
  );
}

/**
 * A theme value with each `var(--x)` replaced by what the theme sets for `--x`, or failing
 * that what `tailwind.css` sets: the value the browser computes at the theme's root. A
 * reference to a token neither sets is left as written.
 */
export function resolveVars(themeId: string, value: string): string {
  const tokens = themeBlocksIn(THEME_FILES.get(themeId) ?? "")[0]?.tokens ?? new Map();
  const declared = tailwindDeclarations();
  let resolved = value.replace(/\s+/g, " ");
  for (let depth = 0; depth < 8 && /var\(--[\w-]+\)/.test(resolved); depth++) {
    resolved = resolved.replace(
      /var\((--[\w-]+)\)/g,
      (ref, name: string) => tokens.get(name)?.replace(/\s+/g, " ") ?? declared.get(name) ?? ref
    );
  }
  return resolved;
}
