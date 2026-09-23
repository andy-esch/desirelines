/**
 * Theme list — the single TypeScript source for which themes exist.
 *
 * A theme is two halves that must agree:
 *   1. a `[data-theme="<id>"]` variable block in `css/tailwind.css`, which carries every
 *      visual value; and
 *   2. an entry here, which carries what CSS cannot: the label, light/dark scheme, the
 *      Mapbox style and its recolor, whether it is released, the ground color the first-paint script
 *      needs before the stylesheet has loaded, the faces to preload, and the structural
 *      choices components read.
 *
 * `themeCss.test.ts` fails if the two drift (a theme without a block, a block without a
 * theme, a mismatched ground color, or fonts the block doesn't use). Components never branch on a theme id; anything
 * that differs between themes is a token value or a field on this entry.
 *
 * This module is also imported by `vite.config.ts` to generate the first-paint script,
 * so it must stay free of browser globals and CSS imports.
 */

import { RETRO_BASE_MAPS } from "./baseMaps";

export type ThemeScheme = "dark" | "light";

/** A font face a theme renders with; used to preload the theme's faces. */
export interface ThemeFont {
  /** CSS family name, as the theme block's `--font-body` / `--font-display` spell it. */
  readonly family: string;
  /** Weights the theme uses. */
  readonly weights: readonly number[];
}

/**
 * Choices that add, remove or rearrange markup, so they can't be a CSS value. Components
 * read these fields; they never check which theme is active. See "Theme slots" in the
 * style guide for what each one changes.
 */
export interface ThemeStructure {
  /** A small kicker line above page titles. */
  readonly showPageKicker: boolean;
  /** The dashboard hero's decoration; also picks the Settings preview thumbnail. */
  readonly heroDecoration: "none" | "sunset" | "grid";
  /** Where a panel's title goes: a label above it, a bar inside it, or a card header. */
  readonly sectionLabelPlacement: "card-header" | "above" | "header-bar";
  /** How a row of big numbers is framed. */
  readonly statRowStyle: "cards" | "divided" | "boxed";
  /** Range sliders draw a continuous track or a segmented meter. */
  readonly sliderTrack: "continuous" | "segmented";
  /** A cursor glyph at the left edge of the hovered table row. */
  readonly rowHoverCursor: boolean;
  /** Paging a list: stacked arrows beside it, or a labelled row under it. */
  readonly pagerStyle: "arrows" | "labelled";
  /** How a sport is marked in rows and lists. */
  readonly sportMarkStyle: "badge" | "dot" | "swatch";
  /** Goal status: colored badges, or an SVG symbol plus text. */
  readonly statusSymbolStyle: "badge" | "filled" | "outlined";
  /** Goal progress: a bar with the percent on it, or a track with a pace tick. */
  readonly goalTrackStyle: "bar-with-percent" | "track" | "outline-track";
  /** Year meters fill the current segment to today's share of it. */
  readonly meterPartialCurrent: boolean;
  /** Loading indicator. */
  readonly loaderStyle: "spinner" | "chaser" | "block";
  /** The pacing charts' danger zone: a translucent wash or a diagonal hatch. */
  readonly dangerZoneFill: "wash" | "hatch";
  /** Axis marker dots on charts. */
  readonly chartMarkerShape: "circle" | "square";
  /** A legend row above line charts. */
  readonly chartLegend: boolean;
  /** Routes-map drawer sections: flat with rules, or stacked outline panels. */
  readonly mapDrawerSections: "flat" | "panels";
  /** Dates: `Sep 12, 2026` or zero-padded `2026.09.12`. Integers are never padded. */
  readonly dateFormat: "short" | "dotted";
}

/**
 * Base-map colors by map feature role. Mapbox paint can't read CSS variables, so these are
 * literal values applied over the stock style after it loads (see `mapRecolor.ts`).
 */
