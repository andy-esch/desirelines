import { createContext, useContext } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import type { ThemeStructure } from "../../themes/registry";

/**
 * Set only where a subtree renders a different theme than the page (a `data-theme`
 * subtree, such as the dev theme gallery). Everywhere else it stays `null` and the active
 * theme's structure applies.
 */
export const ThemeStructureContext = createContext<ThemeStructure | null>(null);

/**
 * The structural choices of the theme a component renders in. Theme components read
 * this instead of the theme id, so a new theme changes markup only through its entry.
 */
export function useThemeStructure(): ThemeStructure {
  const override = useContext(ThemeStructureContext);
  const { theme } = useTheme();
  return override ?? theme.structure;
}
