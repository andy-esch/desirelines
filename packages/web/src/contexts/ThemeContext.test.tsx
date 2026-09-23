import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";
import {
  DEFAULT_THEME_PREFERENCE,
  getTheme,
  type ThemeId,
  THEME_STORAGE_KEY,
} from "../themes/registry";

const originalMatchMedia = window.matchMedia;

/** A controllable prefers-color-scheme media query. */
function mockColorScheme(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        get matches() {
          return dark;
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList
  );
  return {
    setDark(next: boolean) {
      dark = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

type Ctx = ReturnType<typeof useTheme>;

function renderProvider() {
  const ctx: { current: Ctx | null } = { current: null };
  // Records what a consumer that reads the DOM during render would see.
  const seen: { themeId: string; domTheme: string | undefined }[] = [];
  function Probe() {
    const value = useTheme();
    ctx.current = value;
    seen.push({ themeId: value.theme.id, domTheme: document.documentElement.dataset.theme });
    return null;
  }
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
  return {
    get value() {
      if (!ctx.current) throw new Error("provider not rendered");
      return ctx.current;
    },
    seen,
  };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("applies the default theme when nothing is stored, whatever the OS says", () => {
    mockColorScheme(false);
    const provider = renderProvider();
    const fallback = getTheme(DEFAULT_THEME_PREFERENCE as ThemeId);

    expect(provider.value.preference).toBe(DEFAULT_THEME_PREFERENCE);
    expect(provider.value.theme.id).toBe(fallback.id);
    expect(document.documentElement.dataset.theme).toBe(fallback.id);
    expect(document.documentElement.style.colorScheme).toBe(fallback.scheme);
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      fallback.background
    );
  });

  it("reads the old toggle 'dark' value as the default theme", () => {
    mockColorScheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const provider = renderProvider();

    expect(provider.value.preference).toBe("miami");
    expect(document.documentElement.dataset.theme).toBe("miami");
  });

  it("reads a saved Legacy dark as Arcade, which carries that look now", () => {
    mockColorScheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, "legacy-dark");
    const provider = renderProvider();

    expect(provider.value.preference).toBe("arcade");
    expect(document.documentElement.dataset.theme).toBe("arcade");
  });

  it("persists a choice and applies it before consumers re-render", () => {
    mockColorScheme(true);
    const provider = renderProvider();

    act(() => provider.value.setPreference("legacy-light"));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("legacy-light");
    expect(provider.value.theme.id).toBe("legacy-light");
    // The first render that sees the new theme must already find it on the DOM.
    const firstLight = provider.seen.find((s) => s.themeId === "legacy-light");
    expect(firstLight?.domTheme).toBe("legacy-light");
  });

  // "System" is not in the picker today, but a preference stored before it went away
  // still follows the OS, and "Match system" returns with the light retro theme.
  it("tracks OS changes while following the system", () => {
    const os = mockColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    const provider = renderProvider();
    expect(provider.value.theme.id).toBe("miami");

    os.setDark(false);

    expect(provider.value.theme.id).toBe("legacy-light");
    expect(document.documentElement.dataset.theme).toBe("legacy-light");
  });

  it("ignores OS changes for an explicit theme, then resolves freshly on returning to system", () => {
    const os = mockColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, "arcade");
    const provider = renderProvider();

    os.setDark(false);
    expect(document.documentElement.dataset.theme).toBe("arcade");

    act(() => provider.value.setPreference("system"));
    expect(document.documentElement.dataset.theme).toBe("legacy-light");
  });
});