export interface MapPalette {
  readonly land: string;
  /** Parks and other land use. */
  readonly park: string;
  /** Water bodies and waterways. */
  readonly water: string;
  /** Buildings, plus bridges, piers and airport areas. */
  readonly building: string;
  /** Paths, steps, rail and streets outside the classes below. */
  readonly roadMinor: string;
  /** Primary and secondary roads. */
  readonly roadPrimary: string;
  /** Motorways and trunk roads. */
  readonly roadMotorway: string;
  readonly tunnel: string;
  /** Country and state boundaries. */
  readonly admin: string;
  /** Road, water, park and point-of-interest labels. */
  readonly label: string;
  /** Settlement, state and country labels. */
  readonly labelStrong: string;
  readonly labelHalo: string;
}

/** How a theme changes its Mapbox style. `null` fields keep the style's own values. */
export interface ThemeMap {
  readonly palette: MapPalette | null;
  /** A font Mapbox's font servers host, e.g. `Roboto Mono Regular`, for every map label. */
  readonly labelFont: string | null;
}

export interface ThemeDefinition {
  /** Stable id: the `data-theme` attribute value and the stored preference. */
  readonly id: string;
  /** Picker label. */
  readonly label: string;
  /** Sets `color-scheme` and decides which theme "system" resolves to. */
  readonly scheme: ThemeScheme;
  /** Mapbox style URL for the routes map. */
  readonly mapStyle: string;
  /** Recolor and label font applied over `mapStyle`. */
  readonly map: ThemeMap;
  /** Unreleased themes stay out of the picker; the dev theme gallery still renders them. */
  readonly hidden: boolean;
  /**
   * Page ground — must equal the block's `--color-bg-body`. Used by the first-paint script
   * and `<meta name="theme-color">`, which run before any stylesheet is available.
   */
  readonly background: string;
  /** Picker preview colors: the ground first, then accents. */
  readonly swatches: readonly string[];
  /** Faces the theme renders with. `themeCss.test.ts` checks them against the block. */
  readonly fonts: readonly ThemeFont[];
  readonly structure: ThemeStructure;
}

const MAPBOX_DARK = "mapbox://styles/mapbox/dark-v11";
const MAPBOX_LIGHT = "mapbox://styles/mapbox/light-v11";

/** Miami's structure, from the approved retro design. */
const MIAMI_STRUCTURE: ThemeStructure = {
  showPageKicker: true,
  heroDecoration: "sunset",
  sectionLabelPlacement: "above",
  statRowStyle: "divided",
  sliderTrack: "continuous",
  rowHoverCursor: false,
  pagerStyle: "labelled",
  sportMarkStyle: "dot",
  statusSymbolStyle: "filled",
  goalTrackStyle: "track",
  meterPartialCurrent: true,
  loaderStyle: "chaser",
  dangerZoneFill: "hatch",
  chartMarkerShape: "circle",
  chartLegend: true,
  mapDrawerSections: "flat",
  dateFormat: "short",
};

/** Miami's faces: Plex Mono for all UI and data, Archivo Black for display text. */
const MIAMI_FONTS: readonly ThemeFont[] = [
  { family: "IBM Plex Mono", weights: [400, 500, 600] },
  { family: "Archivo Black", weights: [400] },
];

const ARCADE_STRUCTURE: ThemeStructure = {
  showPageKicker: true,
  heroDecoration: "grid",
  sectionLabelPlacement: "header-bar",
  statRowStyle: "boxed",
  sliderTrack: "segmented",
  rowHoverCursor: true,
  pagerStyle: "arrows",
  sportMarkStyle: "swatch",
  statusSymbolStyle: "outlined",
  goalTrackStyle: "outline-track",
  // The year meter counts 52 weeks, so the current segment is a whole week either way.
  meterPartialCurrent: false,
  loaderStyle: "block",
  dangerZoneFill: "hatch",
  chartMarkerShape: "square",
  chartLegend: true,
  mapDrawerSections: "panels",
  dateFormat: "dotted",
};

/** Arcade's faces: Plex Mono for all UI and data, Michroma for display text. */
const ARCADE_FONTS: readonly ThemeFont[] = [
  { family: "IBM Plex Mono", weights: [400, 500, 600] },
  { family: "Michroma", weights: [400] },
];

/** Legacy themes show the stock Mapbox styles. */
const STOCK_MAP: ThemeMap = { palette: null, labelFont: null };

