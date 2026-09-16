import type { ReactNode } from "react";
import type { ThemeStructure } from "../../themes/registry";
import { ThemeStructureContext } from "./useThemeStructure";

/**
 * Renders a subtree with a specific theme's structure. Pair it with `data-theme` on the
 * same subtree: the attribute switches the CSS values, this switches the markup choices.
 */
export function ThemeStructureProvider({
  structure,
  children,
}: {
  structure: ThemeStructure;
  children: ReactNode;
}) {
  return (
    <ThemeStructureContext.Provider value={structure}>{children}</ThemeStructureContext.Provider>
  );
}
