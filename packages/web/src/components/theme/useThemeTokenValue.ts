import { useContext, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { ThemeStructureContext } from "./useThemeStructure";

/**
 * A theme token's resolved value, for the few props that cannot take `var()`. Recharts
 * draws bar corners from numbers, and parses a line's dash pattern to animate it drawing
 * in, so `var(--chart-bar-radius)` or `var(--chart-average-dash)` would reach it as text
 * it can't use.
 *
 * Reads the token on the element the returned ref is attached to, so a `data-theme`
 * subtree gets its own theme's value, and reads it again when the theme changes (the
 * provider applies a new theme to the document before anything re-renders). Until the
 * element mounts, and wherever no stylesheet applies, such as in tests, it is `fallback`.
 */
export function useThemeTokenValue<T extends Element>(token: string, fallback: string) {
  const ref = useRef<T>(null);
  const [value, setValue] = useState(fallback);
  const { theme } = useTheme();
  const subtreeStructure = useContext(ThemeStructureContext);

  useLayoutEffect(() => {
    const element = ref.current;
    const read = element ? getComputedStyle(element).getPropertyValue(token).trim() : "";
    setValue(read || fallback);
  }, [token, fallback, theme.id, subtreeStructure]);

  return [ref, value] as const;
}