/** Legacy themes keep today's structure until they are deleted. */
const LEGACY_STRUCTURE: ThemeStructure = {
  showPageKicker: false,
  heroDecoration: "none",
  sectionLabelPlacement: "card-header",
  statRowStyle: "cards",
  sliderTrack: "continuous",
  rowHoverCursor: false,
  pagerStyle: "arrows",
  sportMarkStyle: "badge",
  statusSymbolStyle: "badge",
  goalTrackStyle: "bar-with-percent",
  meterPartialCurrent: false,
  loaderStyle: "spinner",
  dangerZoneFill: "wash",
  chartMarkerShape: "circle",
  // True, not false: the sparkline legend has rendered since February 2026, months before
  // this field existed, so `false` never described Legacy. Now that something reads the
  // field, honouring the old value would delete a legend Legacy has always shown.
  chartLegend: true,
  mapDrawerSections: "flat",
  dateFormat: "short",
};

/** Legacy body text is the system sans stack, so only the display face is a web font. */
const LEGACY_FONTS: readonly ThemeFont[] = [
  { family: "Space Grotesk Variable", weights: [300, 400, 500, 600, 700] },
];

export const THEMES = [
  {
    id: "legacy-light",
    label: "Light",
    scheme: "light",
    mapStyle: MAPBOX_LIGHT,
    map: STOCK_MAP,
    hidden: false,
    background: "#f0f4f8",
    swatches: ["#f0f4f8", "#0891b2", "#c026d3"],
    fonts: LEGACY_FONTS,
    structure: LEGACY_STRUCTURE,
  },
  {
    id: "miami",
    label: "Miami",
    scheme: "dark",
    mapStyle: MAPBOX_DARK,
    map: RETRO_BASE_MAPS.miami,
    hidden: false,
    background: "#160b2e",
    swatches: ["#160b2e", "#ff2ec4", "#00e5ff"],
    fonts: MIAMI_FONTS,
    structure: MIAMI_STRUCTURE,
  },
  {
    id: "arcade",
    label: "Arcade",
    scheme: "dark",
    mapStyle: MAPBOX_DARK,
    map: RETRO_BASE_MAPS.arcade,
    hidden: false,
    background: "#000000",
    swatches: ["#000000", "#00ffff", "#ff00ff"],
    fonts: ARCADE_FONTS,
    structure: ARCADE_STRUCTURE,
  },
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof THEMES)[number]["id"];

/** A stored choice: a specific theme, or follow the OS color scheme. */
export type ThemePreference = ThemeId | "system";

/** localStorage key for the preference. Unchanged from the dark/light toggle era. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Preference used when nothing (or nothing valid) is stored. Miami is the site's look, so
 * a new visitor gets it whatever their OS color scheme says.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "miami";

/** The theme "system" resolves to for each OS color scheme. */
export const SYSTEM_THEME_IDS: Readonly<Record<ThemeScheme, ThemeId>> = {
  dark: "miami",
  light: "legacy-light",
};

/**
 * The one-time move to Miami, for a visitor who had never chosen a theme. An explicit
 * choice is left alone: it goes through the aliases below instead, which is how a saved
 * Legacy dark now lands on Arcade rather than here. The flag makes it once-only, and the
 * first-paint script runs it (see `bootScript.ts`) before anything is painted.
 */
export const MIAMI_MIGRATION = {
  storageKey: "theme-migrated-miami",
  /** Stored preferences that become Miami, after the aliases below are applied. */
  from: ["system"],
  to: "miami",
} as const;

/**
 * Retired preference values, mapped onto the theme that replaced them. Applied before
 * anything else, so a saved value never has to survive on its own.
 *
 * The two dark values part ways deliberately. `legacy-dark` was a choice between themes, so
 * it lands on Arcade, which carries the neon look that choice was about. `dark` came from the
 * old two-option toggle, where dark was the only dark there was: that is a light-or-dark
 * preference rather than a taste, so it lands on the default like everyone who never chose.
 */
export const LEGACY_PREFERENCE_ALIASES: Readonly<Record<string, ThemeId>> = {
  dark: "miami",
  "legacy-dark": "arcade",
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
