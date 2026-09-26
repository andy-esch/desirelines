import { describe, it, expect } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  MIAMI_MIGRATION,
  LEGACY_PREFERENCE_ALIASES,
  SYSTEM_THEME_IDS,
  THEMES,
  VISIBLE_THEMES,
  isThemeId,
  parseThemePreference,
  readSyncedTheme,
  resolveTheme,
} from "./registry";

describe("theme list", () => {
  it("has unique ids", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps each OS scheme to a theme of that scheme", () => {
    for (const scheme of ["dark", "light"] as const) {
      expect(resolveTheme("system", scheme).scheme).toBe(scheme);
    }
  });

  it("aliases the old dark/light values onto existing themes", () => {
    for (const target of Object.values(LEGACY_PREFERENCE_ALIASES)) {
      expect(isThemeId(target)).toBe(true);
    }
  });

  it("leads each theme's swatches with its ground color", () => {
    for (const theme of THEMES) {
      expect(theme.swatches[0]).toBe(theme.background);
    }
  });

  it("offers only unhidden themes in the picker", () => {
    expect(VISIBLE_THEMES.every((t) => !t.hidden)).toBe(true);
    expect(VISIBLE_THEMES).toHaveLength(THEMES.filter((t) => !t.hidden).length);
  });

  it("defaults to a theme rather than the OS scheme", () => {
    expect(DEFAULT_THEME_PREFERENCE).not.toBe("system");
    expect(THEMES.some((t) => t.id === DEFAULT_THEME_PREFERENCE)).toBe(true);
  });

  it("moves stored preferences onto a theme that exists", () => {
    expect(THEMES.some((t) => t.id === MIAMI_MIGRATION.to)).toBe(true);
    for (const value of MIAMI_MIGRATION.from) {
      expect(value === "system" || THEMES.some((t) => t.id === value)).toBe(true);
    }
  });
});

describe("parseThemePreference", () => {
  it("accepts every theme id and 'system'", () => {
    for (const theme of THEMES) expect(parseThemePreference(theme.id)).toBe(theme.id);
    expect(parseThemePreference("system")).toBe("system");
  });

  it("migrates the values the old dark/light toggle stored", () => {
    // The toggle offered one dark, so its value is a light-or-dark preference, not a taste:
    // it lands on the default. A saved theme id is a choice between looks, so Legacy dark
    // lands on Arcade, which carries that look.
    expect(parseThemePreference("dark")).toBe("miami");
    expect(parseThemePreference("light")).toBe("legacy-light");
    expect(parseThemePreference("legacy-dark")).toBe("arcade");
  });

  it.each([null, undefined, "", "neon", "constructor", "toString", "__proto__"])(
    "falls back to the default for %j",
    (raw) => {
      expect(parseThemePreference(raw)).toBe(DEFAULT_THEME_PREFERENCE);
    }
  );
});

describe("readSyncedTheme", () => {
  it("reads every theme id and 'system' as a choice", () => {
    for (const theme of THEMES) expect(readSyncedTheme(theme.id)).toBe(theme.id);
    expect(readSyncedTheme("system")).toBe("system");
  });

  it.each([null, undefined, "", "dark", "light"])("reads %j as no choice", (raw) => {
    // "dark" and "light" are what preference saves wrote as a default, not picks.
    expect(readSyncedTheme(raw)).toBeNull();
  });

  it.each(["neon", "constructor", "__proto__"])("falls back to the default for %j", (raw) => {
    expect(readSyncedTheme(raw)).toBe(DEFAULT_THEME_PREFERENCE);
  });

  it("still maps a retired theme id onto its replacement", () => {
    expect(readSyncedTheme("legacy-dark")).toBe("arcade");
  });
});

describe("resolveTheme", () => {
  it("follows the OS scheme for 'system'", () => {
    expect(resolveTheme("system", "dark").id).toBe(SYSTEM_THEME_IDS.dark);
    expect(resolveTheme("system", "light").id).toBe(SYSTEM_THEME_IDS.light);
  });

  it("ignores the OS scheme for an explicit theme", () => {
    expect(resolveTheme("legacy-light", "dark").id).toBe("legacy-light");
    expect(resolveTheme("arcade", "light").id).toBe("arcade");
  });
});
