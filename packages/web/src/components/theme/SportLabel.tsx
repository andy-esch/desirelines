import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SportBadge } from "../SportBadge";
import { useThemeStructure } from "./useThemeStructure";

export interface SportLabelProps {
  /** The sport's color from `SPORT_COLORS`. */
  color: string;
  /** The sport's name. */
  children: ReactNode;
  /**
   * Draw a `SportBadge` where the theme marks sports with badges. Without it, those themes
   * show the plain name, as rows that never had a badge do.
   */
  badge?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A sport's name in a row or list, marked per the theme's `sportMarkStyle`: a glowing dot
 * or square swatch before the name (shaped by `--sport-mark-radius`), or a badge. The name's
 * case comes from `--data-label-case`.
 */
export function SportLabel({ color, children, badge = false, className }: SportLabelProps) {
  const { sportMarkStyle } = useThemeStructure();

  if (sportMarkStyle === "badge") {
    return badge ? (
      <SportBadge color={color}>{children}</SportBadge>
    ) : (
      <span className={className}>{children}</span>
    );
  }

  return (
    <span
      data-mark={sportMarkStyle}
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap [text-transform:var(--data-label-case)]",
        className
      )}
      style={{ "--sport-color": color } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className="size-[7px] flex-none rounded-(--sport-mark-radius) bg-(--sport-color) [box-shadow:0_0_6px_var(--sport-color)]"
      />
      {children}
    </span>
  );
}
