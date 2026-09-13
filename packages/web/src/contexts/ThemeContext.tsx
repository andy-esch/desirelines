import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeDefinition,
  type ThemePreference,
  type ThemeScheme,
} from "../themes/registry";

interface ThemeContextValue {
  /** What the user chose: a theme id, or "system" to follow the OS color scheme. */
  preference: ThemePreference;
  /** The theme currently applied. Read `scheme`, `mapStyle`, etc. from here. */
  theme: ThemeDefinition;
  setPreference: (preference: ThemePreference) => void;
}

function getSystemScheme(): ThemeScheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply a theme to the document. The first-paint script (`themes/bootScript.ts`) does
 * the same before the app loads; this keeps the DOM in step on every later change.
 */
function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.scheme;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme.background;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: DEFAULT_THEME_PREFERENCE,
  theme: resolveTheme(DEFAULT_THEME_PREFERENCE, "dark"),
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  );

  const [systemScheme, setSystemScheme] = useState<ThemeScheme>(getSystemScheme);

  const setPreference = useCallback((next: ThemePreference) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    // Apply to the DOM here, not only in the effect below. Consumers that *read*
    // resolved token values (getComputedStyle) re-render as soon as the theme
    // changes, and child effects run before the provider's — so if the attribute were
    // only applied in the effect, those consumers would read the previous theme and
    // lag one switch behind. Applying eagerly means the DOM is already correct by the
    // time anything re-renders. The effect stays for mount and system changes.
    applyTheme(resolveTheme(next, getSystemScheme()));
    setPreferenceState(next);
  }, []);

  // Derived during render — no setState needed
  const theme = resolveTheme(preference, systemScheme);

  // Apply theme to DOM whenever the resolved theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Track the OS preference AT ALL TIMES, not just when following the system.
  //
  // Listening only while following the system lets `systemScheme` go stale: pick a
  // specific theme, change the OS scheme, then pick "System" again — the theme would
  // resolve against the old scheme and the effect above would re-apply the wrong
  // theme, overwriting the correct one `setPreference` had just applied.
  //
  // The theme is still only *applied* from here when the OS is actually driving it;
  // with a specific theme chosen, `theme` ignores `systemScheme`, so nothing changes.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next = getSystemScheme();
      if (preference === "system") applyTheme(resolveTheme("system", next));
      setSystemScheme(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  return (
    <ThemeContext.Provider value={{ preference, theme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
