import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./useThemeStructure";

export interface PageTitleProps {
  children: ReactNode;
  /** A short line of context above the title, e.g. `4 Weeks · All sports`. */
  kicker?: ReactNode | undefined;
  /** Classes for the `h1`. */
  className?: string | undefined;
}

/**
 * A page's `h1` in the display face, sized, colored and cased by the `--page-title-*`
 * slots. The kicker renders only in themes whose structure shows page kickers.
 */
export function PageTitle({ children, kicker, className }: PageTitleProps) {
  const { showPageKicker } = useThemeStructure();
  const title = (
    <h1
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
