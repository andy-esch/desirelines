import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "../theme/useThemeStructure";

/**
 * One section of a routes-map drawer.
 *
 * Themes separate these two ways: a rule between flush sections, or a stacked outline panel
 * per section. Which one is the theme's `mapDrawerSections`, so the drawer's contents never
 * ask which theme is showing.
 *
 * The first section takes no rule — a rule above the top of a scrolling body reads as a
 * clipped section rather than a divider.
 */
export function MapDrawerSection({
  children,
  first = false,
  className,
}: {
  children: ReactNode;
  /** The first section in a drawer, which needs no separator above it. */
  first?: boolean;
  className?: string | undefined;
}) {
  const { mapDrawerSections } = useThemeStructure();

  if (mapDrawerSections === "panels") {
    return (
      <div
        className={cn(
          "m-2 border-solid border-(length:--panel-border-width) border-(color:--panel-accent-1) rounded-(--panel-radius)",
          "[box-shadow:var(--panel-shadow)]",
          className
        )}
      >
        {children}
      </div>
    );
  }

  return <div className={cn(!first && "border-t border-border/60", className)}>{children}</div>;
}
