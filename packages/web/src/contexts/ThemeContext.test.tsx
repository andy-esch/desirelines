import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { THEME_STORAGE_KEY } from "../themes/registry";

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

  it("follows the OS scheme when nothing is stored", () => {
    mockColorScheme(false);
    const provider = renderProvider();

    expect(provider.value.preference).toBe("system");
    expect(provider.value.theme.id).toBe("legacy-light");
    expect(document.documentElement.dataset.theme).toBe("legacy-light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      "#f0f4f8"
    );
  });

  it("reads the old stored 'dark' value as the legacy dark theme", () => {
    mockColorScheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const provider = renderProvider();

    expect(provider.value.preference).toBe("legacy-dark");
    expect(document.documentElement.dataset.theme).toBe("legacy-dark");
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

  it("tracks OS changes while following the system", () => {
    const os = mockColorScheme(true);
    const provider = renderProvider();
    expect(provider.value.theme.id).toBe("legacy-dark");

    os.setDark(false);

    expect(provider.value.theme.id).toBe("legacy-light");
    expect(document.documentElement.dataset.theme).toBe("legacy-light");
  });

  it("ignores OS changes for an explicit theme, then resolves freshly on returning to system", () => {
    const os = mockColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, "legacy-dark");
    const provider = renderProvider();

    os.setDark(false);
    expect(document.documentElement.dataset.theme).toBe("legacy-dark");

    act(() => provider.value.setPreference("system"));
    expect(document.documentElement.dataset.theme).toBe("legacy-light");
  });
});
