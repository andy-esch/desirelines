import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./useThemeStructure";

export interface PageTitleProps {
  children: ReactNode;
  /**
   * Tints the title's glow, e.g. with the sport's color. The glow's size and the offset
   * behind it come from the theme, so a theme without a glow still shows none.
   */
  glowColor?: string | undefined;
  /** A short line of context above the title, e.g. `4 Weeks · All sports`. */
  kicker?: ReactNode | undefined;
  /** Classes for the `h1`. */
  className?: string | undefined;
}

/**
 * A page's `h1` in the display face, sized, colored and cased by the `--page-title-*`
 * slots. The kicker renders only in themes whose structure shows page kickers.
 */
export function PageTitle({ children, kicker, glowColor, className }: PageTitleProps) {
  const { showPageKicker } = useThemeStructure();
  // Composed here, not in the slot: a slot holding var() would resolve at the theme root,
  // where the caller's color isn't set.
  const glow: CSSProperties | undefined = glowColor
    ? {
        textShadow: `0 0 var(--page-title-glow-size) color-mix(in srgb, ${glowColor} 60%, transparent), var(--page-title-offset-shadow)`,
      }
    : undefined;
  const title = (
    <h1
      style={glow}
      className={cn(
        "m-0 font-display font-normal text-(length:--page-title-size) leading-(--page-title-leading) text-(color:--page-title-color) [text-shadow:var(--page-title-shadow)] [text-transform:var(--page-title-case)]",
        className
      )}
    >
      {children}
    </h1>
  );

  if (!showPageKicker || kicker == null) return title;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-(length:--kicker-size) leading-tight tracking-(--kicker-tracking) text-(color:--kicker-color) [text-transform:var(--label-case)]">
        {kicker}
      </span>
      {title}
    </div>
  );
}
