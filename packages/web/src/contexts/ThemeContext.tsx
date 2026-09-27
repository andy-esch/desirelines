import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  resolveTheme,
  SIGNED_IN_HINT_KEY,
  THEME_STORAGE_KEYS,
  themeScopeFromHint,
  type ThemeDefinition,
  type ThemePreference,
  type ThemeScheme,
  type ThemeScope,
} from "../themes/registry";

interface ThemeContextValue {
  /** What the user chose: a theme id, or "system" to follow the OS color scheme. */
  preference: ThemePreference;
  /** The theme currently applied. Read `scheme`, `mapStyle`, etc. from here. */
  theme: ThemeDefinition;
  /** Saves to the current scope's key, and applies at once. */
  setPreference: (preference: ThemePreference) => void;
  /**
   * Whose theme is showing: the demo's, or the signed-in account's. The two are stored
   * apart and never read each other; `ThemeSync` switches between them with sign-in.
   */
  scope: ThemeScope;
  /**
   * Switch scope and show its theme: `preference` when given (and stored for the scope),
   * or else the scope's stored one. Entering the account sets the signed-in hint the first
   * paint reads; leaving it clears the hint and the account's cached theme.
   */
  setScope: (scope: ThemeScope, preference?: ThemePreference) => void;
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
  scope: "demo",
  setScope: () => {},
});

function storedPreference(scope: ThemeScope): ThemePreference {
  return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEYS[scope]));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start where the first-paint script did: the account's theme while the hint is set.
  const [scope, setScopeState] = useState<ThemeScope>(() =>
    themeScopeFromHint(localStorage.getItem(SIGNED_IN_HINT_KEY))
  );
  const scopeRef = useRef(scope);
  const [preference, setPreferenceState] = useState<ThemePreference>(() => storedPreference(scope));

  const [systemScheme, setSystemScheme] = useState<ThemeScheme>(getSystemScheme);

  const setPreference = useCallback((next: ThemePreference) => {
    localStorage.setItem(THEME_STORAGE_KEYS[scopeRef.current], next);
    // Apply to the DOM here, not only in the effect below. Consumers that *read*
    // resolved token values (getComputedStyle) re-render as soon as the theme
    // changes, and child effects run before the provider's — so if the attribute were
    // only applied in the effect, those consumers would read the previous theme and
    // lag one switch behind. Applying eagerly means the DOM is already correct by the
    // time anything re-renders. The effect stays for mount and system changes.
    applyTheme(resolveTheme(next, getSystemScheme()));
    setPreferenceState(next);
  }, []);

  const setScope = useCallback((next: ThemeScope, preference?: ThemePreference) => {
    if (next === "account") {
      localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    } else {
      localStorage.removeItem(SIGNED_IN_HINT_KEY);
      localStorage.removeItem(THEME_STORAGE_KEYS.account);
    }
    if (preference !== undefined) localStorage.setItem(THEME_STORAGE_KEYS[next], preference);
    const shown = preference ?? storedPreference(next);
    scopeRef.current = next;
    // Eagerly, for the same reason as setPreference.
    applyTheme(resolveTheme(shown, getSystemScheme()));
    setScopeState(next);
    setPreferenceState(shown);
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
    <ThemeContext.Provider value={{ preference, theme, setPreference, scope, setScope }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
