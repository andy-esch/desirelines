// Explicit `.ts` extension: vite.config.ts loads this file, and Vite's native config loader
// requires one.
import {
  DEFAULT_THEME_PREFERENCE,
  LEGACY_PREFERENCE_ALIASES,
  MIAMI_MIGRATION,
  SYSTEM_THEME_IDS,
  THEME_STORAGE_KEY,
  THEMES,
} from "./registry.ts";

/** Marker in `index.html` that the Vite plugin replaces with the generated script. */
export const THEME_BOOT_PLACEHOLDER = "<!-- theme-boot-script -->";

/**
 * Build the inline first-paint script that sets `data-theme`, `color-scheme` and the
 * `theme-color` meta before the app (or even the stylesheet) loads, so the page never
 * flashes the wrong theme.
 *
 * It is generated from the theme list at build time (see `vite.config.ts`) rather than
 * hand-written in `index.html`, so it cannot drift from the list. It must stay plain ES5
 * with no imports: it runs as a classic inline script. Its resolution rules mirror
 * `parseThemePreference` + `resolveTheme`; `bootScript.test.ts` executes it against the
 * same inputs to keep the two in lockstep.
 *
 * It also runs the one-time move to Miami (`MIAMI_MIGRATION`) before resolving, so a
 * migrated visitor never sees the old theme paint first.
 */
export function buildThemeBootScript(): string {
  const config = {
    key: THEME_STORAGE_KEY,
    fallback: DEFAULT_THEME_PREFERENCE,
    aliases: LEGACY_PREFERENCE_ALIASES,
    migration: {
      key: MIAMI_MIGRATION.storageKey,
      from: Object.fromEntries(MIAMI_MIGRATION.from.map((value) => [value, true])),
      to: MIAMI_MIGRATION.to,
    },
    system: SYSTEM_THEME_IDS,
    themes: Object.fromEntries(
      THEMES.map((t) => [t.id, { scheme: t.scheme, background: t.background }])
    ),
  };

  return `(function () {
  var c = ${JSON.stringify(config)};
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var p = null;
  var done = "1";
  try { p = window.localStorage.getItem(c.key); } catch (e) {}
  if (p !== null && has(c.aliases, p)) p = c.aliases[p];
  try {
    if (window.localStorage.getItem(c.migration.key) !== done) {
      window.localStorage.setItem(c.migration.key, done);
      if (p !== null && has(c.migration.from, p)) {
        p = c.migration.to;
        window.localStorage.setItem(c.key, p);
      }
    }
  } catch (e) {}
  if (p !== "system" && !(p !== null && has(c.themes, p))) p = c.fallback;
  var id = p;
  if (p === "system") {
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    id = c.system[dark ? "dark" : "light"];
  }
  var t = c.themes[id];
  var root = document.documentElement;
  root.setAttribute("data-theme", id);
  root.style.colorScheme = t.scheme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.background);
})();`;
}
