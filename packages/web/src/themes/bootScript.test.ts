import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildThemeBootScript, THEME_BOOT_PLACEHOLDER } from "./bootScript";
import {
  MIAMI_MIGRATION,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ThemeScheme,
} from "./registry";
import indexHtml from "../../index.html?raw";

const originalMatchMedia = window.matchMedia;

function runBootScript({
  stored,
  scheme,
  migrated = true,
}: {
  stored: string | null;
  scheme: ThemeScheme;
  /** Whether the one-time move to Miami has already run; most cases are past it. */
  migrated?: boolean;
}) {
  window.matchMedia = vi.fn(
    (query: string) => ({ matches: scheme === "dark", media: query }) as MediaQueryList
  );
  if (stored === null) localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, stored);
  if (migrated) localStorage.setItem(MIAMI_MIGRATION.storageKey, "1");
  else localStorage.removeItem(MIAMI_MIGRATION.storageKey);
  // Executes the generated source exactly as the inline <script> would — evaluating a
  // string is the point of this test, not an accident.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(buildThemeBootScript())();
}

describe("theme boot script", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#000000";
    document.head.appendChild(meta);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

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
  const cases = stored.flatMap((value) =>
    (["dark", "light"] as const).map((scheme) => [value, scheme] as const)
  );

  it.each(cases)("resolves stored %j under an OS %s scheme like the app does", (value, scheme) => {
    runBootScript({ stored: value, scheme });

    const expected = resolveTheme(parseThemePreference(value), scheme);
    const root = document.documentElement;
    expect(root.dataset.theme).toBe(expected.id);
    expect(root.style.colorScheme).toBe(expected.scheme);
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      expected.background
    );
  });

  describe("the one-time move to Miami", () => {
    it.each(MIAMI_MIGRATION.from)("moves a stored %j to Miami and remembers it", (value) => {
      runBootScript({ stored: value, scheme: "dark", migrated: false });

      expect(document.documentElement.dataset.theme).toBe(MIAMI_MIGRATION.to);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(MIAMI_MIGRATION.to);
      expect(localStorage.getItem(MIAMI_MIGRATION.storageKey)).toBe("1");
    });

    it("moves the old dark value too, since it aliases onto the dark theme", () => {
      runBootScript({ stored: "dark", scheme: "light", migrated: false });

      expect(document.documentElement.dataset.theme).toBe(MIAMI_MIGRATION.to);
    });

    it("leaves an explicit light choice alone", () => {
      runBootScript({ stored: "legacy-light", scheme: "dark", migrated: false });

      expect(document.documentElement.dataset.theme).toBe("legacy-light");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("legacy-light");
    });

    it("runs once, so choosing the old theme afterwards sticks", () => {
      runBootScript({ stored: "system", scheme: "dark", migrated: false });
      localStorage.setItem(THEME_STORAGE_KEY, "legacy-dark");
      runBootScript({ stored: "legacy-dark", scheme: "dark" });

      expect(document.documentElement.dataset.theme).toBe("legacy-dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("legacy-dark");
    });

    it("stores nothing for a first-time visitor, who gets the default anyway", () => {
      runBootScript({ stored: null, scheme: "dark", migrated: false });

      expect(document.documentElement.dataset.theme).toBe(MIAMI_MIGRATION.to);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
  });

  it("falls back to the default when storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      runBootScript({ stored: null, scheme: "light" });
      expect(document.documentElement.dataset.theme).toBe(
        resolveTheme(parseThemePreference(null), "light").id
      );
    } finally {
      getItem.mockRestore();
    }
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
