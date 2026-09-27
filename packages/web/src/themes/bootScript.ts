// Explicit `.ts` extension: vite.config.ts loads this file, and Vite's native config loader
// requires one.
import {
  DEFAULT_THEME_PREFERENCE,
  LEGACY_PREFERENCE_ALIASES,
  LEGACY_THEME_STORAGE_KEY,
  MIAMI_MIGRATION,
  SIGNED_IN_HINT_KEY,
  SYSTEM_THEME_IDS,
  THEME_STORAGE_KEYS,
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
 * It reads the signed-in account's cached theme while the signed-in hint is set, and the
 * demo's otherwise: the two are kept apart (see `THEME_STORAGE_KEYS`).
 *
 * Before that, it moves the legacy shared key into the demo's key, once, applying the
 * aliases and the one-time move to Miami (`MIAMI_MIGRATION`) on the way, so a returning
 * visitor never sees the old theme paint first.
 */
export function buildThemeBootScript(): string {
  const config = {
    keys: THEME_STORAGE_KEYS,
    hint: SIGNED_IN_HINT_KEY,
    legacy: LEGACY_THEME_STORAGE_KEY,
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
  var read = function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  var write = function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} };
  var drop = function (k) { try { window.localStorage.removeItem(k); } catch (e) {} };
  // The theme once lived under one key for demo and account alike. Move it into the demo's
  // key, once, resolving a retired id and the one-time move to Miami on the way.
  var old = read(c.legacy);
  if (old !== null) {
    if (has(c.aliases, old)) old = c.aliases[old];
    if (read(c.migration.key) !== "1" && has(c.migration.from, old)) old = c.migration.to;
    if (read(c.keys.demo) === null) write(c.keys.demo, old);
    drop(c.legacy);
  }
  drop(c.migration.key);
  var key = read(c.hint) === "1" ? c.keys.account : c.keys.demo;
  var p = read(key);
  if (p !== null && has(c.aliases, p)) {
    p = c.aliases[p];
    // Write the resolved id back: a retired value is migrated once rather than re-resolved
    // on every load, so the alias table can eventually be dropped without stranding anyone.
    write(key, p);
  }
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
