import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { HeadingLevel } from "./useHeadingLevel";

export interface SectionLabelProps extends HTMLAttributes<HTMLElement> {
  /**
   * The element: a heading where the label titles what follows (a panel's title), a span
   * otherwise (its meta). A heading drops the margin and the display face `h1` to `h3`
   * take, so it looks exactly like the span.
   */
  as?: "span" | `h${HeadingLevel}` | undefined;
}

/**
 * A section or panel label. Size, tracking, color and case come from the theme's
 * `--label-*` slots, so a theme decides whether labels are tracked uppercase.
 */
export function SectionLabel({ as: Element = "span", className, ...props }: SectionLabelProps) {
  return (
    <Element
      className={cn(
        "text-(length:--label-size) leading-tight font-(weight:--label-weight) tracking-(--label-tracking) text-(color:--label-color) [text-transform:var(--label-case)]",
        Element !== "span" && "m-0 [font-family:inherit]",
        className
      )}
      {...props}
    />
  );
}
