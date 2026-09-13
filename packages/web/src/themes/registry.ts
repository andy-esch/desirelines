/**
 * Theme list — the single TypeScript source for which themes exist.
 *
 * A theme is two halves that must agree:
 *   1. a `[data-theme="<id>"]` variable block in `css/tailwind.css`, which carries every
 *      visual value; and
 *   2. an entry here, which carries what CSS cannot: the label, light/dark scheme, the
 *      Mapbox style, whether it is released, and the ground color the first-paint script
 *      needs before the stylesheet has loaded.
 *
 * `themeCss.test.ts` fails if the two drift (a theme without a block, a block without a
 * theme, or a mismatched ground color). Components never branch on a theme id; anything
 * that differs between themes is a token value or a field on this entry.
 *
 * This module is also imported by `vite.config.ts` to generate the first-paint script,
 * so it must stay free of browser globals and CSS imports.
 */

export type ThemeScheme = "dark" | "light";

export interface ThemeDefinition {
  /** Stable id: the `data-theme` attribute value and the stored preference. */
  readonly id: string;
  /** Picker label. */
  readonly label: string;
  /** Sets `color-scheme` and decides which theme "system" resolves to. */
  readonly scheme: ThemeScheme;
  /** Mapbox style URL for the routes map. */
  readonly mapStyle: string;
  /** Unreleased themes stay out of the picker; the dev theme gallery still renders them. */
  readonly hidden: boolean;
  /**
   * Page ground — must equal the block's `--color-bg-body`. Used by the first-paint script
   * and `<meta name="theme-color">`, which run before any stylesheet is available.
   */
  readonly background: string;
  /** Picker preview colors: the ground first, then accents. */
  readonly swatches: readonly string[];
}

const MAPBOX_DARK = "mapbox://styles/mapbox/dark-v11";
const MAPBOX_LIGHT = "mapbox://styles/mapbox/light-v11";

export const THEMES = [
  {
    id: "legacy-dark",
    label: "Dark",
    scheme: "dark",
    mapStyle: MAPBOX_DARK,
    hidden: false,
    background: "#0f1724",
    swatches: ["#0f1724", "#00d4ff", "#ff00ff"],
  },
  {
    id: "legacy-light",
    label: "Light",
    scheme: "light",
    mapStyle: MAPBOX_LIGHT,
    hidden: false,
    background: "#f0f4f8",
    swatches: ["#f0f4f8", "#0891b2", "#c026d3"],
  },
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof THEMES)[number]["id"];

/** A stored choice: a specific theme, or follow the OS color scheme. */
export type ThemePreference = ThemeId | "system";

/** localStorage key for the preference. Unchanged from the dark/light toggle era. */
export const THEME_STORAGE_KEY = "theme";

/** Preference used when nothing (or nothing valid) is stored. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** The theme "system" resolves to for each OS color scheme. */
export const SYSTEM_THEME_IDS: Readonly<Record<ThemeScheme, ThemeId>> = {
  dark: "legacy-dark",
  light: "legacy-light",
};

/** Values written by the old dark/light toggle, mapped onto the theme that replaced them. */
export const LEGACY_PREFERENCE_ALIASES: Readonly<Record<string, ThemeId>> = {
  dark: "legacy-dark",
  light: "legacy-light",
};

/** Themes offered in the picker. */
export const VISIBLE_THEMES = THEMES.filter((t) => !t.hidden);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}

export function getTheme(id: ThemeId): ThemeDefinition {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Unknown theme id: ${id}`);
  return theme;
}

/**
 * Read a stored preference, accepting the old `dark` / `light` values. Anything
 * unrecognized — including an id for a theme that no longer exists — falls back to the
 * default rather than leaving the app without a theme.
 */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  if (raw === "system") return "system";
  if (isThemeId(raw)) return raw;
  // hasOwn, not a bare index: a stored "constructor" or "toString" would otherwise resolve
  // to an Object.prototype member instead of falling back.
  if (raw != null && Object.hasOwn(LEGACY_PREFERENCE_ALIASES, raw)) {
    return LEGACY_PREFERENCE_ALIASES[raw] ?? DEFAULT_THEME_PREFERENCE;
  }
  return DEFAULT_THEME_PREFERENCE;
}

/** The theme a preference applies, given the OS color scheme. */
export function resolveTheme(
  preference: ThemePreference,
  systemScheme: ThemeScheme
): ThemeDefinition {
  return getTheme(preference === "system" ? SYSTEM_THEME_IDS[systemScheme] : preference);
}
