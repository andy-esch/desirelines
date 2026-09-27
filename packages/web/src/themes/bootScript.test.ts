import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildThemeBootScript, THEME_BOOT_PLACEHOLDER } from "./bootScript";
import {
  LEGACY_THEME_STORAGE_KEY,
  MIAMI_MIGRATION,
  SIGNED_IN_HINT_KEY,
  THEME_STORAGE_KEYS,
  parseThemePreference,
  resolveTheme,
  type ThemeScheme,
} from "./registry";
import indexHtml from "../../index.html?raw";

const originalMatchMedia = window.matchMedia;

/** Store `values` (null removes a key), then run the script as the inline <script> would. */
function runBootScript(scheme: ThemeScheme, values: Record<string, string | null> = {}) {
  window.matchMedia = vi.fn(
    (query: string) => ({ matches: scheme === "dark", media: query }) as MediaQueryList
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  // Executes the generated source exactly as the inline <script> would — evaluating a
  // string is the point of this test, not an accident.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(buildThemeBootScript())();
}

const painted = () => document.documentElement.dataset.theme;

describe("theme boot script", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#000000";
    document.head.appendChild(meta);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
    localStorage.clear();
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  // "dark" and "legacy-dark" are retired values a returning visitor can still have stored.
  const stored = [
    null,
    "system",
    "dark",
    "light",
    "legacy-dark",
    "legacy-light",
    "bogus",
    "constructor",
  ];
  const cases = (["demo", "account"] as const).flatMap((scope) =>
    stored.flatMap((value) =>
      (["dark", "light"] as const).map((scheme) => [scope, value, scheme] as const)
    )
  );

  it.each(cases)(
    "resolves the %s theme %j under an OS %s scheme like the app does",
    (scope, value, scheme) => {
      runBootScript(scheme, {
        [THEME_STORAGE_KEYS[scope]]: value,
        [SIGNED_IN_HINT_KEY]: scope === "account" ? "1" : null,
      });

      const expected = resolveTheme(parseThemePreference(value), scheme);
      const root = document.documentElement;
      expect(root.dataset.theme).toBe(expected.id);
      expect(root.style.colorScheme).toBe(expected.scheme);
      expect(
        document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
      ).toBe(expected.background);
    }
  );

  describe("demo and account themes", () => {
    it("paints the account's theme while the signed-in hint is set", () => {
      runBootScript("dark", {
        [THEME_STORAGE_KEYS.demo]: "legacy-light",
        [THEME_STORAGE_KEYS.account]: "arcade",
        [SIGNED_IN_HINT_KEY]: "1",
      });
      expect(painted()).toBe("arcade");
    });

    it("paints the demo's theme without the hint, whatever the account's cache holds", () => {
      runBootScript("dark", {
        [THEME_STORAGE_KEYS.demo]: "legacy-light",
        [THEME_STORAGE_KEYS.account]: "arcade",
      });
      expect(painted()).toBe("legacy-light");
    });

    it("paints the default for a signed-in account with nothing cached, not the demo's theme", () => {
      runBootScript("dark", { [THEME_STORAGE_KEYS.demo]: "arcade", [SIGNED_IN_HINT_KEY]: "1" });
      expect(painted()).toBe(resolveTheme(parseThemePreference(null), "dark").id);
    });

    it("writes a resolved retired id back to the key it read", () => {
      runBootScript("dark", {
        [THEME_STORAGE_KEYS.account]: "legacy-dark",
        [SIGNED_IN_HINT_KEY]: "1",
      });
      expect(painted()).toBe("arcade");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.account)).toBe("arcade");
    });
  });

  describe("the legacy shared key", () => {
    it("moves into the demo's key once and is removed, with the Miami flag", () => {
      runBootScript("dark", {
        [LEGACY_THEME_STORAGE_KEY]: "legacy-light",
        [MIAMI_MIGRATION.storageKey]: "1",
      });

      expect(painted()).toBe("legacy-light");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("legacy-light");
      expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(MIAMI_MIGRATION.storageKey)).toBeNull();
    });

    it("never overwrites a demo theme already chosen", () => {
      runBootScript("dark", {
        [LEGACY_THEME_STORAGE_KEY]: "arcade",
        [THEME_STORAGE_KEYS.demo]: "legacy-light",
      });

      expect(painted()).toBe("legacy-light");
      expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
    });

    it("moves into the demo's key even when signed in, and doesn't paint it then", () => {
      runBootScript("dark", {
        [LEGACY_THEME_STORAGE_KEY]: "legacy-light",
        [SIGNED_IN_HINT_KEY]: "1",
        [THEME_STORAGE_KEYS.account]: "arcade",
      });

      expect(painted()).toBe("arcade");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("legacy-light");
    });

    it.each(MIAMI_MIGRATION.from)(
      "applies the one-time move to Miami to an unflagged %j",
      (value) => {
        runBootScript("dark", { [LEGACY_THEME_STORAGE_KEY]: value });

        expect(painted()).toBe(MIAMI_MIGRATION.to);
        expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe(MIAMI_MIGRATION.to);
      }
    );

    it('keeps a flagged "system", a choice made after the move to Miami', () => {
      runBootScript("dark", {
        [LEGACY_THEME_STORAGE_KEY]: "system",
        [MIAMI_MIGRATION.storageKey]: "1",
      });

      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("system");
    });

    it("lands a saved Legacy dark on Arcade, the theme that replaced it", () => {
      // Legacy dark is gone from the list, so this goes through the aliases rather than the
      // move to Miami: an explicit choice of that look keeps the look.
      runBootScript("dark", { [LEGACY_THEME_STORAGE_KEY]: "legacy-dark" });

      expect(painted()).toBe("arcade");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("arcade");
    });

    it("lands the old toggle's dark on the default, as the move to Miami intends", () => {
      runBootScript("light", { [LEGACY_THEME_STORAGE_KEY]: "dark" });

      expect(painted()).toBe(MIAMI_MIGRATION.to);
    });

    it("stores nothing for a first-time visitor, who gets the default anyway", () => {
      runBootScript("dark");

      expect(painted()).toBe(MIAMI_MIGRATION.to);
      expect(localStorage.length).toBe(0);
    });
  });

  it("paints the default when storage is unavailable", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(localStorage, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    runBootScript("light");
    expect(painted()).toBe(resolveTheme(parseThemePreference(null), "light").id);
  });
});

describe("index.html", () => {
  it("carries exactly one placeholder for the generated script", () => {
    expect(indexHtml.split(THEME_BOOT_PLACEHOLDER)).toHaveLength(2);
  });

  it("has no hand-written theme script left to drift", () => {
    expect(indexHtml).not.toMatch(/classList\.add\(["']dark["']\)/);
    expect(indexHtml).not.toMatch(/localStorage/);
  });
});
