import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./useThemeStructure";

export interface SportLabelProps {
  /** The sport's color from `SPORT_COLORS`. */
  color: string;
  /** The sport's name. */
  children: ReactNode;
  className?: string | undefined;
}

/** The mark alone, e.g. beside a page title: a dot or swatch per `sportMarkStyle`. */
export function SportMark({ color, className }: { color: string; className?: string | undefined }) {
  const { sportMarkStyle } = useThemeStructure();
  return (
    <span
      aria-hidden="true"
      data-mark={sportMarkStyle}
      className={cn(
        "size-[7px] flex-none rounded-(--sport-mark-radius) bg-(--sport-color) [box-shadow:0_0_6px_var(--sport-color)]",
        className
      )}
      style={{ "--sport-color": color } as CSSProperties}
    />
  );
}

/**
 * A sport's name in a row or list, marked per the theme's `sportMarkStyle`: a glowing dot
 * or square swatch before the name, shaped by `--sport-mark-radius`. The name's case comes
 * from `--data-label-case`.
 */
export function SportLabel({ color, children, className }: SportLabelProps) {
  const { sportMarkStyle } = useThemeStructure();
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
