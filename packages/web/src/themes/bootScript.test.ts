import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildThemeBootScript, THEME_BOOT_PLACEHOLDER } from "./bootScript";
import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ThemeScheme,
} from "./registry";
import indexHtml from "../../index.html?raw";

const originalMatchMedia = window.matchMedia;

function runBootScript({ stored, scheme }: { stored: string | null; scheme: ThemeScheme }) {
  window.matchMedia = vi.fn(
    (query: string) => ({ matches: scheme === "dark", media: query }) as MediaQueryList
  );
  if (stored === null) localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, stored);
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
