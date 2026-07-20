import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { resolveThemeColor } from "../utils/colorTokens";

type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "theme";

function getSystemPreference(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Update meta theme-color for browser chrome. Read from --color-bg-body rather than
  // restating it: the class is already applied above, so the computed value is the
  // theme we just switched to.
  //
  // The literals in `index.html` (the static meta tag + the FOUC script) genuinely
  // cannot use this — they run before the stylesheet is parsed, so there is no
  // computed value to read. They stay hardcoded, and the fallbacks here match them so
  // the two agree if the token ever goes missing.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolveThemeColor(
      "--color-bg-body",
      resolved === "dark" ? "#0f1724" : "#f0f4f8"
    );
  }
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  });

  const [systemPref, setSystemPref] = useState<ResolvedTheme>(getSystemPreference);

  const setTheme = useCallback((mode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    // Apply to the DOM here, not only in the effect below. Consumers that *read*
    // resolved token values (getComputedStyle) re-render as soon as resolvedTheme
    // changes, and child effects run before the provider's — so if the class were
    // only applied in the effect, those consumers would read the previous theme and
    // lag one switch behind. Applying eagerly means the DOM is already correct by the
    // time anything re-renders. The effect stays for mount and system changes.
    applyTheme(mode === "system" ? getSystemPreference() : mode);
    setThemeState(mode);
  }, []);

  // Derived during render — no setState needed
  const resolvedTheme: ResolvedTheme = theme === "system" ? systemPref : theme;

  // Apply theme to DOM whenever resolved value changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Track the OS preference AT ALL TIMES, not just in "system" mode.
  //
  // Listening only while in system mode lets `systemPref` go stale: switch to manual
  // dark, change the OS to light, then pick "System" again — `resolvedTheme` would
  // resolve against the months-old preference and the effect below would re-apply the
  // wrong theme, overwriting the correct one `setTheme` had just applied.
  //
  // The theme is still only *applied* from here when the OS is actually driving it;
  // in manual mode `resolvedTheme` ignores `systemPref`, so nothing re-renders.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next = getSystemPreference();
      if (theme === "system") applyTheme(next);
      setSystemPref(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
